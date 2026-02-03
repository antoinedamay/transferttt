const fs = require("fs");
const path = require("path");
const os = require("os");
const express = require("express");
const fetch = require("node-fetch");
const AbortController = require("abort-controller");
const cors = require("cors");
const Busboy = require("busboy");
const { Storage, File } = require("megajs");
const crypto = require("crypto");
require("dotenv").config();

if (!globalThis.fetch) {
  globalThis.fetch = fetch;
}
if (!globalThis.AbortController) {
  globalThis.AbortController = AbortController;
}
if (!globalThis.crypto) {
  globalThis.crypto = {};
}
if (!globalThis.crypto.getRandomValues) {
  globalThis.crypto.getRandomValues = (typedArray) => crypto.randomFillSync(typedArray);
}

const app = express();

const PORT = process.env.PORT || 5050;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || BASE_URL;
const MAX_BYTES = 10 * 1024 * 1024 * 1024;
const ALLOWED_EXPIRY_DAYS = [1, 7, 30, 90];
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const SHORT_CODE_LEN = parseInt(process.env.SHORT_CODE_LEN || "8", 10);

let storagePromise = null;

function getStorage() {
  if (!storagePromise) {
    const storage = new Storage({
      email: process.env.MEGA_EMAIL,
      password: process.env.MEGA_PASSWORD,
      keepalive: true
    });
    storagePromise = storage.ready.then(() => storage);
  }
  return storagePromise;
}

function base64UrlEncode(input) {
  return Buffer.from(JSON.stringify(input))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(token) {
  const pad = token.length % 4 === 0 ? "" : "=".repeat(4 - (token.length % 4));
  const json = Buffer.from(token.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64").toString("utf8");
  return JSON.parse(json);
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function isShortCode(token) {
  return typeof token === "string" && token.length >= 6 && token.length <= 12 && /^[A-Za-z0-9_-]+$/.test(token);
}

function generateShortCode(length) {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

async function kvGet(key) {
  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) return null;
  const url = `${UPSTASH_REDIS_REST_URL}/get/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` }
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data || data.result == null) return null;
  try {
    return JSON.parse(data.result);
  } catch (err) {
    return null;
  }
}

async function kvSet(key, value) {
  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) return false;
  const encodedValue = encodeURIComponent(JSON.stringify(value));
  const url = `${UPSTASH_REDIS_REST_URL}/set/${encodeURIComponent(key)}/${encodedValue}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`
    }
  });
  if (!res.ok) return false;
  const data = await res.json();
  return data && data.result === "OK";
}

async function resolveToken(token) {
  if (isShortCode(token)) {
    const data = await kvGet(token);
    if (!data) return null;
    return data;
  }
  return base64UrlDecode(token);
}

app.use(cors());

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    shortLinks: Boolean(UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN)
  });
});

