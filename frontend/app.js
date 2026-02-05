const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const expirySelect = document.getElementById("expiry");
const uploadView = document.getElementById("uploadView");
const customSlugInput = document.getElementById("customSlug");
const slugPreview = document.getElementById("slugPreview");
const uploadBox = document.getElementById("upload");
const fileNameEl = document.getElementById("fileName");
const fileSizeEl = document.getElementById("fileSize");
const progressBar = document.getElementById("progressBar");
const uploadStatus = document.getElementById("uploadStatus");
const resultBox = document.getElementById("result");
const downloadLink = document.getElementById("downloadLink");
const copyBtn = document.getElementById("copyBtn");
const copyEmailBtn = document.getElementById("copyEmailBtn");
const openBtn = document.getElementById("openBtn");
const newBtn = document.getElementById("newBtn");
const expiryNote = document.getElementById("expiryNote");
const errorBox = document.getElementById("error");
const downloadView = document.getElementById("downloadView");
const downloadName = document.getElementById("downloadName");
const downloadSize = document.getElementById("downloadSize");
const downloadExpiry = document.getElementById("downloadExpiry");
const downloadRemaining = document.getElementById("downloadRemaining");
const downloadHint = document.getElementById("downloadHint");
const mainCard = document.getElementById("mainCard");
const dropIcon = document.getElementById("dropIcon");
const dropProgress = document.getElementById("dropProgress");
const startUploadBtn = document.getElementById("startUploadBtn");
const downloadStage1 = document.getElementById("downloadStage1");
const downloadStage2 = document.getElementById("downloadStage2");
const downloadCircleBtn = document.getElementById("downloadCircleBtn");
const downloadBubbleName = document.getElementById("downloadBubbleName");
const downloadBubbleMeta = document.getElementById("downloadBubbleMeta");
const downloadLogo = document.getElementById("downloadLogo");
const downloadCarousel = document.getElementById("downloadCarousel");
const retryDownloadBtn = document.getElementById("retryDownloadBtn");

let pendingFile = null;
let carouselTimer = null;
let currentDownloadUrl = null;
let currentProgress = 0;
let targetProgress = 0;
let progressAnimId = null;
let lastUploadMeta = null;

const API_BASE = window.TRANSFER_API_BASE;
const MAX_BYTES = 10 * 1024 * 1024 * 1024;

function applyBranding() {
  const ui = window.TRANSFER_UI || {};
  const logo = document.getElementById("brandLogo");
  const title = document.getElementById("brandTitle");
  const subtitle = document.getElementById("brandSubtitle");
  const meta = document.getElementById("brandMeta");
  const right = document.getElementById("brandRight");
  if (ui.logo && logo) logo.textContent = ui.logo;
  if (ui.logo && dropIcon) dropIcon.textContent = ui.logo;
  if (ui.logo && downloadLogo) downloadLogo.textContent = ui.logo;
  if (ui.title && title) title.textContent = ui.title;
  if (ui.subtitle && subtitle) subtitle.textContent = ui.subtitle;
  if (ui.meta && meta) meta.textContent = ui.meta;
  if (ui.rightLabel && right) right.textContent = ui.rightLabel;
  if (ui.accent) {
    document.documentElement.style.setProperty("--accent", ui.accent);
  }
}

function getPublicBase() {
  const ui = window.TRANSFER_UI || {};
  const base = ui.publicBase || `${window.location.origin}`;
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

function formatBytes(bytes) {
  const units = ["o", "Ko", "Mo", "Go", "To"];
  let idx = 0;
  let value = bytes;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }
  return `${value.toFixed(value < 10 && idx > 0 ? 1 : 0)} ${units[idx]}`;
}

function formatRemaining(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  if (days > 0) {
    return `${days} jour${days > 1 ? "s" : ""} restant${days > 1 ? "s" : ""}`;
  }
  if (hours > 0) {
    return `${hours} h restante${hours > 1 ? "s" : ""}`;
  }
  return "Moins d'1h restante";
}

