(() => {
  const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const fallback = isLocal ? "http://localhost:5050" : "https://transfert-backend.onrender.com";
  window.TRANSFER_API_BASE = window.TRANSFER_API_BASE || fallback;
})();
