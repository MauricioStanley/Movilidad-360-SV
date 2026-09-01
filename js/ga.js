/* Arranque de Google Analytics (GA4). Antes vivía como <script> inline en
   index.html; se movió a un archivo aparte para poder aplicar una Política
   de Seguridad de Contenido (CSP) sin tener que permitir scripts inline
   ('unsafe-inline'), que es justo el tipo de hueco que un XSS aprovecha. */
window.dataLayer = window.dataLayer || [];
function gtag() {
  dataLayer.push(arguments);
}
gtag("js", new Date());
gtag("config", "G-F59WF19VVM");
