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
app.set("trust proxy", 1);

const PORT = process.env.PORT || 5050;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || BASE_URL;
const MAX_BYTES = 10 * 1024 * 1024 * 1024;
const ALLOWED_EXPIRY_DAYS = [1, 7, 30, 90];
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const SHORT_CODE_LEN = parseInt(process.env.SHORT_CODE_LEN || "8", 10);
const TOKEN_SECRET = process.env.TOKEN_SECRET;
const ALLOW_LEGACY_TOKENS = process.env.ALLOW_LEGACY_TOKENS === "true";
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "600000", 10);
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || "20", 10);

const defaultOrigins = [];
try {
  defaultOrigins.push(new URL(PUBLIC_BASE_URL).origin);
} catch (err) {
  // ignore invalid URL
}
defaultOrigins.push("http://localhost:3000", "http://localhost:5173", "http://localhost:8080");
const originEnv = process.env.CORS_ORIGINS || "";
const allowedOrigins = new Set(
  originEnv
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .concat(defaultOrigins)
);

const rateStore = new Map();

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
  try {
    const pad = token.length % 4 === 0 ? "" : "=".repeat(4 - (token.length % 4));
    const json = Buffer.from(token.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64").toString("utf8");
    return JSON.parse(json);
  } catch (err) {
    return null;
  }
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function asciiFilename(name) {
  const cleaned = sanitizeFilename(name || "fichier");
  return cleaned || "fichier";
}

function isShortCode(token) {
  return typeof token === "string" && token.length >= 3 && token.length <= 32 && /^[A-Za-z0-9_-]+$/.test(token);
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

function payloadToSignString(payload) {
  const link = payload && payload.link ? String(payload.link) : "";
  const exp = payload && payload.exp ? String(payload.exp) : "";
  const name = payload && payload.name ? String(payload.name) : "";
  const size = payload && payload.size != null ? String(payload.size) : "";
  return [link, exp, name, size].join("|");
}

function hmacSign(value) {
  if (!TOKEN_SECRET) return null;
  return crypto
    .createHmac("sha256", TOKEN_SECRET)
    .update(value)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function signPayload(payload) {
  const signature = hmacSign(payloadToSignString(payload));
  if (!signature) return null;
  return { payload, sig: signature };
}

function verifySignedPayload(data) {
  if (!data || !data.payload || !data.sig || !TOKEN_SECRET) return null;
  const expected = hmacSign(payloadToSignString(data.payload));
  if (!expected) return null;
  const a = Buffer.from(expected);
  const b = Buffer.from(data.sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return data.payload;
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

async function kvSet(key, value, ttlSeconds) {
  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) return false;
  const encodedValue = encodeURIComponent(JSON.stringify(value));
  const ttl = Math.max(1, Math.floor(ttlSeconds || 1));
  const url = `${UPSTASH_REDIS_REST_URL}/set/${encodeURIComponent(key)}/${encodedValue}?EX=${ttl}`;
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
  const decoded = base64UrlDecode(token);
  if (!decoded) return null;
  const verified = verifySignedPayload(decoded);
  if (verified) return verified;
  if (ALLOW_LEGACY_TOKENS && decoded.link) return decoded;
  return null;
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error("Not allowed by CORS"), false);
  }
}));

app.use((err, req, res, next) => {
  if (err && err.message && err.message.includes("CORS")) {
    res.status(403).json({ error: "Origine non autorisée." });
    return;
  }
  next(err);
});

function rateLimit(req, res, next) {
  const ip = (req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim() || "unknown";
  const now = Date.now();
  const entry = rateStore.get(ip);
  if (!entry || now - entry.start > RATE_LIMIT_WINDOW_MS) {
    rateStore.set(ip, { start: now, count: 1 });
    return next();
  }
  entry.count += 1;
  if (entry.count > RATE_LIMIT_MAX) {
    res.status(429).json({ error: "Trop de requêtes. Réessayez plus tard." });
    return;
  }
  rateStore.set(ip, entry);
  if (rateStore.size > 2000) {
    for (const [key, value] of rateStore.entries()) {
      if (now - value.start > RATE_LIMIT_WINDOW_MS) {
        rateStore.delete(key);
      }
    }
  }
  next();
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    shortLinks: Boolean(UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN)
  });
});

app.post("/api/upload", rateLimit, (req, res) => {
  if (!process.env.MEGA_EMAIL || !process.env.MEGA_PASSWORD) {
    res.status(500).json({ error: "MEGA credentials missing" });
    return;
  }
  if (!(UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN) && !TOKEN_SECRET) {
    res.status(500).json({ error: "TOKEN_SECRET missing" });
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
    if (name === "customSlug") {
      req.customSlug = value;
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

    if (req.customSlug && !(UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN)) {
      res.status(400).json({ error: "Liens personnalisés indisponibles (configurer Upstash)." });
      fs.unlink(tempPath, () => {});
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
        const payload = {
          link,
          exp: expiresAt.toISOString(),
          name: originalName,
          size: stats.size
        };
        let tokenData = signPayload(payload);
        if (!tokenData) {
          res.status(500).json({ error: "Token signing failed" });
          fs.unlink(tempPath, () => {});
          return;
        }
        let token = base64UrlEncode(tokenData);
        let downloadUrl = `${base}/${token}`;

        if (UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN) {
          let shortCode = null;
          const customRaw = req.customSlug ? String(req.customSlug) : "";
          const customSlug = customRaw.trim();
          if (customSlug) {
            const valid = /^[A-Za-z0-9_-]{3,32}$/.test(customSlug);
            if (!valid) {
              res.status(400).json({ error: "Nom de lien invalide (3-32, lettres/chiffres/-/_)." });
              fs.unlink(tempPath, () => {});
              return;
            }
            const exists = await kvGet(customSlug);
            if (exists) {
              res.status(409).json({ error: "Ce nom de lien est déjà pris." });
              fs.unlink(tempPath, () => {});
              return;
            }
            shortCode = customSlug;
          }
          for (let i = 0; i < 5 && !shortCode; i++) {
            const candidate = generateShortCode(SHORT_CODE_LEN);
            const exists = await kvGet(candidate);
            if (!exists) {
              shortCode = candidate;
              break;
            }
          }
          if (shortCode) {
            const stored = payload;
            const ttlSeconds = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
            const storedOk = await kvSet(shortCode, stored, ttlSeconds);
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

    const originalName = file.name || "fichier";
    const fallbackName = asciiFilename(originalName);
    const encodedName = encodeURIComponent(originalName)
      .replace(/'/g, "%27")
      .replace(/\*/g, "%2A")
      .replace(/\(/g, "%28")
      .replace(/\)/g, "%29");

    res.setHeader("Content-Type", file.type || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`);

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