app.post("/api/upload", (req, res) => {
  if (!process.env.MEGA_EMAIL || !process.env.MEGA_PASSWORD) {
    res.status(500).json({ error: "MEGA credentials missing" });
    return;
  }

  const busboy = Busboy({
    headers: req.headers,
    limits: { fileSize: MAX_BYTES }
  });

  let tempPath = null;
  let originalName = null;
  let writeStream = null;
  let expiresInDays = 30;

  busboy.on("file", (name, file, info) => {
    originalName = info.filename || `file-${Date.now()}`;
    const safeName = sanitizeFilename(originalName);
    const rand = crypto.randomBytes(8).toString("hex");
    tempPath = path.join(os.tmpdir(), `${Date.now()}-${rand}-${safeName}`);
    writeStream = fs.createWriteStream(tempPath);
    file.pipe(writeStream);

    file.on("limit", () => {
      res.status(413).json({ error: "File too large" });
    });
  });

  busboy.on("field", (name, value) => {
    if (name === "expiresInDays") {
      const parsed = parseInt(value, 10);
      if (ALLOWED_EXPIRY_DAYS.includes(parsed)) {
        expiresInDays = parsed;
      }
    }
  });

  busboy.on("error", (err) => {
    console.error("Busboy error:", err);
    res.status(500).json({ error: "Upload failed" });
  });

  busboy.on("finish", async () => {
    if (!tempPath) {
      res.status(400).json({ error: "No file" });
      return;
    }

    try {
      const stats = fs.statSync(tempPath);
      let storage;
      try {
        storage = await getStorage();
      } catch (err) {
        console.error("Mega auth error:", err);
        res.status(500).json({ error: "Mega auth failed" });
        fs.unlink(tempPath, () => {});
        return;
      }
      const uploadStream = fs.createReadStream(tempPath);
      const upload = storage.upload({ name: originalName, size: stats.size }, uploadStream);

      upload.on("error", () => {
        console.error("Mega upload error");
        res.status(500).json({ error: "Mega upload failed" });
      });

      upload.on("complete", async (file) => {
        const link = await file.link();
        const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
        const base = PUBLIC_BASE_URL.endsWith("/") ? PUBLIC_BASE_URL.slice(0, -1) : PUBLIC_BASE_URL;
        let token = base64UrlEncode({ link, exp: expiresAt.toISOString() });
        let downloadUrl = `${base}/${token}`;

        if (UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN) {
          let shortCode = null;
          for (let i = 0; i < 5; i++) {
            const candidate = generateShortCode(SHORT_CODE_LEN);
            const exists = await kvGet(candidate);
            if (!exists) {
              shortCode = candidate;
              break;
            }
          }
          if (shortCode) {
            const stored = {
              link,
              exp: expiresAt.toISOString(),
              name: originalName,
              size: stats.size
            };
            const storedOk = await kvSet(shortCode, stored);
            if (storedOk) {
              token = shortCode;
              downloadUrl = `${base}/${shortCode}`;
            }
          }
        }

        res.json({
          link,
          token,
          downloadUrl,
          expiresAt: expiresAt.toISOString()
        });
        fs.unlink(tempPath, () => {});
      });
    } catch (err) {
      console.error("Server error:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  req.pipe(busboy);
});

app.get("/api/info/:token", async (req, res) => {
  try {
    const payload = await resolveToken(req.params.token);
    if (!payload) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const link = payload.link;
    const exp = payload.exp ? new Date(payload.exp) : null;
    if (!link) {
      res.status(400).json({ error: "Invalid token" });
      return;
    }
    if (exp && Number.isFinite(exp.getTime()) && Date.now() > exp.getTime()) {
      res.status(410).json({ error: "Expired" });
      return;
    }
    if (payload.name || payload.size) {
      res.json({
        name: payload.name || "Fichier",
        size: payload.size || null,
        type: payload.type || null,
        expiresAt: exp ? exp.toISOString() : null
      });
      return;
    }
    const file = File.fromURL(link);
    await file.loadAttributes();
    res.json({
      name: file.name,
      size: file.size,
      type: file.type,
      expiresAt: exp ? exp.toISOString() : null
    });
  } catch (err) {
    res.status(400).json({ error: "Invalid link" });
  }
});

async function handleDownload(token, res) {
  try {
    const payload = await resolveToken(token);
    if (!payload) {
      res.status(404).send("Lien introuvable");
      return;
    }
    const link = payload.link;
    const exp = payload.exp ? new Date(payload.exp) : null;
    if (!link) {
      res.status(400).send("Invalid token");
      return;
    }
    if (exp && Number.isFinite(exp.getTime()) && Date.now() > exp.getTime()) {
      res.status(410).send("Lien expiré");
      return;
    }
    const file = File.fromURL(link);
    await file.loadAttributes();

    res.setHeader("Content-Type", file.type || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${file.name}"`);

    const stream = file.download();
    stream.on("error", () => {
      res.status(500).send("Download failed");
    });
    stream.pipe(res);
  } catch (err) {
    res.status(400).send("Invalid link");
  }
}

app.get("/dl/:token", async (req, res) => {
  handleDownload(req.params.token, res);
});

app.get("/:token([A-Za-z0-9_-]{16,})", async (req, res) => {
  handleDownload(req.params.token, res);
});

app.listen(PORT, () => {
  console.log(`Transfert backend listening on ${PORT}`);
});
