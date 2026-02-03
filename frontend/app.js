const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const expirySelect = document.getElementById("expiry");
const uploadBox = document.getElementById("upload");
const fileNameEl = document.getElementById("fileName");
const fileSizeEl = document.getElementById("fileSize");
const progressBar = document.getElementById("progressBar");
const uploadStatus = document.getElementById("uploadStatus");
const resultBox = document.getElementById("result");
const downloadLink = document.getElementById("downloadLink");
const copyBtn = document.getElementById("copyBtn");
const openBtn = document.getElementById("openBtn");
const newBtn = document.getElementById("newBtn");
const expiryNote = document.getElementById("expiryNote");
const errorBox = document.getElementById("error");

const API_BASE = window.TRANSFER_API_BASE;
const MAX_BYTES = 10 * 1024 * 1024 * 1024;

function maybeRedirectFromToken() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last || last.includes(".")) return;
  if (last === "frontend" || last === "index.html") return;
  if (last.length < 16) return;
  window.location.href = `${API_BASE}/dl/${last}`;
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

function resetUI() {
  uploadBox.hidden = true;
  resultBox.hidden = true;
  errorBox.hidden = true;
  progressBar.style.width = "0%";
  uploadStatus.textContent = "En attente...";
  expiryNote.textContent = "Le lien reste valide tant que le fichier existe sur Mega.";
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function handleFile(file) {
  resetUI();
  if (!file) return;
  if (file.size > MAX_BYTES) {
    showError("Fichier trop volumineux (max 10 Go).");
    return;
  }

  uploadBox.hidden = false;
  fileNameEl.textContent = file.name;
  fileSizeEl.textContent = formatBytes(file.size);

  const expiresInDays = parseInt(expirySelect.value, 10);
  const formData = new FormData();
  formData.append("file", file);
  formData.append("expiresInDays", String(expiresInDays));

  const xhr = new XMLHttpRequest();
  xhr.open("POST", `${API_BASE}/api/upload`);
  xhr.upload.addEventListener("progress", (event) => {
    if (!event.lengthComputable) return;
    const pct = Math.round((event.loaded / event.total) * 100);
    progressBar.style.width = `${pct}%`;
    uploadStatus.textContent = `Envoi en cours... ${pct}%`;
  });
  xhr.addEventListener("load", () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      const data = JSON.parse(xhr.responseText);
      uploadStatus.textContent = "Upload terminé";
      resultBox.hidden = false;
      downloadLink.value = data.downloadUrl;
      openBtn.href = data.downloadUrl;
      if (data.expiresAt) {
        const date = new Date(data.expiresAt);
        expiryNote.textContent = `Lien valide jusqu'au ${date.toLocaleDateString("fr-FR")}.`;
      }
    } else {
      showError("Erreur pendant l'upload.");
    }
  });
  xhr.addEventListener("error", () => {
    showError("Impossible de contacter le serveur.");
  });
  xhr.addEventListener("timeout", () => {
    showError("Temps dépassé. Réessaie.");
  });

  xhr.send(formData);
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

newBtn.addEventListener("click", () => {
  fileInput.value = "";
  resetUI();
});

fileInput.addEventListener("change", (event) => {
  handleFile(event.target.files[0]);
});

dropzone.addEventListener("click", () => fileInput.click());

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
  handleFile(event.dataTransfer.files[0]);
});

maybeRedirectFromToken();
resetUI();