function decodeTokenPayload(token) {
  try {
    const padded = token.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
    const json = atob(padded + pad);
    return JSON.parse(json);
  } catch (err) {
    return null;
  }
}

function resetUI() {
  document.body.classList.add("compact");
  document.body.classList.remove("download-mode");
  document.body.classList.remove("uploading");
  document.body.classList.remove("centered");
  document.body.classList.remove("download-step-2");
  document.body.classList.add("download-step-1");
  if (uploadView) uploadView.classList.add("compact");
  if (mainCard) mainCard.classList.add("compact");
  uploadBox.hidden = true;
  resultBox.hidden = true;
  errorBox.hidden = true;
  progressBar.style.width = "0%";
  if (dropzone) {
    dropzone.style.setProperty("--progress", "0%");
  }
  if (dropProgress) dropProgress.textContent = "0%";
  currentProgress = 0;
  targetProgress = 0;
  if (progressAnimId) {
    cancelAnimationFrame(progressAnimId);
    progressAnimId = null;
  }
  uploadStatus.textContent = "En attente...";
  expiryNote.textContent = "Le lien reste valide tant que le fichier existe sur Mega.";
  if (downloadView) downloadView.hidden = true;
  if (uploadView) uploadView.hidden = false;
  if (startUploadBtn) startUploadBtn.disabled = true;
  pendingFile = null;
  lastUploadMeta = null;
  currentDownloadUrl = null;
  if (downloadStage1) downloadStage1.hidden = false;
  if (downloadStage2) downloadStage2.hidden = true;
  if (carouselTimer) {
    clearInterval(carouselTimer);
    carouselTimer = null;
  }
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function normalizeSlug(value) {
  return (value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9_-]/g, "");
}

function updateSlugPreview() {
  if (!customSlugInput || !slugPreview) return;
  const normalized = normalizeSlug(customSlugInput.value || "monfichier");
  const base = getPublicBase();
  slugPreview.textContent = `${base}/${normalized}`;
}

function getTokenFromPath() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (!parts.length) return null;
  const last = parts[parts.length - 1];
  if (!last || last === "index.html" || last === "404.html") return null;
  if (last === "frontend") return null;
  if (last.includes(".")) return null;
  if (last.length < 3) return null;
  return last;
}

async function showDownloadView(token) {
  resetUI();
  document.body.classList.add("download-mode");
  document.body.classList.remove("compact");
  document.body.classList.add("centered");
  document.body.classList.add("download-step-1");
  document.body.classList.remove("download-step-2");
  if (uploadView) uploadView.hidden = true;
  if (downloadView) downloadView.hidden = false;
  if (downloadStage1) downloadStage1.hidden = false;
  if (downloadStage2) downloadStage2.hidden = true;
  if (downloadHint) downloadHint.textContent = "Cliquez sur le rond pour télécharger.";
  currentDownloadUrl = `${API_BASE}/dl/${token}`;
  downloadName.textContent = "Fichier";
  downloadSize.textContent = "";
  downloadExpiry.textContent = "";
  downloadRemaining.textContent = "";
  if (downloadBubbleName) downloadBubbleName.textContent = "Fichier";
  if (downloadBubbleMeta) downloadBubbleMeta.textContent = "1 fichier";

  const payload = decodeTokenPayload(token);
  if (payload && payload.exp) {
    const expDate = new Date(payload.exp);
    if (Number.isFinite(expDate.getTime())) {
      downloadExpiry.textContent = `Expire le ${expDate.toLocaleDateString("fr-FR")}.`;
      downloadRemaining.textContent = formatRemaining(expDate.getTime() - Date.now());
      if (Date.now() > expDate.getTime()) {
        downloadRemaining.textContent = "Lien expiré.";
      if (downloadHint) downloadHint.textContent = "Lien expiré.";
      return;
    }
  }
  }

  try {
    const res = await fetch(`${API_BASE}/api/info/${token}`);
    if (res.status === 410) {
      downloadRemaining.textContent = "Lien expiré.";
    if (downloadHint) downloadHint.textContent = "Lien expiré.";
    return;
  }
    if (!res.ok) throw new Error("invalid");
    const data = await res.json();
    downloadName.textContent = data.name || "Fichier";
    if (data.size != null) {
      downloadSize.textContent = formatBytes(data.size);
      if (downloadBubbleMeta) {
        downloadBubbleMeta.textContent = `${formatBytes(data.size)} • 1 fichier`;
      }
    }
    if (downloadBubbleName) downloadBubbleName.textContent = data.name || "Fichier";
    if (data.expiresAt) {
      const expDate = new Date(data.expiresAt);
      downloadExpiry.textContent = `Expire le ${expDate.toLocaleDateString("fr-FR")}.`;
      downloadRemaining.textContent = formatRemaining(expDate.getTime() - Date.now());
    }
    if (downloadHint) downloadHint.textContent = "Cliquez sur le rond pour télécharger.";
  } catch (err) {
    if (downloadHint) downloadHint.textContent = "Cliquez sur le rond pour télécharger.";
  }
}

