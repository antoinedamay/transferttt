(() => {
  const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const fallback = isLocal ? "http://localhost:5050" : "https://transfert-backend.onrender.com";
  window.TRANSFER_API_BASE = window.TRANSFER_API_BASE || fallback;
})();

window.TRANSFER_UI = window.TRANSFER_UI || {
  logo: "T",
  title: "Transfert",
  subtitle: "Envoi de fichiers simple, rapide, propre.",
  meta: "Max 10 Go • Stockage Mega",
  accent: "#ffb000",
  publicBase: "https://transfert.antoinedamay.fr"
};
