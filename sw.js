/* Service worker mínimo: cachea el shell básico para que el sitio sea
   instalable ("Agregar a pantalla de inicio"). Estrategia RED PRIMERO:
   si hay internet siempre se sirve la versión más nueva del servidor y la
   caché queda solo como respaldo offline. Así cada actualización del sitio
   se refleja de inmediato, sin tener que recargar dos veces. */
const CACHE_NAME = "movilidad360-shell-v6";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./css/styles.css?v=6",
  "./js/data.js?v=6",
  "./js/app.js?v=6",
  "./js/enhance.js?v=6",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // no interceptar OSRM/Nominatim/tiles/fuentes

  // "no-store" fuerza a que el navegador siempre pida la versión real al
  // servidor, ignorando su propia caché HTTP (GitHub Pages permite
  // cachear hasta 10 min) — así "red primero" es red primero de verdad.
  event.respondWith(
    fetch(event.request, { cache: "no-store" })
      .then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