function prepareFile(file) {
  resetUI();
  if (!file) return;
  if (file.size > MAX_BYTES) {
    showError("Fichier trop volumineux (max 10 Go).");
    return;
  }

  document.body.classList.remove("compact");
  document.body.classList.remove("download-mode");
  document.body.classList.add("centered");
  if (uploadView) uploadView.classList.remove("compact");
  if (mainCard) mainCard.classList.remove("compact");
  if (downloadView) downloadView.hidden = true;
  pendingFile = file;
  if (startUploadBtn) startUploadBtn.disabled = false;
}

function startUpload(file) {
  if (!file) return;
  document.body.classList.add("uploading");
  uploadBox.hidden = false;
  fileNameEl.textContent = file.name;
  fileSizeEl.textContent = formatBytes(file.size);

  const expiresInDays = parseInt(expirySelect.value, 10);
  const customSlug = normalizeSlug(customSlugInput ? customSlugInput.value : "");
  const formData = new FormData();
  formData.append("file", file);
  formData.append("expiresInDays", String(expiresInDays));
  if (customSlug) {
    formData.append("customSlug", customSlug);
  }

  const xhr = new XMLHttpRequest();
  xhr.open("POST", `${API_BASE}/api/upload`);
  xhr.upload.addEventListener("progress", (event) => {
    if (!event.lengthComputable) return;
    const pct = Math.min(100, Math.max(0, (event.loaded / event.total) * 100));
    targetProgress = pct;
    if (!progressAnimId) {
      progressAnimId = requestAnimationFrame(animateProgress);
    }
    uploadStatus.textContent = `Envoi en cours... ${Math.round(pct)}%`;
  });
  xhr.addEventListener("load", () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      const data = JSON.parse(xhr.responseText);
      targetProgress = 100;
      if (!progressAnimId) {
        progressAnimId = requestAnimationFrame(animateProgress);
      }
      uploadStatus.textContent = "Upload terminé";
      document.body.classList.remove("uploading");
      resultBox.hidden = false;
      downloadLink.value = data.downloadUrl;
      openBtn.href = data.downloadUrl;
      lastUploadMeta = {
        name: file.name,
        size: file.size,
        expiresAt: data.expiresAt || null,
        downloadUrl: data.downloadUrl
      };
      if (data.expiresAt) {
        const date = new Date(data.expiresAt);
        expiryNote.textContent = `Lien valide jusqu'au ${date.toLocaleDateString("fr-FR")}.`;
      }
    } else {
      document.body.classList.remove("uploading");
      try {
        const data = JSON.parse(xhr.responseText || "{}");
        if (data && data.error) {
          showError(data.error);
        } else {
          showError("Erreur pendant l'upload.");
        }
      } catch (err) {
        showError("Erreur pendant l'upload.");
      }
    }
  });
  xhr.addEventListener("error", () => {
    document.body.classList.remove("uploading");
    showError("Impossible de contacter le serveur.");
  });
  xhr.addEventListener("timeout", () => {
    document.body.classList.remove("uploading");
    showError("Temps dépassé. Réessaie.");
  });

  xhr.send(formData);
}

