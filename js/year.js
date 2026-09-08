/* Año del footer, compartido por index.html, privacy.html y 404.html.
   Vive en su propio archivo (en vez de un <script> inline en cada página)
   para que esas páginas puedan tener la misma Content-Security-Policy que
   la portada sin necesitar "unsafe-inline" en script-src. */
(function () {
  "use strict";
  var el = document.getElementById("year");
  if (el) el.textContent = new Date().getFullYear();
})();
