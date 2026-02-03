(() => {
  const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const fallback = isLocal ? "http://localhost:5050" : "https://YOUR_RENDER_URL.onrender.com";
  window.TRANSFER_API_BASE = window.TRANSFER_API_BASE || fallback;
})();