function animateProgress() {
  const diff = targetProgress - currentProgress;
  if (Math.abs(diff) < 0.1) {
    currentProgress = targetProgress;
  } else {
    currentProgress += diff * 0.15;
  }
  const pct = Math.round(currentProgress);
  progressBar.style.width = `${pct}%`;
  if (dropzone) {
    dropzone.style.setProperty("--progress", `${pct}%`);
  }
  if (dropProgress) {
    dropProgress.textContent = `${pct}%`;
  }
  if (Math.abs(targetProgress - currentProgress) < 0.1) {
    progressAnimId = null;
  } else {
    progressAnimId = requestAnimationFrame(animateProgress);
  }
}

async function initCarousel() {
  if (!downloadCarousel) return;
  const ui = window.TRANSFER_UI || {};
  let images = [];
  if (ui.galleryEndpoint) {
    try {
      const res = await fetch(ui.galleryEndpoint, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) images = data;
      }
    } catch (err) {
      images = [];
    }
  }
  if (!images.length) {
    images = Array.isArray(ui.gallery) ? ui.gallery : [];
  }
  const placeholders = [
    "linear-gradient(135deg, #f4b07a, #e98c6a)",
    "linear-gradient(135deg, #8fb4d8, #6b8fb0)",
    "linear-gradient(135deg, #f0e0c5, #d9c4a0)",
  ];

  downloadCarousel.innerHTML = "";
  const slides = (images.length ? images : placeholders).map((item, idx) => {
    const slide = document.createElement("div");
    slide.className = `carousel-slide${idx === 0 ? " active" : ""}`;
    if (item.startsWith("http") || item.startsWith("data:")) {
      slide.style.backgroundImage = `url('${item}')`;
    } else {
      slide.style.backgroundImage = item;
    }
    downloadCarousel.appendChild(slide);
    return slide;
  });

  let activeIndex = 0;
  if (carouselTimer) clearInterval(carouselTimer);
  carouselTimer = setInterval(() => {
    if (!slides.length) return;
    slides[activeIndex].classList.remove("active");
    activeIndex = (activeIndex + 1) % slides.length;
    slides[activeIndex].classList.add("active");
  }, 4000);
}

function triggerDownload() {
  if (!currentDownloadUrl) return;
  let frame = document.getElementById("downloadFrame");
  if (!frame) {
    frame = document.createElement("iframe");
    frame.id = "downloadFrame";
    frame.style.display = "none";
    frame.title = "Téléchargement";
    document.body.appendChild(frame);
  }
  frame.src = currentDownloadUrl;
}

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(downloadLink.value);
    copyBtn.textContent = "Copié";
    setTimeout(() => (copyBtn.textContent = "Copier"), 1500);
  } catch (err) {
    showError("Copie impossible.");
  }
});

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildEmailText(meta) {
  const lines = [];
  lines.push(`${meta.name}`);
  if (meta.size != null) {
    lines.push(`Poids : ${formatBytes(meta.size)}`);
  }
  if (meta.expiresAt) {
    const date = new Date(meta.expiresAt);
    lines.push(`Expire le : ${date.toLocaleDateString("fr-FR")}`);
  }
  lines.push(`Lien : ${meta.downloadUrl}`);
  lines.push("Télécharger : " + meta.downloadUrl);
  return lines.join("\\n");
}

