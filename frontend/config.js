(() => {
  const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const fallback = isLocal ? "http://localhost:5050" : "https://transfert-backend.onrender.com";
  window.TRANSFER_API_BASE = window.TRANSFER_API_BASE || fallback;
})();

window.TRANSFER_UI = window.TRANSFER_UI || {
  logo: "T",
  title: "transfert",
  rightLabel: "antoine damay",
  accent: "#ff4500",
  publicBase: "https://transfert.antoinedamay.fr",
  galleryEndpoint: "https://antoinedamay.fr/carousel.php",
  gallery: [
    "https://antoinedamay.fr/images/escp_01.jpg",
    "https://antoinedamay.fr/images/rdr26_01.jpg",
    "https://antoinedamay.fr/images/feh24_01.jpg",
    "https://antoinedamay.fr/images/etranger_.jpg",
    "https://antoinedamay.fr/images/pc_2.jpg",
    "https://antoinedamay.fr/images/virage_1.jpg",
    "https://antoinedamay.fr/images/diplome_1.jpg",
    "https://antoinedamay.fr/images/hg_1.jpg",
    "https://antoinedamay.fr/images/chri_1.jpg",
    "https://antoinedamay.fr/images/athenea_3.jpg",
    "https://antoinedamay.fr/images/jpo2021_3.jpg",
    "https://antoinedamay.fr/images/conf_1.jpg",
    "https://antoinedamay.fr/images/cci_8.jpg",
    "https://antoinedamay.fr/images/grillade_2.jpg",
    "https://antoinedamay.fr/images/cata_3.jpg",
    "https://antoinedamay.fr/images/organique_3.png",
    "https://antoinedamay.fr/images/article_2.jpg",
    "https://antoinedamay.fr/images/pliade_3.jpg",
    "https://antoinedamay.fr/images/leon_1.jpg",
    "https://antoinedamay.fr/images/escaut_1.jpg"
  ]
};