function buildEmailHtml(meta) {
  const safeName = escapeHtml(meta.name || "Fichier");
  const safeUrl = escapeHtml(meta.downloadUrl || "");
  const size = meta.size != null ? formatBytes(meta.size) : "—";
  const expires = meta.expiresAt
    ? new Date(meta.expiresAt).toLocaleDateString("fr-FR")
    : "—";
  return `
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;border-collapse:separate;border-spacing:0;font-family:'AntoineDisplay','Helvetica Neue',Helvetica,Arial,sans-serif;color:#111;letter-spacing:-0.01em;">
  <tr>
    <td style="padding:18px 20px;border:1px solid #e3e3e3;border-radius:18px;background:#f7f7f7;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="width:60%;vertical-align:top;padding-right:14px;">
            <div style="font-size:16px;line-height:1.35;margin:0 0 8px 0;">${safeName}</div>
            <div style="font-size:13px;line-height:1.5;margin:0 0 4px 0;">Poids&nbsp;: ${escapeHtml(size)}</div>
            <div style="font-size:13px;line-height:1.5;margin:0 0 4px 0;">Expire le&nbsp;: ${escapeHtml(expires)}</div>
          </td>
          <td style="width:40%;vertical-align:top;text-align:right;">
            <a href="${safeUrl}" style="display:inline-block;padding:9px 14px;border-radius:999px;background:#ff4500;color:#111;text-decoration:none;font-size:13px;line-height:1.2;">Télécharger</a>
            <div style="font-size:11px;line-height:1.5;margin:10px 0 0 0;color:#444;word-break:break-all;">
              <a href="${safeUrl}" style="color:#111;text-decoration:none;">${safeUrl}</a>
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
`.trim();
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
      document.body.removeChild(textarea);
      return true;
    } catch (err2) {
      document.body.removeChild(textarea);
      return false;
    }
  }
}

async function copyHtmlToClipboard(html, textFallback) {
  if (navigator.clipboard && window.ClipboardItem) {
    try {
      const item = new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([textFallback], { type: "text/plain" }),
      });
      await navigator.clipboard.write([item]);
      return true;
    } catch (err) {
      return copyToClipboard(textFallback);
    }
  }
  return copyToClipboard(textFallback);
}

if (copyEmailBtn) {
  copyEmailBtn.addEventListener("click", async () => {
    if (!lastUploadMeta) {
      showError("Aucun fichier à copier pour l'instant.");
      return;
    }
    const html = buildEmailHtml(lastUploadMeta);
    const text = buildEmailText(lastUploadMeta);
    const ok = await copyHtmlToClipboard(html, text);
    if (ok) {
      const original = copyEmailBtn.textContent;
      copyEmailBtn.textContent = "Copié";
      setTimeout(() => (copyEmailBtn.textContent = original), 1500);
    } else {
      showError("Copie impossible.");
    }
  });
}

newBtn.addEventListener("click", () => {
  fileInput.value = "";
  resetUI();
});

if (customSlugInput) {
  customSlugInput.addEventListener("input", updateSlugPreview);
  updateSlugPreview();
}

fileInput.addEventListener("change", (event) => {
  prepareFile(event.target.files[0]);
});

dropzone.addEventListener("click", () => {
  if (pendingFile && startUploadBtn && !startUploadBtn.disabled) {
    startUpload(pendingFile);
    return;
  }
  fileInput.click();
});

dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("dragover");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("dragover");
});

dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("dragover");
  prepareFile(event.dataTransfer.files[0]);
});

if (startUploadBtn) {
  startUploadBtn.addEventListener("click", () => {
    startUpload(pendingFile);
  });
}

if (downloadCircleBtn) {
  downloadCircleBtn.addEventListener("click", () => {
    triggerDownload();
    if (downloadHint) downloadHint.textContent = "Téléchargement en cours...";
    document.body.classList.remove("download-step-1");
    document.body.classList.add("download-step-2");
    if (downloadStage1) downloadStage1.hidden = true;
    if (downloadStage2) downloadStage2.hidden = false;
    initCarousel();
  });

  downloadCircleBtn.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      downloadCircleBtn.click();
    }
  });
}

if (retryDownloadBtn) {
  retryDownloadBtn.addEventListener("click", () => {
    triggerDownload();
    if (downloadHint) downloadHint.textContent = "Téléchargement relancé...";
  });
}

applyBranding();
const token = getTokenFromPath();
if (token) {
  showDownloadView(token);
} else {
  resetUI();
}
