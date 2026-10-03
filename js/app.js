/* =========================================================================
   MOVILIDAD 360 SV — app.js
   Sitio 100% estático (GitHub Pages). Las cotizaciones usan la distancia
   REAL de la ruta por carretera (servicio de enrutamiento OSRM, basado en
   OpenStreetMap) cuando está disponible; si el servicio de ruteo no
   responde, se usa un cálculo aproximado en línea recta como respaldo,
   siempre marcado como "aproximado" para el cliente. El mensaje final se
   arma y se envía como WhatsApp pre-escrito para que el equipo confirme.
   ========================================================================= */

(function () {
  "use strict";

  /* ---------------- Instalar como app (PWA) ----------------
     El navegador dispara "beforeinstallprompt" (Chrome/Android/Edge) antes
     de que el DOM termine de cargar, así que hay que capturarlo desde ya,
     fuera de DOMContentLoaded, para no perderlo. */
  let deferredInstallPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
  });

  /* ---------------- Utilidades ---------------- */
  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

  function norm(str) {
    return (str || "")
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  // Escapa texto antes de insertarlo en innerHTML. Se usa en todo lo que
  // viene de fuera de nuestro propio data.js (lo que el cliente escribe en
  // los buscadores, y los nombres de lugar que devuelve Nominatim/OSM), para
  // que un texto con caracteres < > " ' nunca se interprete como HTML.
  function escapeHtml(str) {
    return (str == null ? "" : String(str)).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  // Neutraliza caracteres de formato de WhatsApp (*negrita*, _cursiva_,
  // ~tachado~, `monoespaciado`) y saltos de línea sueltos en texto que NO
  // escribió el propio cliente, sino que viene de un tercero (nombres de
  // lugar de Nominatim/OpenStreetMap). Sin esto, un nombre de lugar
  // manipulado en OSM podría romper el formato del mensaje que le llega al
  // equipo por WhatsApp, o simular líneas/etiquetas que no existen (ej.
  // fingir un "*Precio:*" adicional). No se aplica a lo que el cliente
  // escribe a mano (notas, nombre del destinatario, etc.): ese texto es
  // suyo y ya lo puede formatear como quiera directo en WhatsApp.
  function sanitizeWaText(str) {
    return (str == null ? "" : String(str))
      .replace(/[\r\n]+/g, " ")
      .replace(/\*/g, "•")
      .replace(/_/g, "-")
      .replace(/~/g, "-")
      .replace(/`/g, "'")
      .trim();
  }

  function debounce(fn, wait) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Factor de corrección de línea recta -> carretera (curvas, cuadras, etc.).
  // Se usa tanto en el respaldo de fetchRoute() como en los precios "desde"
  // que se muestran ANTES de calcular la ruta calculada, para que ambos números
  // se acerquen entre sí (antes, el "desde" salía sistemáticamente más bajo
  // que el precio final, porque solo fetchRoute() aplicaba esta corrección).
  const ROAD_CURVE_FACTOR = 1.35;
  function estimateRoadKm(straightLineKm) {
    return straightLineKm * ROAD_CURVE_FACTOR;
  }

  function pickSpeed(distanceKm) {
    return distanceKm <= 18 ? CONFIG.avgSpeedKmh.city : CONFIG.avgSpeedKmh.highway;
  }

  function estimateMinutes(distanceKm) {
    const speed = pickSpeed(distanceKm);
    // +6 min de "colchón" por abordaje / tráfico local
    return Math.max(5, Math.round((distanceKm / speed) * 60) + 6);
  }

  // Tarifa progresiva por tramos (estilo inDrive): a cada kilómetro se le
  // cobra la tarifa del tramo en el que cae, no la tarifa del tramo final
  // a toda la distancia — igual que una tabla de impuestos por escalones.
  function tieredDistancePrice(distanceKm) {
    return M360Core.distancePrice(distanceKm, CONFIG);
  }

  function estimatePrice(distanceKm, pets) {
    // Tarifa mínima: sin esto, un trayecto muy corto (o un origen y destino
    // que caigan casi en el mismo punto, ej. el origen por defecto y un
    // destino con las mismas coordenadas) podía cotizar $0.00 — un precio
    // real que le llegaba al equipo por WhatsApp. CONFIG.minFareUsd es un
    // valor de partida razonable; ajústalo si el negocio quiere otro piso.
    return M360Core.breakdown(distanceKm, pets, CONFIG).total;
  }

  function formatMoney(n) {
    return "$" + n.toFixed(2);
  }

  function formatEta(min) {
    if (min < 60) return `~${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `~${h}h${m > 0 ? " " + m + "min" : ""}`;
  }

  function waLink(message) {
    return `https://wa.me/${CONFIG.whatsappNumber}?text=${encodeURIComponent(message)}`;
  }

  /* ---------------- Carga diferida de Leaflet ----------------
     Leaflet (mapa) solo se descarga la primera vez que realmente se
     necesita: al abrir el selector de mapa o al llegar a la sección de
     cobertura. Esto evita cargar ~150kb de más en cada visita que no
     use el mapa. */
  let leafletLoadingPromise = null;
  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    if (leafletLoadingPromise) return leafletLoadingPromise;
    leafletLoadingPromise = new Promise((resolve, reject) => {
      const cssLink = document.createElement("link");
      cssLink.rel = "stylesheet";
      cssLink.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      cssLink.integrity = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
      cssLink.crossOrigin = "";
      document.head.appendChild(cssLink);

      const script = document.createElement("script");
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.integrity = "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=";
      script.crossOrigin = "";
      const timer = setTimeout(() => script.onerror(), 10000);
      script.onload = () => { clearTimeout(timer); resolve(); };
      script.onerror = () => {
        clearTimeout(timer);
        script.remove(); cssLink.remove(); leafletLoadingPromise = null;
        reject(new Error("No se pudo cargar el mapa. Comprueba tu conexión y vuelve a abrirlo."));
      };
      document.body.appendChild(script);
    });
    return leafletLoadingPromise;
  }

  /* ---------------- Ruteo calculada por carretera (OSRM) ----------------
     OSRM (router.project-osrm.org) es un servicio público y gratuito de
     ruteo basado en OpenStreetMap, sin necesidad de API key. Si no
     responde a tiempo (o el navegador está sin internet), se usa un
     respaldo en línea recta con un factor de corrección, y se marca la
     cotización como "aproximada" para que quede claro que no es la
     distancia calculada de manejo. */
  const routeCache = new Map();

  async function fetchRoute(origin, dest) {
    if (!M360Core.validPoint(origin) || !M360Core.validPoint(dest)) throw new Error("Confirma ambos puntos antes de calcular.");
    const key = `${origin.lat.toFixed(5)},${origin.lng.toFixed(5)}|${dest.lat.toFixed(5)},${dest.lng.toFixed(5)}`;
    if (routeCache.has(key) && Date.now() - routeCache.get(key).calculatedAt < 10 * 60 * 1000) return routeCache.get(key);

    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${origin.lng},${origin.lat};${dest.lng},${dest.lat}` +
      `?overview=full&geometries=geojson`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);

    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error("routing-http-error");
      const data = await res.json();
      const route = data.routes && data.routes[0];
      if (data.code !== 'Ok' || !route || !Number.isFinite(route.distance) || route.distance < 0 ||
          !Number.isFinite(route.duration) || route.duration < 0 || !Array.isArray(route.geometry?.coordinates) ||
          route.geometry.coordinates.length < 2 || route.geometry.coordinates.some(p=>!M360Core.validPoint({lat:p[1],lng:p[0]}))) throw new Error("invalid-route");
      if (data.waypoints?.some(p=>!Number.isFinite(p.distance) || p.distance > 500)) throw new Error("road-access-too-far");
      clearTimeout(timeoutId);
      const result = {
        distanceKm: route.distance / 1000,
        minutes: Math.max(5, Math.round(route.duration / 60) + 6),
        coords: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
        real: true,
        calculatedAt: Date.now(),
      };
      if (routeCache.size >= 60) routeCache.delete(routeCache.keys().next().value);
      routeCache.set(key, result);
      return result;
    } catch (err) {
      clearTimeout(timeoutId);
      // Respaldo: línea recta corregida (aproxima curvas de carretera)
      const distanceKm = estimateRoadKm(haversineKm(origin.lat, origin.lng, dest.lat, dest.lng));
      return {
        distanceKm,
        minutes: estimateMinutes(distanceKm),
        coords: null,
        real: false,
        calculatedAt: Date.now(),
      };
    }
  }

  /* ---------------- Ubicación del usuario ---------------- */
  let userLocation = null;
  let userLocationPlaceName = null; // texto legible (reverse geocoding), si se pudo obtener
  let originSource = null; // "gps" | "search" — para no decir "tu ubicación" cuando el origen fue buscado

  function currentOrigin() {
    return userLocation || CONFIG.originFallback;
  }
  function originLabel() {
    if (userLocation) {
      if (originSource === "search") return userLocationPlaceName || "Origen elegido";
      return userLocationPlaceName ? `Tu ubicación (${userLocationPlaceName})` : "Tu ubicación actual";
    }
    return CONFIG.originFallback.name;
  }
  // Enlace de Waze que abre navegación turno-a-turno directo hacia el
  // punto donde está el cliente. Waze siempre traza la ruta desde la
  // ubicación real del teléfono que abre el enlace en ese momento, así
  // que el conductor solo lo toca y le sale la ruta desde donde esté
  // parado hacia el cliente — no hace falta indicarle un punto de partida.
  function wazeLink(lat, lng) {
    return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
  }
  function originWazeLink() {
    return userLocation ? wazeLink(userLocation.lat, userLocation.lng) : null;
  }
  function pointWazeLink(point) {
    return point ? wazeLink(point.lat, point.lng) : null;
  }

  // Convierte coordenadas en una referencia legible (colonia/calle) usando
  // Nominatim (OpenStreetMap), gratuito y sin API key. Es un "mejor esfuerzo":
  // si falla o tarda, simplemente no se agrega el nombre y se sigue usando
  // el enlace de Waze como punto de referencia.
  async function reverseGeocode(lat, lng) {
    const name = await M360Geo.reverse({ lat, lng });
    return name ? sanitizeWaText(name) : null;
  }

  // Búsqueda de direcciones reales (Nominatim/OpenStreetMap) — respaldo
  // cuando el lugar que el cliente escribe no está en nuestra lista
  // curada de sitios populares. Así puede pedir un viaje a cualquier
  // dirección real de El Salvador aunque no sepa marcarla en el mapa.
  async function geocodeSearch(query, options) {
    return (await M360Geo.search(query, options)).map(p=>({ ...p, name:sanitizeWaText(p.name), fullName:sanitizeWaText(p.fullName) }));
  }

  let originGeneration = 0;
  function requestGeolocation(cb) {
    const generation = ++originGeneration;
    const statusEl = $("#geo-status");
    const bannerEl = $(".geo-banner");
    if (!navigator.geolocation) {
      if (statusEl) statusEl.textContent = "Tu navegador no permite compartir ubicación. Busca tu punto de salida.";
      cb(false);
      return;
    }
    if (statusEl) statusEl.textContent = "Buscando tu ubicación…";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (generation !== originGeneration) return;
        userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        userLocationPlaceName = null;
        originSource = "gps";
        if (statusEl) statusEl.textContent = "Ubicación confirmada. Este será el punto de salida de los viajes de pasajeros.";
        if (bannerEl) bannerEl.classList.add("located");
        const originInput = $("#origin-search-input");
        if (originInput) originInput.value = "";
        cb(true);
        reverseGeocode(userLocation.lat, userLocation.lng).then((name) => {
          if (name && generation === originGeneration) {
            userLocationPlaceName = name;
            if (originInput) originInput.value = name;
            if (statusEl) statusEl.textContent = `Salida confirmada: ${name}.`;
            refreshAllQuotesForNewOrigin(); persistAll();
          }
        });
        persistAll();
      },
      () => {
        if (generation !== originGeneration) return;
        if (statusEl) statusEl.textContent = userLocation ? `No se pudo actualizar el GPS. Conservamos tu salida: ${originLabel()}.` : "No pudimos acceder al GPS. Busca tu punto de salida o vuelve a intentarlo.";
        if (bannerEl) bannerEl.classList.toggle("located", !!userLocation);
        cb(false);
      },
      { timeout: 8000, maximumAge: 60000 }
    );
  }

  // El origen también se puede elegir buscando una dirección (igual que se
  // busca el destino), no solo con la ubicación GPS del celular — útil
  // cuando el viaje sale de otro lugar (ej. la casa de otra persona).
  function selectOriginFromSearch(place) {
    if (!M360Core.validPoint(place)) return;
    originGeneration++;
    userLocation = { lat: place.lat, lng: place.lng };
    userLocationPlaceName = place.name;
    originSource = "search";
    const input = $("#origin-search-input");
    if (input) input.value = place.name;
    const list = $("#origin-suggestions");
    if (list) list.innerHTML = "";
    const statusEl = $("#geo-status");
    if (statusEl) statusEl.textContent = `Origen elegido: ${place.name}. Salida para viajes de pasajeros; tarifas fijas, encomiendas y mudanzas usan sus propios puntos.`;
    const bannerEl = $(".geo-banner");
    if (bannerEl) bannerEl.classList.add("located");
    refreshAllQuotesForNewOrigin();
    persistAll();
  }

    function wireOriginSearch() {
    const input = $("#origin-search-input");
    const list = $("#origin-suggestions");
    if (!input || !list) return;
    input.addEventListener('input', () => {
      originGeneration++;
      userLocation = null; userLocationPlaceName = null; originSource = null;
      $('.geo-banner').classList.remove('located');
      $('#geo-status').textContent = 'Confirma un resultado para usarlo como salida.';
      TRAVEL_PREFIXES.filter(p=>p!=='tarifafija').forEach(p=>invalidateQuote(p, 'Confirma el punto de salida.'));
      persistAll();
    });
    wireExplicitSearch(input, list, selectOriginFromSearch);
  }

  // Typing only filters local data. Network search always requires a click/Enter.
  function wireExplicitSearch(input, list, onSelect, querySuffix = '') {
    if (!input || !list || input.dataset.explicitSearch) return;
    input.dataset.explicitSearch = 'true'; input.maxLength = 180;
    list.setAttribute('aria-live', 'polite');
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'btn btn-outline-ink btn-sm address-search-button';
    button.textContent = 'Buscar dirección';
    button.setAttribute('aria-label', 'Buscar dirección: ' + (input.labels?.[0]?.textContent || input.placeholder || 'lugar'));
    input.insertAdjacentElement('afterend', button);
    let token = 0, controller = null;
    const choose = place => { token++; controller?.abort(); button.disabled = false; onSelect(place); };
    const local = () => {
      controller?.abort();
      token++; button.disabled = false;
      const q = norm(input.value);
      const places = [...LOCAL_PLACES, ...TOURIST_PLACES, ...AIRPORTS];
      const seen = new Set();
      const matches = q ? places.filter(p=>norm(p.name).includes(q) && !seen.has(p.name) && seen.add(p.name)).slice(0,5) : [];
      if (matches.length) renderSuggestionItems(list, matches, 'El Salvador · confirma este punto', choose);
      else list.innerHTML = '<p class="field-hint">Escribe un lugar y pulsa Buscar dirección. También puedes usar el mapa.</p>';
    };
    const run = async () => {
      if (button.disabled) return;
      const query = input.value.trim();
      if (query.length < 3) { list.textContent = 'Escribe al menos tres caracteres.'; input.focus(); return; }
      const request = ++token; button.disabled = true;
      controller?.abort(); controller = new AbortController();
      list.textContent = 'Buscando dirección…';
      trackEvent('address_search', { field: input.id });
      try {
        const results = await geocodeSearch(query + querySuffix + ', El Salvador', { signal: controller.signal });
        if (request !== token) return;
        if (results.length) renderSuggestionItems(list, results, null, choose);
        else list.innerHTML = '<p class="field-hint">No encontramos ese lugar. Añade el municipio o marca su ubicación en el mapa.</p>';
        const attribution = document.createElement('a');
        attribution.href = 'https://www.openstreetmap.org/copyright'; attribution.target = '_blank'; attribution.rel = 'noopener';
        attribution.className = 'field-hint'; attribution.textContent = 'Datos © OpenStreetMap'; list.appendChild(attribution);
      } catch (err) {
        if (request === token && err.code !== 'cancelled') list.textContent = err.message || 'No pudimos buscar. Revisa tu conexión y vuelve a intentarlo.';
        if (err.code !== 'cancelled') trackEvent('address_search_error', { reason: err.code || 'unknown' });
      } finally { if (request === token) button.disabled = false; }
    };
    input.addEventListener('input', local);
    input.addEventListener('keydown', e=>{ if (e.key === 'Enter') { e.preventDefault(); run(); } });
    button.addEventListener('click', run);
  }

  /* ---------------- Pasajeros y mascotas ----------------
     Se inyecta el mismo control (pasajeros + mascota) en las 4 paradas
     de viaje (no en encomiendas, que no lleva personas). */
  const TRAVEL_PREFIXES = ["movilizarte", "aeropuerto", "departamento", "turismo", "tarifafija"];
  const paxPetsState = {};

  function injectPaxPetsControls(prefix) {
    paxPetsState[prefix] = { pax: 1, pets: false };
    const panel = document.getElementById(`panel-${prefix}`);
    const quoteBox = document.getElementById(`quote-${prefix}`);
    if (!panel || !quoteBox) return;

    const row = document.createElement("div");
    row.className = "pax-pets-row";
    row.innerHTML = `
      <div class="stepper-group" role="group" aria-label="Número de pasajeros">
        <span class="field-label">Pasajeros</span>
        <div class="stepper">
          <button type="button" class="stepper-btn" data-dir="-1" aria-label="Restar un pasajero">−</button>
          <span class="stepper-value" id="pax-${prefix}" aria-live="polite">1</span>
          <button type="button" class="stepper-btn" data-dir="1" aria-label="Sumar un pasajero">+</button>
        </div>
      </div>
      <div class="switch-row pets-row">
        <span class="switch-label">¿Llevas mascota?</span>
        <button type="button" class="switch" id="pets-${prefix}" aria-pressed="false" aria-label="¿Llevas mascota?"></button>
      </div>
      <p class="pets-fee-warning" id="pets-fee-warning-${prefix}" hidden>Llevar mascota tiene un recargo de +${formatMoney(CONFIG.petFee)}.</p>
      <p class="field-hint" id="capacity-${prefix}" hidden>Para más de 4 pasajeros, el equipo debe confirmar capacidad y vehículo antes de aceptar el viaje.</p>
    `;
    panel.insertBefore(row, quoteBox);

    const valueEl = $(`#pax-${prefix}`, row);
    $$(".stepper-btn", row).forEach((btn) => {
      btn.addEventListener("click", () => {
        const dir = Number(btn.dataset.dir);
        const next = Math.min(8, Math.max(1, paxPetsState[prefix].pax + dir));
        paxPetsState[prefix].pax = next;
        valueEl.textContent = String(next);
        const capacity = $(`#capacity-${prefix}`);
        if (capacity) capacity.hidden = next <= 4;
        persistAll();
      });
    });

    const petsBtn = $(`#pets-${prefix}`, row);
    const petsWarning = $(`#pets-fee-warning-${prefix}`, row);
    petsBtn.addEventListener("click", () => {
      petsBtn.classList.toggle("on");
      paxPetsState[prefix].pets = petsBtn.classList.contains("on");
      petsBtn.setAttribute("aria-pressed", String(paxPetsState[prefix].pets));
      if (petsWarning) petsWarning.hidden = !paxPetsState[prefix].pets;
      persistAll();
      // La mascota suma un recargo fijo al precio: si ya hay una cotización
      // mostrada para esta parada, se recalcula al toque.
      recomputeQuoteForPets(prefix);
    });
  }

  // Vuelve a calcular el precio de la última cotización de una parada
  // cuando cambia si lleva mascota o no (el recargo por mascota se suma
  // al precio, así que hay que refrescar el número mostrado).
  function recomputeQuoteForPets(prefix) {
    if (prefix === "movilizarte" && lastMovilizarteSelection) selectMovilizarteDestination(lastMovilizarteSelection);
    else if (prefix === "aeropuerto" && lastAirportSelection) selectAirport(lastAirportSelection);
    else if (prefix === "departamento" && lastDepartmentSelection) selectDepartment(lastDepartmentSelection);
    else if (prefix === "turismo") {
      if (lastTourismRouteSelection) selectTouristRoute(lastTourismRouteSelection);
      else if (lastTourismSelection) selectTourism(lastTourismSelection);
    } else if (prefix === "tarifafija") updateFixedQuote();
  }

  function paxPetsFor(prefix) {
    const s = paxPetsState[prefix] || { pax: 1, pets: false };
    return { passengers: s.pax, pets: s.pets };
  }

  function applyPaxPetsUi(prefix, pax, pets) {
    pax = Math.min(8, Math.max(1, Number.isFinite(pax) ? Math.trunc(pax) : 1));
    pets = !!pets;
    paxPetsState[prefix] = { pax, pets };
    const capacity = $(`#capacity-${prefix}`);
    if (capacity) capacity.hidden = pax <= 4;
    const valueEl = $(`#pax-${prefix}`);
    if (valueEl) valueEl.textContent = String(pax);
    const petsBtn = $(`#pets-${prefix}`);
    if (petsBtn) {
      petsBtn.classList.toggle("on", pets);
      petsBtn.setAttribute("aria-pressed", String(pets));
    }
    const petsWarning = $(`#pets-fee-warning-${prefix}`);
    if (petsWarning) petsWarning.hidden = !pets;
  }

  /* ---------------- Cotización genérica ---------------- */
  const quoteRouteData = {}; // por prefijo: { originLatLng, destLatLng, coords, real }
  const lastQuoteResult = {}; // por prefijo: datos de la última cotización mostrada (sin pax/mascota)

  // Evita una condición de carrera: si el cliente elige un destino (ruta
  // lenta de calcular) y de inmediato elige otro (ruta rápida, en caché),
  // sin esto la respuesta tardía del primero podía llegar después y
  // sobrescribir en pantalla la cotización del segundo — mostrando un
  // precio/ruta que ya no corresponde a lo que el cliente seleccionó.
  const quoteGeneration = {};
  function nextQuoteGeneration(prefix) {
    quoteGeneration[prefix] = (quoteGeneration[prefix] || 0) + 1;
    return quoteGeneration[prefix];
  }
  function isCurrentQuoteGeneration(prefix, gen) {
    return quoteGeneration[prefix] === gen;
  }

  function invalidateQuote(prefix, message = 'Confirma los puntos del recorrido para calcular.') {
    nextQuoteGeneration(prefix);
    lastQuoteResult[prefix] = null; quoteRouteData[prefix] = null;
    const box = $(`#quote-${prefix}`), button = $(`#wa-${prefix}`);
    if (box) box.classList.remove('show');
    if (button) { button.disabled = true; button.onclick = null; button.setAttribute('aria-disabled','true'); }
    const route = $(`#route-link-${prefix}`); if (route) route.hidden = true;
    const eta = $(`#quote-${prefix}-eta`); if (eta) eta.textContent = message;
    const retry = $(`#quote-${prefix} .route-retry`); if (retry) retry.hidden = true;
  }

  function requireOrigin(prefix) {
    if (M360Core.validPoint(userLocation)) return true;
    invalidateQuote(prefix);
    const box = $(`#quote-${prefix}`); if (box) box.classList.add('show');
    $(`#quote-${prefix}-price`).textContent = '—';
    $(`#quote-${prefix}-route`).textContent = 'Falta el punto de salida';
    $(`#quote-${prefix}-eta`).textContent = 'Busca una dirección de salida o usa tu ubicación para calcular este viaje.';
    $('#origin-search-input')?.focus();
    return false;
  }

  const SERVICE_NAMES = {
    movilizarte: "viaje local",
    aeropuerto: "traslado de aeropuerto",
    departamento: "viaje interdepartamental",
    turismo: "viaje turístico",
  };

  // Línea de política de cancelación, calculada según el precio real de
  // esta cotización — se advierte SIEMPRE al solicitar el viaje.
  function cancellationLine(price) {
    if (price == null) {
      return "Antes de aceptar el viaje confirmaremos el importe y las condiciones de cancelación. Abrir WhatsApp no crea una reserva.";
    }
    if (price > CONFIG.cancellation.freeThresholdUsd) {
      const fee = (price * CONFIG.cancellation.feePercent) / 100;
      return `Una vez aceptada la reserva: si el precio acordado supera ${formatMoney(CONFIG.cancellation.freeThresholdUsd)}, la cancelación es del ${CONFIG.cancellation.feePercent}%. Con este estimado serían ${formatMoney(fee)}; se recalcula si cambia el precio. Abrir WhatsApp no confirma una reserva.`;
    }
    return `Cancelación sin cargo si el precio finalmente acordado no supera ${formatMoney(CONFIG.cancellation.freeThresholdUsd)}. Si lo supera, aplica ${CONFIG.cancellation.feePercent}%. Abrir WhatsApp no confirma una reserva.`;
  }

  function buildQuoteMessage(prefix, { originName, destName, price, minutes, distanceKm, extraLine, real, passengers, pets, routeSnapshot }, paymentMethod) {
    // Dos tramos en Waze en vez de un link de Google Maps: primero la ruta
    // del conductor hacia el punto de recogida (se abre estando él en su
    // ubicación real), y luego la ruta de la recogida hacia el destino del
    // cliente (se abre ya estando ahí, así que también coincide).
    const routeData = routeSnapshot;
    const wazeToPickup = routeData?.originLatLng ? wazeLink(...routeData.originLatLng) : null;
    const wazeToDest = routeData && routeData.destLatLng ? wazeLink(routeData.destLatLng[0], routeData.destLatLng[1]) : null;
    return (
      `Hola *MOVILIDAD 360 SV*\n\n` +
      `Quiero cotizar un *${SERVICE_NAMES[prefix]}*:\n` +
      `*Desde:* ${originName}\n` +
      (wazeToPickup ? `Navegar al punto de recogida: ${wazeToPickup}\n` : "") +
      `*Hasta:* ${destName}\n` +
      (routeData?.stops?.length ? routeData.stops.map((p,i)=>`Parada ${i+1}: ${p.name} — ${pointWazeLink(p)}`).join('\n')+'\n' : (wazeToDest ? `Navegar al destino después de recoger: ${wazeToDest}\n` : "")) +
      `*Distancia* ${real ? "calculada por carretera" : "aproximada, pendiente de revisión"}: ${distanceKm.toFixed(1)} km\n` +
      `*Precio estimado:* ${formatMoney(price)}\n` +
      `Duración estimada de conducción (sin tráfico en vivo): ${formatEta(minutes)}\n` +
      `*Pasajeros:* ${passengers}\n` +
      `*Mascota:* ${pets ? `Sí (+${formatMoney(CONFIG.petFee)})` : "No"}\n` +
      `*Método de pago:* ${paymentMethod}` +
      (extraLine ? `\n${extraLine}` : "") +
      `\n⚠️ ${cancellationLine(price)}` +
      `\n\n¿Podrían confirmar disponibilidad?`
    );
  }

  function showQuoteLoading(prefix, originName, destName) {
    const retry = $(`#quote-${prefix} .route-retry`); if (retry) retry.hidden = true;
    $(`#quote-${prefix}-route`).textContent = `${originName} → ${destName}`;
    $(`#quote-${prefix}-price`).textContent = "…";
    $(`#quote-${prefix}-eta`).textContent = "🧭 Calculando ruta por carretera…";
    const badge = $(`#quote-${prefix}-badge`);
    if (badge) badge.textContent = "";
    $(`#quote-${prefix}`).classList.add("show");
    const waBtn = $(`#wa-${prefix}`);
    if (waBtn) {
      waBtn.disabled = true;
      waBtn.onclick = null;
      waBtn.setAttribute("aria-disabled", "true");
      waBtn.classList.add("is-loading");
    }
    const routeLinkEl = $(`#route-link-${prefix}`);
    if (routeLinkEl) routeLinkEl.hidden = true;
  }

  function showQuote(prefix, data) {
    const { originName, destName, price, minutes, distanceKm, real } = data;
    if (!real) {
      showManualQuote(prefix, originName, destName, data.extraLine ? [{ label: 'Recorrido', value: data.extraLine }] : []);
      return;
    }
    // Red de seguridad: si llega una cotización con distancia ~0 (origen y
    // destino en el mismo punto), incluso restaurada de una versión vieja
    // guardada en el navegador, no mostramos "0.0 km" ni una ruta rota.
    if (!Number.isFinite(distanceKm) || distanceKm < SAME_POINT_KM) {
      showQuoteSamePoint(prefix, originName, destName);
      return;
    }
    $(`#quote-${prefix}-route`).textContent = `${originName} → ${destName} · ${distanceKm.toFixed(1)} km`;
    $(`#quote-${prefix}-price`).textContent = formatMoney(price);
    $(`#quote-${prefix}-eta`).textContent = `Trayecto estimado (sin tráfico en vivo): ${formatEta(minutes)}`;
    $(`#quote-${prefix}`).classList.add("show");
    const disclaimer = $(`#quote-${prefix} .quote-disclaimer`);
    if (disclaimer) disclaimer.hidden = false;

    const badge = $(`#quote-${prefix}-badge`);
    if (badge) {
      badge.textContent = real ? "🧭 Ruta calculada por carretera" : "≈ Ruta aproximada (línea recta)";
      badge.classList.toggle("is-approx", !real);
    }

    const waBtn = $(`#wa-${prefix}`);
    if (waBtn) {
      waBtn.disabled = false;
      waBtn.removeAttribute("aria-disabled");
      waBtn.classList.remove("is-loading");
      waBtn.textContent = 'Revisar solicitud';
    }

    const routeLinkEl = $(`#route-link-${prefix}`);
    if (routeLinkEl) routeLinkEl.hidden = false;

    lastQuoteResult[prefix] = data;
    if (waBtn) {
      waBtn.onclick = () => {
        const { passengers, pets } = paxPetsFor(prefix);
        const snapshot = { ...data, passengers, pets, routeSnapshot: structuredClone(quoteRouteData[prefix]) };
        const parts = M360Core.breakdown(data.distanceKm, pets, CONFIG);
        openConfirmModal({
          key: prefix + ':' + data.originName + ':' + data.destName,
          price: data.price,
          rows: [
            { label: "Servicio", value: SERVICE_NAMES[prefix] },
            { label: "Desde", value: data.originName },
            { label: "Hasta", value: data.destName },
            { label: "Distancia", value: `${data.distanceKm.toFixed(1)} km (${data.real ? "ruta calculada" : "aproximada"})` },
            { label: "Duración de conducción", value: formatEta(data.minutes) + ' · sin tráfico en vivo' },
            { label: "Base por distancia", value: formatMoney(parts.distance) },
            ...(parts.minimumAdjustment ? [{ label:'Ajuste a tarifa mínima', value:formatMoney(parts.minimumAdjustment) }] : []),
            { label: "Precio estimado", value: formatMoney(data.price) },
            { label: "Pasajeros", value: String(passengers) },
            { label: "Mascota", value: pets ? `Sí (+${formatMoney(CONFIG.petFee)})` : "No" },
            ...(data.extraLine ? [{label:'Alcance', value:data.extraLine}] : []),
          ],
          buildMessage: (paymentMethod) => buildQuoteMessage(prefix, snapshot, paymentMethod),
        });
      };
    }
  }

  // Never turn a straight-line fallback into a price to charge. The operator
  // can still receive the confirmed endpoints and review road access manually.
  function showManualQuote(prefix, originName, destName, extraRows = []) {
    const box = $(`#quote-${prefix}`), button = $(`#wa-${prefix}`);
    lastQuoteResult[prefix] = null;
    $(`#quote-${prefix}-route`).textContent = `${originName} → ${destName}`;
    $(`#quote-${prefix}-price`).textContent = 'Precio por confirmar';
    $(`#quote-${prefix}-eta`).textContent = 'No pudimos confirmar una ruta por carretera. No calculamos un cobro en línea recta. Puedes reintentar o pedir revisión al equipo.';
    const badge = $(`#quote-${prefix}-badge`);
    if (badge) { badge.textContent = 'Requiere revisión de ruta y acceso'; badge.classList.add('is-approx'); }
    const link = $(`#route-link-${prefix}`); if (link) link.hidden = true;
    const disclaimer = $(`#quote-${prefix} .quote-disclaimer`); if (disclaimer) disclaimer.hidden = true;
    box.classList.add('show');
    button.disabled = false; button.removeAttribute('aria-disabled'); button.classList.remove('is-loading');
    button.textContent = 'Solicitar revisión de ruta';
    button.onclick = () => {
      const route = structuredClone(quoteRouteData[prefix]);
      const pickup = route?.originLatLng ? wazeLink(...route.originLatLng) : null;
      const destination = route?.destLatLng ? wazeLink(...route.destLatLng) : null;
      const travel = TRAVEL_PREFIXES.includes(prefix), pax = paxPetsFor(prefix);
      const rows = [
        { label: 'Servicio', value: SERVICE_NAMES[prefix] || 'Encomienda' },
        { label: 'Desde', value: originName }, { label: 'Hasta', value: destName },
        { label: 'Precio y tiempo', value: 'Pendientes de revisión por carretera; sin importe calculado' },
        ...extraRows,
        ...(travel ? [{ label: 'Pasajeros', value: String(pax.passengers) }, { label: 'Mascota', value: pax.pets ? `Sí (+${formatMoney(CONFIG.petFee)})` : 'No' }] : []),
      ];
      openConfirmModal({ key: prefix + ':' + originName + ':' + destName, rows, price: null,
        buildMessage: payment => `Hola *MOVILIDAD 360 SV*\nQuiero solicitar una revisión manual de esta ruta.\n` +
          rows.map(r => `${r.label}: ${r.value}`).join('\n') +
          (pickup ? `\nNavegar a la recogida: ${pickup}` : '') +
          (route?.stops?.length ? '\n' + route.stops.map((p,i)=>`Parada ${i+1}: ${p.name} — ${pointWazeLink(p)}`).join('\n') : (destination ? `\nNavegar al destino después de recoger: ${destination}` : '')) +
          `\nMétodo de pago preferido: ${payment}\n${cancellationLine(null)}\n¿Pueden confirmar acceso, precio y disponibilidad?`
      });
    };
    let retry = box.querySelector('.route-retry');
    if (!retry) { retry = document.createElement('button'); retry.type = 'button'; retry.className = 'text-button route-retry'; retry.textContent = 'Reintentar cálculo'; box.appendChild(retry); }
    retry.hidden = false;
    retry.onclick = () => {
      retry.hidden = true;
      if (prefix === 'encomienda') updateParcelQuote();
      else refreshAllQuotesForNewOrigin();
    };
    trackEvent('route_manual_review', { service: prefix });
  }

  // Umbral por debajo del cual el origen y el destino se consideran el
  // mismo punto (~100 m). Por debajo de esto no es un viaje real: OSRM
  // puede devolver 0 km y una ruta degenerada que no se dibuja, así que
  // en vez de mostrar "0.0 km / precio mínimo / sin ruta" (el bug de
  // "San Jacinto → Centro Histórico" sin GPS) se le pide al cliente que
  // elija un destino distinto.
  const SAME_POINT_KM = 0.1;
  function isEssentiallySamePoint(a, b) {
    if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(b.lat)) return false;
    return haversineKm(a.lat, a.lng, b.lat, b.lng) < SAME_POINT_KM;
  }

  // Estado "el origen y el destino son el mismo punto": deja la parada sin
  // una cotización válida (botón de WhatsApp deshabilitado) y con un
  // mensaje claro, en vez de un número roto.
  function showQuoteSamePoint(prefix, originName, destName) {
    const routeEl = $(`#quote-${prefix}-route`);
    if (routeEl) routeEl.textContent = `${originName} → ${destName}`;
    const priceEl = $(`#quote-${prefix}-price`);
    if (priceEl) priceEl.textContent = "—";
    const etaEl = $(`#quote-${prefix}-eta`);
    if (etaEl) etaEl.textContent = "El punto de partida y el destino son casi el mismo. Elige un destino diferente para cotizar.";
    const badge = $(`#quote-${prefix}-badge`);
    if (badge) {
      badge.textContent = "";
      badge.classList.remove("is-approx");
    }
    const routeLinkEl = $(`#route-link-${prefix}`);
    if (routeLinkEl) routeLinkEl.hidden = true;
    $(`#quote-${prefix}`).classList.add("show");
    const waBtn = $(`#wa-${prefix}`);
    if (waBtn) {
      waBtn.disabled = true;
      waBtn.setAttribute("aria-disabled", "true");
      waBtn.classList.remove("is-loading");
      waBtn.onclick = null;
    }
    // No dejamos una cotización "buena" guardada para esta parada.
    lastQuoteResult[prefix] = null;
    quoteRouteData[prefix] = null;
  }

  /* =====================================================================
     PARADA 1 — ¿Necesitas movilizarte?
     ===================================================================== */
  let localGeoToken = 0;

  function renderLocalSuggestions(filterText) {
    const list = $("#list-movilizarte");
    const empty = $("#empty-movilizarte");
    const q = norm(filterText);
    const matches = q
      ? LOCAL_PLACES.filter((p) => norm(p.name).includes(q))
      : LOCAL_PLACES.slice(0, 8);

    localGeoToken++; // cualquier búsqueda nueva invalida una geocodificación pendiente

    if (matches.length > 0 || !q) {
      empty.classList.remove("show");
      renderSuggestionItems(list, matches, "Punto popular del área metropolitana", selectMovilizarteDestination);
      return;
    }

    // No está en nuestra lista curada: si el cliente escribió algo con
    // pinta de dirección real (3+ letras), la buscamos en OpenStreetMap
    // para que pueda pedir el viaje aunque no sepa marcarla en el mapa.
    if (filterText.trim().length < 3) {
      list.innerHTML = "";
      empty.classList.add("show");
      return;
    }
    empty.classList.remove("show");
    list.innerHTML = '<p class="field-hint">Pulsa Buscar dirección para encontrar otros lugares por nombre.</p>';
  }

  // Pinta una lista de sugerencias (lugares curados o resultados de
  // geocodificación) con el mismo formato visual. Si no se pasa una
  // descripción fija, usa la dirección completa devuelta por el buscador.
  function renderSuggestionItems(list, items, fixedMeta, onSelect) {
    list.innerHTML = items
      .map(
        (p, i) => `
      <button type="button" class="suggestion-item" data-idx="${i}">
        <span>
          <span class="suggestion-name">${escapeHtml(p.name)}</span><br>
          <span class="suggestion-meta">${fixedMeta || escapeHtml(p.fullName || 'El Salvador · confirma este punto')}</span>
        </span>
        <span class="suggestion-tag">Elegir</span>
      </button>`
      )
      .join("");
    $$(".suggestion-item", list).forEach((btn, i) => {
      btn.addEventListener("click", () => onSelect(items[i]));
    });
  }

  // Debounce específico para no saturar el servicio gratuito de
  // geocodificación mientras el cliente sigue escribiendo. Una instancia
  // POR buscador (no compartida): debounce() guarda su temporizador en un
  // cierre propio, así que si dos buscadores usaran la misma instancia, el
  // cliente escribiendo casi al mismo tiempo en el de "movilizarte" y en el
  // de "turismo" cancelaría el temporizador del otro, dejando esa lista
  // congelada en "Buscando…" para siempre.

  let lastMovilizarteSelection = null;

  async function selectMovilizarteDestination(place) {
    const gen = nextQuoteGeneration("movilizarte");
    if (!M360Core.validPoint(place)) return;
    lastMovilizarteSelection = place;
    $("#input-movilizarte").value = place.name;
    if (!requireOrigin('movilizarte')) return;
    const origin = currentOrigin();
    const originName = originLabel();
    if (isEssentiallySamePoint(origin, place)) {
      showQuoteSamePoint("movilizarte", originName, place.name);
      persistAll();
      return;
    }
    showQuoteLoading("movilizarte", originName, place.name);
    const route = await fetchRoute(origin, place);
    if (!isCurrentQuoteGeneration("movilizarte", gen)) return; // se eligió otro destino mientras tanto
    quoteRouteData.movilizarte = {
      originLatLng: [origin.lat, origin.lng],
      destLatLng: [place.lat, place.lng],
      coords: route.coords,
      real: route.real,
    };
    const price = estimatePrice(route.distanceKm, paxPetsFor("movilizarte").pets);
    showQuote("movilizarte", {
      originName,
      destName: place.name,
      price,
      minutes: route.minutes,
      distanceKm: route.distanceKm,
      real: route.real,
    });
    persistAll();
  }

  /* =====================================================================
     PARADA 2 — ¿Un viaje al aeropuerto?
     ===================================================================== */
  function renderAirports() {
    const origin = currentOrigin();
    const withDist = AIRPORTS.map((a) => ({
      ...a,
      // Solo ordena los aeropuertos por proximidad. No calcula una tarifa.
      distanceKm: estimateRoadKm(haversineKm(origin.lat, origin.lng, a.lat, a.lng)),
    })).sort((a, b) => a.distanceKm - b.distanceKm);

    $("#list-aeropuerto").innerHTML = withDist
      .map((a, i) => {
        return `
        <button type="button" class="option-card${lastAirportSelection?.name === a.name ? ' selected' : ''}" aria-pressed="${lastAirportSelection?.name === a.name}" data-idx="${i}">
          <div class="option-card-top">
            <span class="option-title">${a.name}</span>
            ${i === 0 && userLocation && airportDirection === 'to' ? '<span class="option-badge">Más cercano a tu salida</span>' : ""}
          </div>
          <span class="option-desc">${a.short} · ${a.type}</span>
          <div class="option-foot">
            <span class="field-hint">${airportDirection === 'from' ? 'Punto de recogida' : 'Destino del traslado'}</span>
          </div>
        </button>`;
      })
      .join("");

    $$(".option-card", $("#list-aeropuerto")).forEach((card, i) => {
      card.addEventListener("click", () => {
        $$(".option-card", $("#list-aeropuerto")).forEach((c) => { c.classList.remove("selected"); c.setAttribute('aria-pressed','false'); });
        card.classList.add("selected");
        card.setAttribute('aria-pressed', 'true');
        selectAirport(withDist[i]);
      });
    });
  }

  let lastAirportSelection = null;
  let airportDirection = 'to';
  let airportArrivalDestination = null;

  function selectAirportDestination(place) {
    if (!M360Core.validPoint(place)) return;
    airportArrivalDestination = { ...place };
    $('#airport-destination').value = place.name;
    $('#airport-destination-suggestions').innerHTML = '';
    if (lastAirportSelection) selectAirport(lastAirportSelection);
    persistAll();
  }

  function syncAirportDirection() {
    $$('[data-airport-direction]').forEach(button => {
      const selected = button.dataset.airportDirection === airportDirection;
      button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
    });
    $('#airport-arrival-field').hidden = airportDirection !== 'from';
    if (activeService === 'aeropuerto') $('.geo-banner').hidden = airportDirection === 'from';
    renderAirports();
  }

  function wireAirportDirection() {
    $$('[data-airport-direction]').forEach(button => button.addEventListener('click', () => {
      if (airportDirection === button.dataset.airportDirection) return;
      airportDirection = button.dataset.airportDirection;
      invalidateQuote('aeropuerto'); syncAirportDirection();
      if (lastAirportSelection) selectAirport(lastAirportSelection);
      persistAll();
    }));
    wireExplicitSearch($('#airport-destination'), $('#airport-destination-suggestions'), selectAirportDestination);
    $('#airport-destination').addEventListener('input', () => { airportArrivalDestination = null; invalidateQuote('aeropuerto'); persistAll(); });
  }

  async function selectAirport(airport) {
    const gen = nextQuoteGeneration("aeropuerto");
    if (!M360Core.validPoint(airport)) return;
    lastAirportSelection = airport;
    renderAirports();
    if (airportDirection === 'to' && !requireOrigin('aeropuerto')) return;
    if (airportDirection === 'from' && !M360Core.validPoint(airportArrivalDestination)) {
      invalidateQuote('aeropuerto');
      $('#quote-aeropuerto').classList.add('show');
      $('#quote-aeropuerto-route').textContent = airport.name;
      $('#quote-aeropuerto-price').textContent = '—';
      $('#quote-aeropuerto-eta').textContent = 'Confirma a dónde vas después de la recogida en el aeropuerto.';
      return;
    }
    const origin = airportDirection === 'from' ? airport : currentOrigin();
    const destination = airportDirection === 'from' ? airportArrivalDestination : airport;
    const originName = airportDirection === 'from' ? airport.name : originLabel();
    if (isEssentiallySamePoint(origin, destination)) {
      showQuoteSamePoint("aeropuerto", originName, destination.name);
      persistAll();
      return;
    }
    showQuoteLoading("aeropuerto", originName, destination.name);
    const route = await fetchRoute(origin, destination);
    if (!isCurrentQuoteGeneration("aeropuerto", gen)) return; // se eligió otro aeropuerto mientras tanto
    quoteRouteData.aeropuerto = {
      originLatLng: [origin.lat, origin.lng],
      destLatLng: [destination.lat, destination.lng],
      coords: route.coords,
      real: route.real,
    };
    const price = estimatePrice(route.distanceKm, paxPetsFor("aeropuerto").pets);
    showQuote("aeropuerto", {
      originName,
      destName: destination.name,
      price,
      minutes: route.minutes,
      distanceKm: route.distanceKm,
      real: route.real,
      extraLine: airportDirection === 'from' ? 'Recogida en aeropuerto: confirmar terminal y punto de encuentro.' : 'Salida hacia el aeropuerto: confirmar margen suficiente antes del vuelo.',
    });
    persistAll();
  }

  /* =====================================================================
     PARADA 3 — ¿Enviar una encomienda?
     ===================================================================== */
  const parcelState = { size: null, urgent: false, fragile: false, fromPoint: null, toPoint: null, fromName: "", toName: "" };
  const parcelSizeLabels = {
    small: "Pequeño (<2kg)",
    medium: "Mediano (2–8kg)",
    large: "Grande (8–20kg)",
  };

  let parcelQuoteGen = 0;

  async function updateParcelQuote() {
    const myGen = ++parcelQuoteGen;
    invalidateQuote('encomienda');
    if (!parcelState.size) return;
    if (!M360Core.validPoint(parcelState.fromPoint) || !M360Core.validPoint(parcelState.toPoint)) {
      $('#quote-encomienda').classList.add('show');
      $('#quote-encomienda-price').textContent = '—';
      $('#quote-encomienda-eta').textContent = 'Confirma recolección y entrega para calcular el total. El tamaño por sí solo no incluye el recorrido.';
      return;
    }
    const fromPoint = { ...parcelState.fromPoint }, toPoint = { ...parcelState.toPoint };
    let price = CONFIG.pricing.parcel[parcelState.size];
    if (parcelState.urgent) price += CONFIG.pricing.parcel.urgentSurcharge;

    let distanceKm = null;
    let real = false;
    // Recolección y entrega en el mismo punto (o casi): no hay tramo real
    // que cobrar por km ni ruta que dibujar — se cotiza solo el precio base
    // por tamaño y se avisa, en vez de mostrar "0.0 km" y una ruta rota.
    const samePoint =
      parcelState.fromPoint &&
      parcelState.toPoint &&
      isEssentiallySamePoint(parcelState.fromPoint, parcelState.toPoint);

    if (parcelState.fromPoint && parcelState.toPoint && !samePoint) {
      $('#quote-encomienda-route').textContent = `${fromPoint.name || $('#parcel-from').value} → ${toPoint.name || $('#parcel-to').value}`;
      $('#quote-encomienda-price').textContent = '…';
      $("#quote-encomienda-eta").textContent = "🧭 Calculando ruta por carretera…";
      $("#quote-encomienda").classList.add("show");
      const route = await fetchRoute(fromPoint, toPoint);
      // Si el cliente cambió algo (tamaño, direcciones…) mientras se
      // calculaba la ruta, esta respuesta ya no corresponde: se descarta.
      if (myGen !== parcelQuoteGen) return;
      distanceKm = route.distanceKm;
      real = route.real;
      price += distanceKm * CONFIG.ratePerKmParcel;
      quoteRouteData.encomienda = {
        originLatLng: [fromPoint.lat, fromPoint.lng],
        destLatLng: [toPoint.lat, toPoint.lng],
        coords: route.coords,
        real: route.real,
      };
      if (!route.real) {
        showManualQuote('encomienda', $('#parcel-from').value.trim(), $('#parcel-to').value.trim(), [
          { label: 'Tamaño', value: parcelSizeLabels[parcelState.size] },
          { label: 'Urgencia solicitada', value: parcelState.urgent ? 'Express, sujeto a disponibilidad' : 'Estándar' },
          { label: 'Frágil', value: parcelState.fragile ? 'Sí' : 'No' },
          { label: 'Instrucciones', value: $('#parcel-notes').value.trim() || 'Sin instrucciones adicionales' },
        ]);
        persistAll(); return;
      }
    } else {
      quoteRouteData.encomienda = null;
    }

    $("#quote-encomienda-route").textContent =
      `Encomienda ${parcelSizeLabels[parcelState.size]}${parcelState.fragile ? " · frágil" : ""}` +
      (distanceKm !== null ? ` · ${distanceKm.toFixed(1)} km` : samePoint ? " · recolección y entrega en el mismo punto" : "");
    $("#quote-encomienda-price").textContent = formatMoney(price);
    $("#quote-encomienda-eta").textContent = parcelState.urgent
      ? "Entrega estimada: mismo día"
      : "Entrega estimada: 24–48 horas";
    $("#quote-encomienda").classList.add("show");

    const parcelDisclaimer = $('#quote-encomienda .quote-disclaimer');
    if (parcelDisclaimer) parcelDisclaimer.hidden = false;
    const parcelRetry = $('#quote-encomienda .route-retry');
    if (parcelRetry) parcelRetry.hidden = true;

    const badge = $("#quote-encomienda-badge");
    if (badge) {
      badge.textContent = distanceKm !== null ? (real ? "🧭 Ruta calculada por carretera" : "≈ Ruta aproximada (línea recta)") : "";
      badge.classList.toggle("is-approx", distanceKm !== null && !real);
    }
    const routeLinkEl = $("#route-link-encomienda");
    if (routeLinkEl) routeLinkEl.hidden = distanceKm === null;

    const from = $("#parcel-from").value.trim() || "(pendiente de confirmar)";
    const to = $("#parcel-to").value.trim() || "(pendiente de confirmar)";
    const notes = $("#parcel-notes").value.trim();

    lastParcelQuote = { price, distanceKm, real, from, to, notes };

    const waBtn = $("#wa-encomienda");
    if (waBtn) {
      waBtn.disabled = false; waBtn.removeAttribute('aria-disabled');
      waBtn.textContent = 'Revisar solicitud';
      waBtn.onclick = () => {
        const state = structuredClone(parcelState);
        const notes = $('#parcel-notes').value.trim();
        openConfirmModal({
          key: 'encomienda:' + from + ':' + to,
          price,
          rows: [
            { label: "Servicio", value: "Encomienda" },
            { label: "Tamaño", value: parcelSizeLabels[parcelState.size] },
            { label: "Urgencia", value: parcelState.urgent ? "Mismo día (express)" : "Estándar" },
            { label: "Frágil", value: parcelState.fragile ? "Sí" : "No" },
            { label: "Recolección", value: from },
            { label: "Entrega", value: to },
            { label: "Instrucciones", value: notes || 'Sin instrucciones adicionales' },
            { label: "Base por tamaño", value: formatMoney(CONFIG.pricing.parcel[state.size]) },
            { label: "Recargo express", value: formatMoney(state.urgent ? CONFIG.pricing.parcel.urgentSurcharge : 0) },
            ...(distanceKm !== null ? [{ label: "Distancia", value: `${distanceKm.toFixed(1)} km (${real ? "ruta calculada" : "aproximada"})` }] : []),
            { label: "Precio estimado", value: formatMoney(price) },
          ],
          buildMessage: (paymentMethod) =>
            `Hola *MOVILIDAD 360 SV*\n\n` +
            `Quiero cotizar el envío de una *encomienda*:\n` +
            `*Tamaño:* ${parcelSizeLabels[state.size]}\n` +
            `*Urgencia:* ${state.urgent ? "Mismo día (express)" : "Estándar"}\n` +
            `Frágil: ${state.fragile ? "Sí" : "No"}\n` +
            `*Recolección:* ${from}\n` +
            `Navegar a la recolección: ${pointWazeLink(fromPoint)}\n` +
            `*Entrega:* ${to}` +
            `\nNavegar al destino después de recoger: ${pointWazeLink(toPoint)}` +
            (distanceKm !== null ? `\n*Distancia* ${real ? "calculada por carretera" : "aproximada"}: ${distanceKm.toFixed(1)} km` : "") +
            (notes ? `\n*Instrucciones:* ${notes}` : "") +
            `\n*Precio estimado:* ${formatMoney(price)}\n` +
            `*Método de pago:* ${paymentMethod}` +
            `\n⚠️ ${cancellationLine(price)}` +
            `\n\n¿Podrían confirmar disponibilidad?`,
        });
      };
    }
    persistAll();
  }
  let lastParcelQuote = null;

  function selectParcelPoint(which, place) {
    const inputId = which === "from" ? "#parcel-from" : "#parcel-to";
    const hintId = which === "from" ? "#parcel-from-map-hint" : "#parcel-to-map-hint";
    $(inputId).value = place.name;
    $(hintId).textContent = "Punto confirmado ✓";
    if (which === "from") {
      parcelState.fromPoint = { lat: place.lat, lng: place.lng };
      parcelState.fromName = place.name;
    } else {
      parcelState.toPoint = { lat: place.lat, lng: place.lng };
      parcelState.toName = place.name;
    }
    updateParcelQuote();
  }

  function wireParcelForm() {
    $$("#parcel-size .pill-option").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$("#parcel-size .pill-option").forEach((b) => {
          b.classList.remove("selected");
          b.setAttribute("aria-pressed", "false");
        });
        btn.classList.add("selected");
        btn.setAttribute("aria-pressed", "true");
        parcelState.size = btn.dataset.size;
        updateParcelQuote();
      });
    });

    const urgentSwitch = $("#parcel-urgent");
    const urgentWarning = $("#parcel-urgent-warning");
    urgentSwitch.addEventListener("click", () => {
      urgentSwitch.classList.toggle("on");
      parcelState.urgent = urgentSwitch.classList.contains("on");
      urgentSwitch.setAttribute("aria-pressed", String(parcelState.urgent));
      if (urgentWarning) urgentWarning.hidden = !parcelState.urgent;
      updateParcelQuote();
    });

    const fragileSwitch = $("#parcel-fragile");
    fragileSwitch.addEventListener("click", () => {
      fragileSwitch.classList.toggle("on");
      parcelState.fragile = fragileSwitch.classList.contains("on");
      fragileSwitch.setAttribute("aria-pressed", String(parcelState.fragile));
      updateParcelQuote();
    });

    $("#parcel-from").addEventListener("input", () => {
      parcelQuoteGen++; invalidateQuote('encomienda');
      parcelState.fromPoint = null;
      $("#parcel-from-map-hint").textContent = "";
      debouncedParcelQuote();
    });
    $("#parcel-to").addEventListener("input", () => {
      parcelQuoteGen++; invalidateQuote('encomienda');
      parcelState.toPoint = null;
      $("#parcel-to-map-hint").textContent = "";
      debouncedParcelQuote();
    });
    $("#parcel-notes").addEventListener("input", debouncedParcelQuote);

    wireAddressSearch("parcel-from", "parcel-from-suggestions", (place) => selectParcelPoint("from", place));
    wireAddressSearch("parcel-to", "parcel-to-suggestions", (place) => selectParcelPoint("to", place));
  }

  // Autocompletado de direcciones reutilizable: busca en Nominatim mientras
  // el cliente escribe y pinta sugerencias debajo del campo (mismo patrón
  // que el buscador de origen y el de "¿Necesitas movilizarte?"). Se usa en
  // los puntos A/B de encomienda y mudanza, que antes solo se podían marcar
  // en el mapa o escribir a mano sin coordenadas.
  function wireAddressSearch(inputId, listId, onSelect) {
    const input = $(`#${inputId}`);
    const list = $(`#${listId}`);
    if (!input || !list) return;
    wireExplicitSearch(input, list, place=>{ list.innerHTML = ''; onSelect(place); });
  }
  const debouncedParcelQuote = debounce(updateParcelQuote, 250);

  /* =====================================================================
     PARADA 6 — Mudanzas (cotización personalizada, sin precio automático:
     el costo de una mudanza depende de volumen y acceso, no solo de km)
     ===================================================================== */
  const mudanzaState = { size: null, fromPoint: null, toPoint: null, fromName: "", toName: "" };
  const mudanzaSizeLabels = {
    estudio: "Estudio",
    apartamento: "Apartamento (1-2 habitaciones)",
    casa: "Casa",
  };

  function updateMudanzaQuote() {
    invalidateQuote('mudanza');
    if (!mudanzaState.size) return;
    $("#quote-mudanza-route").textContent = `Mudanza (${mudanzaSizeLabels[mudanzaState.size]}) — cotización personalizada`;
    $("#quote-mudanza-eta").textContent = "Te confirmamos el precio por WhatsApp.";
    $("#quote-mudanza").classList.add("show");

    const from = $("#mudanza-from").value.trim() || "(pendiente de confirmar)";
    const to = $("#mudanza-to").value.trim() || "(pendiente de confirmar)";
    const notes = $("#mudanza-notes").value.trim();

    const waBtn = $("#wa-mudanza");
    if (waBtn) {
      waBtn.disabled = !M360Core.validPoint(mudanzaState.fromPoint) || !M360Core.validPoint(mudanzaState.toPoint);
      if (waBtn.disabled) { $('#quote-mudanza-eta').textContent = 'Confirma recolección y entrega para solicitar un precio personalizado.'; return; }
      waBtn.removeAttribute('aria-disabled');
      waBtn.onclick = () => {
        const state = structuredClone(mudanzaState);
        const notes = $('#mudanza-notes').value.trim();
        openConfirmModal({
          key: 'mudanza:' + from + ':' + to,
          price: null,
          rows: [
            { label: "Servicio", value: "Mudanza" },
            { label: "Tamaño", value: mudanzaSizeLabels[mudanzaState.size] },
            { label: "Recolección", value: from },
            { label: "Entrega", value: to },
            { label: "Detalles y acceso", value: notes || 'Sin detalles adicionales' },
          ],
          buildMessage: (paymentMethod) =>
            `Hola *MOVILIDAD 360 SV*\n\n` +
            `Quiero cotizar una *mudanza*:\n` +
            `*Tamaño:* ${mudanzaSizeLabels[state.size]}\n` +
            `*Recolección:* ${from}\n` +
            `Navegar a la recolección: ${pointWazeLink(state.fromPoint)}\n` +
            `*Entrega:* ${to}` +
            `\nNavegar al destino después de recoger: ${pointWazeLink(state.toPoint)}` +
            (notes ? `\n*Detalles:* ${notes}` : "") +
            `\n*Método de pago preferido:* ${paymentMethod}` +
            `\n⚠️ ${cancellationLine(null)}` +
            `\n\n¿Podrían darme una cotización?`,
        });
      };
    }
    persistAll();
  }

  function selectMudanzaPoint(which, place) {
    const inputId = which === "from" ? "#mudanza-from" : "#mudanza-to";
    const hintId = which === "from" ? "#mudanza-from-map-hint" : "#mudanza-to-map-hint";
    $(inputId).value = place.name;
    $(hintId).textContent = "Punto confirmado ✓";
    if (which === "from") {
      mudanzaState.fromPoint = { lat: place.lat, lng: place.lng };
      mudanzaState.fromName = place.name;
    } else {
      mudanzaState.toPoint = { lat: place.lat, lng: place.lng };
      mudanzaState.toName = place.name;
    }
    updateMudanzaQuote();
  }

  function wireMudanzaForm() {
    $$("#mudanza-size .pill-option").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$("#mudanza-size .pill-option").forEach((b) => {
          b.classList.remove("selected");
          b.setAttribute("aria-pressed", "false");
        });
        btn.classList.add("selected");
        btn.setAttribute("aria-pressed", "true");
        mudanzaState.size = btn.dataset.size;
        updateMudanzaQuote();
      });
    });

    $("#mudanza-from").addEventListener("input", () => {
      invalidateQuote('mudanza');
      mudanzaState.fromPoint = null;
      $("#mudanza-from-map-hint").textContent = "";
      debouncedMudanzaQuote();
    });
    $("#mudanza-to").addEventListener("input", () => {
      invalidateQuote('mudanza');
      mudanzaState.toPoint = null;
      $("#mudanza-to-map-hint").textContent = "";
      debouncedMudanzaQuote();
    });
    $("#mudanza-notes").addEventListener("input", debouncedMudanzaQuote);

    wireAddressSearch("mudanza-from", "mudanza-from-suggestions", (place) => selectMudanzaPoint("from", place));
    wireAddressSearch("mudanza-to", "mudanza-to-suggestions", (place) => selectMudanzaPoint("to", place));
  }
  const debouncedMudanzaQuote = debounce(updateMudanzaQuote, 250);

  /* =====================================================================
     PARADA 7 — Tarifas fijas (precios ya acordados con el cliente desde un
     origen fijo; no usan geolocalización ni cálculo de distancia)
     ===================================================================== */
  let fixedRouteIdx = null;

  function renderFixedRoutes() {
    const select = $("#fixed-destino");
    if (!select) return;
    select.innerHTML =
      `<option value="" disabled${fixedRouteIdx == null ? " selected" : ""}>Elige tu destino…</option>` +
      FIXED_ROUTES.destinations
        .map(
          (d, i) =>
            `<option value="${i}"${fixedRouteIdx === i ? " selected" : ""}>${d.name} — ${formatMoney(d.price)}${d.negotiable ? " (negociable)" : ""}</option>`
        )
        .join("");
  }

  function updateFixedQuote() {
    const dest = FIXED_ROUTES.destinations[fixedRouteIdx];
    if (!dest) return;
    const { passengers, pets } = paxPetsFor("tarifafija");
    const finalPrice = dest.price + (pets ? CONFIG.petFee : 0);
    $("#quote-tarifafija-route").textContent = `${FIXED_ROUTES.origin} → ${dest.name}`;
    $("#quote-tarifafija-price").textContent = formatMoney(finalPrice);
    $("#quote-tarifafija-eta").textContent = dest.negotiable
      ? "Precio negociable, se confirma por WhatsApp."
      : "Precio fijo, sin cálculo de distancia.";
    $("#quote-tarifafija").classList.add("show");

    const waBtn = $("#wa-tarifafija");
    if (waBtn) {
      waBtn.onclick = () => {
        const { passengers, pets } = paxPetsFor('tarifafija');
        const finalPrice = dest.price + (pets ? CONFIG.petFee : 0);
        openConfirmModal({
          key: 'tarifafija:' + dest.name,
          price: finalPrice,
          rows: [
            { label: "Servicio", value: "Tarifa fija" },
            { label: "Desde", value: FIXED_ROUTES.origin },
            { label: "Hasta", value: dest.name },
            { label: "Pasajeros", value: String(passengers) },
            { label: "Mascota", value: pets ? `Sí (+${formatMoney(CONFIG.petFee)})` : 'No' },
            { label: "Puntos de encuentro", value: 'El equipo confirmará el acceso exacto en Assistenza Italiana y el destino antes de asignar el vehículo.' },
            { label: "Precio", value: formatMoney(finalPrice) + (dest.negotiable ? " (negociable)" : "") },
          ],
          buildMessage: (paymentMethod) =>
            `Hola *MOVILIDAD 360 SV*\n\n` +
            `Quiero reservar un viaje con *tarifa fija*:\n` +
            `*Desde:* ${FIXED_ROUTES.origin}\n` +
            `*Hasta:* ${dest.name}\n` +
            `*Precio:* ${formatMoney(finalPrice)}${dest.negotiable ? " (negociable, a confirmar)" : ""}\n` +
            `*Pasajeros:* ${passengers}\n` +
            `*Mascota:* ${pets ? `Sí (+${formatMoney(CONFIG.petFee)})` : "No"}\n` +
            `*Método de pago:* ${paymentMethod}` +
            `\n⚠️ ${cancellationLine(finalPrice)}` +
            `\n\n¿Podrían confirmar disponibilidad?`,
        });
      };
    }
    persistAll();
  }

  function wireFixedRoutesForm() {
    renderFixedRoutes();
    const select = $("#fixed-destino");
    if (!select) return;
    select.addEventListener("change", () => {
      fixedRouteIdx = select.value === "" ? null : Number(select.value);
      if (fixedRouteIdx != null) updateFixedQuote();
    });
  }

  /* =====================================================================
     PARADA 4 — ¿Viajar a otro departamento?
     ===================================================================== */
  function renderDepartments() {
    const list = $("#list-departamento");
    list.innerHTML = DEPARTMENTS.map((d, i) =>
      `<button type="button" class="chip" data-idx="${i}">${escapeHtml(d.name)}</button>`
    ).join("");
    $$(".chip", list).forEach((button, i) => button.addEventListener("click", () => {
      const input = $("#input-departamento");
      input.value = DEPARTMENTS[i].name;
      lastDepartmentSelection = null; invalidateQuote("departamento");
      input.dispatchEvent(new Event("input", { bubbles:true })); input.focus();
      $("#departamento-hint").textContent = "Añade un municipio, dirección o lugar concreto y confirma un resultado. El departamento no es un punto de llegada.";
    }));
  }

  let lastDepartmentSelection = null;

  async function selectDepartment(place) {
    const gen = nextQuoteGeneration("departamento");
    if (!M360Core.validPoint(place)) return;
    lastDepartmentSelection = place;
    $("#input-departamento").value = place.name;
    if (!requireOrigin("departamento")) return;
    const origin = { ...currentOrigin() }, originName = originLabel();
    if (isEssentiallySamePoint(origin, place)) {
      showQuoteSamePoint("departamento", originName, place.name); persistAll(); return;
    }
    showQuoteLoading("departamento", originName, place.name);
    const route = await fetchRoute(origin, place);
    if (!isCurrentQuoteGeneration("departamento", gen)) return;
    quoteRouteData.departamento = { originLatLng:[origin.lat,origin.lng],
      destLatLng:[place.lat,place.lng], coords:route.coords, real:route.real };
    showQuote("departamento", { originName, destName:place.name,
      price:estimatePrice(route.distanceKm,paxPetsFor("departamento").pets),
      minutes:route.minutes,distanceKm:route.distanceKm,real:route.real });
    persistAll();
  }

  /* =====================================================================
     PARADA 5 — ¿Conocer los mejores lugares de El Salvador?
     ===================================================================== */
  let touristCategory = "Todos";
  let touristSearch = "";

  function touristCategories() {
    return ["Todos", ...Array.from(new Set(TOURIST_PLACES.map((p) => p.category)))];
  }

  function renderTouristChips() {
    const chips = touristCategories();
    $("#chips-turismo").innerHTML = chips
      .map(
        (c) =>
          `<button type="button" class="chip${c === touristCategory ? " active" : ""}" data-cat="${c}" aria-pressed="${c === touristCategory}">${c}</button>`
      )
      .join("");
    $$(".chip", $("#chips-turismo")).forEach((chip) => {
      chip.addEventListener("click", () => {
        touristCategory = chip.dataset.cat;
        renderTouristChips();
        renderTourism();
      });
    });
  }

  let touristGeoToken = 0;

  function renderTourism() {
    const q = norm(touristSearch);
    const filtered = TOURIST_PLACES.filter((p) => {
      const matchesCat = touristCategory === "Todos" || p.category === touristCategory;
      const matchesText =
        !q || norm(p.name).includes(q) || norm(p.category).includes(q) || norm(p.dept).includes(q);
      return matchesCat && matchesText;
    });

    const grid = $("#list-turismo");
    const empty = $("#empty-turismo");
    touristGeoToken++;

    if (filtered.length === 0) {
      renderTourismGeoFallback(grid, empty);
      return;
    }
    empty.classList.remove("show");

    const origin = currentOrigin();
    grid.innerHTML = filtered
      .map((p, i) => {
        const distanceKm = estimateRoadKm(haversineKm(origin.lat, origin.lng, p.lat, p.lng));
        return `
        <button type="button" class="option-card" data-idx="${i}">
          <div class="option-card-top">
            <span class="option-title">${p.name}</span>
            <span class="option-badge teal">${p.category}</span>
          </div>
          <span class="option-desc">${p.desc}</span>
          <div class="option-foot">
            <span class="field-hint">${userLocation ? 'Calcular ruta y precio' : 'Confirma tu salida para cotizar'}</span>
          </div>
        </button>`;
      })
      .join("");

    $$(".option-card", grid).forEach((card, i) => {
      card.addEventListener("click", () => {
        $$(".option-card", grid).forEach((c) => c.classList.remove("selected"));
        card.classList.add("selected");
        selectTourism(filtered[i]);
      });
    });
  }

  // Respaldo cuando el destino turístico buscado no está en nuestra
  // lista curada: lo busca como dirección real (OpenStreetMap) para que
  // el cliente pueda pedir el viaje aunque no sepa marcarlo en el mapa.
  function renderTourismGeoFallback(grid, empty) {
    empty.classList.remove("show");
    grid.innerHTML = '<p class="field-hint">No hay coincidencias en este catálogo. Usa Buscar dirección para consultar otros lugares, o cambia el filtro.</p>';
  }

  let lastTourismSelection = null;
  let lastTourismRouteSelection = null;

  async function selectTourism(place) {
    const gen = nextQuoteGeneration("turismo");
    if (!M360Core.validPoint(place)) return;
    lastTourismSelection = place;
    lastTourismRouteSelection = null;
    if (!requireOrigin('turismo')) return;
    const origin = currentOrigin();
    const originName = originLabel();
    if (isEssentiallySamePoint(origin, place)) {
      showQuoteSamePoint("turismo", originName, place.name);
      persistAll();
      return;
    }
    showQuoteLoading("turismo", originName, place.name);
    const route = await fetchRoute(origin, place);
    if (!isCurrentQuoteGeneration("turismo", gen)) return; // se eligió otro destino/ruta mientras tanto
    quoteRouteData.turismo = {
      originLatLng: [origin.lat, origin.lng],
      destLatLng: [place.lat, place.lng],
      coords: route.coords,
      real: route.real,
    };
    const price = estimatePrice(route.distanceKm, paxPetsFor("turismo").pets);
    showQuote("turismo", {
      originName,
      destName: place.name,
      price,
      minutes: route.minutes,
      distanceKm: route.distanceKm,
      real: route.real,
    });
    persistAll();
  }

  /* ---------------- Rutas turísticas sugeridas (varias paradas) ---------------- */
  function renderTouristRoutes() {
    const grid = $("#routes-turismo");
    if (!grid) return;
    grid.innerHTML = TOURIST_ROUTES.map(
      (r, i) => `
      <button type="button" class="route-card" data-idx="${i}">
        <h4>${r.name}</h4>
        <p class="route-desc">${r.desc}</p>
        <p class="route-stops">${r.stops.join(" → ")}</p>
      </button>`
    ).join("");
    $$(".route-card", grid).forEach((card, i) => {
      card.addEventListener("click", () => {
        $$(".route-card", grid).forEach((c) => c.classList.remove("selected"));
        card.classList.add("selected");
        selectTouristRoute(TOURIST_ROUTES[i]);
      });
    });
  }

  async function selectTouristRoute(route) {
    const gen = nextQuoteGeneration("turismo");
    lastTourismRouteSelection = route;
    lastTourismSelection = null;
    const stopPlaces = Array.isArray(route.points) ? route.points.filter(M360Core.validPoint) : route.stops.map((name) => TOURIST_PLACES.find((p) => p.name === name)).filter(Boolean);
    if (stopPlaces.length === 0) return;
    if (!requireOrigin('turismo')) return;

    const origin = currentOrigin();
    const originName = originLabel();
    const destLabel = `${route.name} (${route.stops.join(" → ")})`;
    showQuoteLoading("turismo", originName, destLabel);

    let totalKm = 0;
    let totalMinutes = 0;
    let allReal = true;
    let coordsAll = [];
    let legOrigin = origin;
    for (const stop of stopPlaces) {
      // Saltamos tramos de longitud cero (dos paradas que coinciden, o el
      // origen justo encima de la primera parada): no aportan distancia y
      // sí ensucian el trazo del mapa con coords degeneradas.
      if (isEssentiallySamePoint(legOrigin, stop)) {
        legOrigin = stop;
        continue;
      }
      const leg = await fetchRoute(legOrigin, stop);
      if (!isCurrentQuoteGeneration("turismo", gen)) return; // se eligió otro destino/ruta mientras tanto
      totalKm += leg.distanceKm;
      totalMinutes += leg.minutes;
      if (!leg.real) allReal = false;
      coordsAll = coordsAll.concat(leg.coords || [[legOrigin.lat,legOrigin.lng],[stop.lat,stop.lng]]);
      legOrigin = stop;
    }

    if (totalKm < SAME_POINT_KM) {
      showQuoteSamePoint("turismo", originName, destLabel);
      persistAll();
      return;
    }

    const lastStop = stopPlaces[stopPlaces.length - 1];
    quoteRouteData.turismo = {
      originLatLng: [origin.lat, origin.lng],
      destLatLng: [lastStop.lat, lastStop.lng],
      coords: coordsAll.length ? coordsAll : null,
      real: allReal,
      stops: stopPlaces.map(p=>({name:p.name,lat:p.lat,lng:p.lng})),
    };
    // La tarifa por tramos se aplica UNA sola vez a la distancia total del
    // recorrido completo (no a cada tramo por separado), igual que un solo
    // viaje largo — así el km 20 del recorrido paga la tarifa del km 20,
    // sin importar en qué parada específica ocurrió.
    const price = estimatePrice(totalKm, paxPetsFor("turismo").pets);
    showQuote("turismo", {
      originName,
      destName: destLabel,
      price,
      minutes: totalMinutes,
      distanceKm: totalKm,
      real: allReal,
      extraLine: 'Traslados de ida entre las paradas indicadas. No incluye regreso, espera, entradas ni duración de visitas; se acuerdan por WhatsApp.',
    });
    persistAll();
  }

  /* =====================================================================
     Mapa (Leaflet) — elegir punto en el mapa, o ver la ruta calculada
     ===================================================================== */
  let map, marker, pendingLatLng, mapContext;
  let routeLine = null;
  let routeMarkers = [];

  function ensureMap() {
    if (map) return;
    map = L.map("leaflet-map", { scrollWheelZoom: true }).setView([13.7, -89.2], 8);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; colaboradores de OpenStreetMap",
      maxZoom: 18,
    }).addTo(map);
    map.on("click", (e) => {
      if (mapContext === "view-route") return; // vista de solo lectura
      pendingLatLng = e.latlng;
      if (marker) marker.setLatLng(e.latlng);
      else {
        marker = L.marker(e.latlng, { draggable: true }).addTo(map);
        marker.on('dragend', () => {
          pendingLatLng = marker.getLatLng();
          $('#mapModalHint').textContent = `Punto seleccionado: ${pendingLatLng.lat.toFixed(4)}, ${pendingLatLng.lng.toFixed(4)}`;
        });
      }
      $("#mapModalHint").textContent = `Punto seleccionado: ${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`;
      $("#mapModalConfirm").disabled = false;
    });
  }

  function clearRouteLayer() {
    if (routeLine) {
      routeLine.remove();
      routeLine = null;
    }
    routeMarkers.forEach((m) => m.remove());
    routeMarkers = [];
  }

  let mapOpenGeneration = 0;
  async function openMapModal(context) {
    const generation = ++mapOpenGeneration;
    mapContext = context;
    M360UI.open('mapModal');
    $("#mapModalTitle").textContent = "Elige tu destino en el mapa";
    $("#mapModalConfirm").style.display = "";
    $("#mapModalConfirm").disabled = true;
    $('#mapModalCenter').hidden = false;
    $('#mapModalCenter').disabled = true;
    $("#mapModalHint").textContent = "Cargando mapa…";
    try {
      await loadLeaflet();
    } catch (err) {
      $("#mapModalHint").textContent = "No se pudo cargar el mapa. Verifica tu conexión a internet.";
      return;
    }
    if (generation !== mapOpenGeneration) return;
    ensureMap();
    clearRouteLayer();
    pendingLatLng = null;
    $('#mapModalCenter').disabled = false;
    if (marker) {
      marker.remove();
      marker = null;
    }
    $("#mapModalHint").textContent = "Toca el mapa para colocar un pin en tu destino.";
    map.setView([13.7, -89.2], 8);
    setTimeout(() => map.invalidateSize(), 60);
  }

  async function openRouteView(prefix) {
    const generation = ++mapOpenGeneration;
    const data = quoteRouteData[prefix];
    if (!data) return;
    mapContext = "view-route";
    M360UI.open('mapModal');
    $("#mapModalTitle").textContent = "Ruta estimada del viaje";
    $("#mapModalConfirm").style.display = "none";
    $('#mapModalCenter').hidden = true;
    $("#mapModalHint").textContent = "Cargando mapa…";
    try {
      await loadLeaflet();
    } catch (err) {
      $("#mapModalHint").textContent = "No se pudo cargar el mapa. Verifica tu conexión a internet.";
      return;
    }
    if (generation !== mapOpenGeneration) return;
    ensureMap();
    clearRouteLayer();
    if (marker) {
      marker.remove();
      marker = null;
    }
    const latlngs =
      data.coords && data.coords.length >= 2 ? data.coords : [data.originLatLng, data.destLatLng];
    routeLine = L.polyline(latlngs, {
      color: data.real ? "#7cb342" : "#8fa0ad",
      weight: 4,
      dashArray: data.real ? null : "8 8",
    }).addTo(map);
    routeMarkers = [
      L.marker(data.originLatLng).addTo(map).bindPopup("Origen"),
      L.marker(data.destLatLng).addTo(map).bindPopup("Destino"),
    ];
    // Si el trazo es degenerado (origen y destino en el mismo punto),
    // getBounds() da un rectángulo de área cero y fitBounds no encuadra
    // nada útil — mejor centrar el mapa en el punto con un zoom fijo.
    const bounds = routeLine.getBounds();
    if (bounds.isValid() && !bounds.getNorthEast().equals(bounds.getSouthWest())) {
      map.fitBounds(bounds, { padding: [30, 30] });
    } else {
      map.setView(data.originLatLng, 15);
    }
    $("#mapModalHint").textContent = data.real
      ? "Ruta orientativa por carretera, sin tráfico en vivo. El precio final y el recorrido se confirman con el equipo."
      : "Ruta aproximada en línea recta — no se pudo calcular la ruta exacta por carretera en este momento.";
    setTimeout(() => map.invalidateSize(), 60);
  }

  function closeMapModal() {
    mapOpenGeneration++;
    M360UI.close('mapModal');
  }

  function wireMapModal() {
    $('#mapModalCenter').addEventListener('click', () => {
      if (map && mapContext !== 'view-route') map.fire('click', { latlng: map.getCenter() });
    });
    $$("[data-open-map]").forEach((btn) => {
      btn.addEventListener("click", () => openMapModal(btn.dataset.openMap));
    });
    $$("[data-view-route]").forEach((btn) => {
      btn.addEventListener("click", () => openRouteView(btn.dataset.viewRoute));
    });
    $("#mapModalClose").addEventListener("click", closeMapModal);
    $("#mapModal").addEventListener("click", (e) => {
      if (e.target.id === "mapModal") closeMapModal();
    });
    $("#mapModalConfirm").addEventListener("click", () => {
      if (marker) pendingLatLng = marker.getLatLng();
      if (!pendingLatLng) return;
      const place = {
        name: `Punto en el mapa (${pendingLatLng.lat.toFixed(3)}, ${pendingLatLng.lng.toFixed(3)})`,
        lat: pendingLatLng.lat,
        lng: pendingLatLng.lng,
      };
      if (mapContext === "movilizarte") selectMovilizarteDestination(place);
      if (mapContext === "origin") selectOriginFromSearch(place);
      if (mapContext === "airport-destination") selectAirportDestination(place);
      if (mapContext === "departamento") selectDepartment(place);
      if (mapContext === "turismo") selectTourism(place);
      if (mapContext === "parcel-from") selectParcelPoint("from", place);
      if (mapContext === "parcel-to") selectParcelPoint("to", place);
      if (mapContext === "mudanza-from") selectMudanzaPoint("from", place);
      if (mapContext === "mudanza-to") selectMudanzaPoint("to", place);
      closeMapModal();
    });
  }

  /* =====================================================================
     Confirmar viaje — resumen final antes de enviar por WhatsApp
     Se muestra SIEMPRE la política de cancelación al solicitar el viaje,
     y se elige el método de pago (efectivo o transferencia) en este paso.
     ===================================================================== */
  let confirmModalCtx = null;
  let confirmPaymentMethod = CONFIG.paymentMethods[0];
  let confirmRecipient = "self"; // "self" | "other"
  let confirmBankChoice = null; // { bank, number } cuando el pago es por transferencia
  const confirmationDrafts = new Map();

  // Cliente frecuente: no hay cuentas ni backend, así que esto es solo un
  // contador local del navegador (se resetea si borra el caché o cambia de
  // dispositivo) — sirve como recordatorio motivacional, no como control
  // real. El descuento real siempre lo decide el equipo por WhatsApp
  // (honor system: el cliente lo menciona, el equipo confirma el precio).
  function renderConfirmRows(rows) {
    $("#confirmRows").innerHTML = rows
      .map((r) => `<div class="confirm-row"><span>${escapeHtml(r.label)}</span><strong>${escapeHtml(r.value)}</strong></div>`)
      .join("");
  }

  function renderConfirmPaymentPills() {
    $("#confirmPaymentPills").innerHTML = CONFIG.paymentMethods.map(
      (m) => `<button type="button" class="pill-option${m === confirmPaymentMethod ? " selected" : ""}" data-method="${m}" aria-pressed="${m === confirmPaymentMethod}">${m}</button>`
    ).join("");
    $$("#confirmPaymentPills .pill-option").forEach((btn) => {
      btn.addEventListener("click", () => {
        confirmPaymentMethod = btn.dataset.method;
        $$("#confirmPaymentPills .pill-option").forEach((b) => {
          b.classList.toggle("selected", b === btn);
          b.setAttribute("aria-pressed", String(b === btn));
        });
        renderConfirmBankAccounts();
      });
    });
  }

  // Cuentas para transferencia (BAC / Cuenta Agrícola): solo se muestran si
  // el método de pago elegido es "Transferencia". El cliente elige una y
  // puede copiar el número con un botón.
  function renderConfirmBankAccounts() {
    const box = $('#confirmBankAccounts');
    if (!box) return;
    box.hidden = confirmPaymentMethod !== 'Transferencia' || !CONFIG.bankAccounts?.length;
    const notice = $('#confirmTransferNotice'); if (notice) notice.hidden = box.hidden;
    if (box.hidden) { confirmBankChoice = null; return; }
    if (!confirmBankChoice) confirmBankChoice = CONFIG.bankAccounts[0];
    box.innerHTML = CONFIG.bankAccounts.map(acc => `
      <div class="confirm-bank-account" data-bank="${escapeHtml(acc.bank)}" data-number="${escapeHtml(acc.number)}">
        <button type="button" class="confirm-bank-select" aria-pressed="false"><b>${escapeHtml(acc.bank)}</b><span>${escapeHtml(acc.number)}</span></button>
        <button type="button" class="confirm-bank-copy" aria-label="Copiar cuenta de ${escapeHtml(acc.bank)}">Copiar</button>
      </div>`).join('');
    const sync = () => $$('.confirm-bank-account',box).forEach(row=>{
      const selected = row.dataset.number === confirmBankChoice.number;
      row.classList.toggle('selected',selected);
      $('.confirm-bank-select',row).setAttribute('aria-pressed',String(selected));
    });
    const choose = row => { confirmBankChoice={bank:row.dataset.bank,number:row.dataset.number}; sync(); };
    $$('.confirm-bank-account',box).forEach(row=>{
      $('.confirm-bank-select',row).addEventListener('click',()=>choose(row));
      $('.confirm-bank-copy',row).addEventListener('click',async e=>{
        choose(row); const button=e.currentTarget;
        try { await navigator.clipboard.writeText(row.dataset.number); button.textContent='¡Copiado!'; }
        catch { button.textContent='Copia el número visible'; }
      });
    });
    sync();
  }

  function renderConfirmRecipientPills() {
    $$("#confirmRecipientPills .pill-option").forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.recipient === confirmRecipient);
      btn.setAttribute("aria-pressed", String(btn.dataset.recipient === confirmRecipient));
    });
    $("#confirmRecipientFields").hidden = confirmRecipient !== "other";
  }

  function renderCancellationNotice(price) {
    const el = $("#confirmCancellation");
    const isFee = price != null && price > CONFIG.cancellation.freeThresholdUsd;
    el.textContent = (isFee ? "⚠️ " : price == null ? "ℹ️ " : "✅ ") + cancellationLine(price);
    el.classList.toggle("is-fee", isFee);
  }

  function openConfirmModal({ rows, price, buildMessage, key = 'request' }) {
    confirmModalCtx = { buildMessage, key };
    renderConfirmRows(rows);
    renderConfirmPaymentPills();
    renderConfirmBankAccounts();
    renderCancellationNotice(price);

    // Se reinician los campos opcionales (destinatario / negociación) en
    // cada apertura para que no se filtre información de una cotización a
    // otra sin querer.
    const draft = confirmationDrafts.get(key) || {};
    confirmRecipient = draft.recipient || "self";
    renderConfirmRecipientPills();
    $("#confirmRecipientName").value = draft.name || "";
    $("#confirmRecipientPhone").value = draft.phone || "";
    $("#confirmNegotiatePanel").hidden = !draft.negotiate;
    $("#confirmNegotiatePrice").value = draft.price || "";
    $("#confirmNegotiateToggle").classList.toggle("is-active", !!draft.negotiate);
    $('#confirmNegotiateToggle').setAttribute('aria-expanded', String(!!draft.negotiate));
    $('#confirmError').hidden = true;

    const frequentNote = $("#confirmFrequentNote");
    if (frequentNote) { frequentNote.hidden = false; frequentNote.open = false; }
    if (globalThis.M360Request) M360Request.open(key, key.split(':')[0], captureSavedRoute(key.split(':')[0], rows));

    trackEvent('quote_review', { service: key.split(':')[0] });
    M360UI.open('confirmModal');
  }

  function closeConfirmModal() {
    if (confirmModalCtx && globalThis.M360Request) M360Request.remember(confirmModalCtx.key);
    if (confirmModalCtx) confirmationDrafts.set(confirmModalCtx.key, {
      recipient:confirmRecipient, name:$('#confirmRecipientName').value, phone:$('#confirmRecipientPhone').value,
      negotiate:!$('#confirmNegotiatePanel').hidden, price:$('#confirmNegotiatePrice').value
    });
    M360UI.close('confirmModal');
    confirmModalCtx = null;
  }

  function wireConfirmModal() {
    $("#confirmModalClose").addEventListener("click", closeConfirmModal);
    $("#confirmEditBtn").addEventListener("click", closeConfirmModal);
    $("#confirmModal").addEventListener("click", (e) => {
      if (e.target.id === "confirmModal") closeConfirmModal();
    });

    $$("#confirmRecipientPills .pill-option").forEach((btn) => {
      btn.addEventListener("click", () => {
        confirmRecipient = btn.dataset.recipient;
        renderConfirmRecipientPills();
      });
    });

    $("#confirmNegotiateToggle").addEventListener("click", (e) => {
      const panel = $("#confirmNegotiatePanel");
      panel.hidden = !panel.hidden;
      e.currentTarget.classList.toggle("is-active", !panel.hidden);
      e.currentTarget.setAttribute('aria-expanded', String(!panel.hidden));
      if (!panel.hidden) $('#confirmNegotiatePrice').focus();
    });

    $("#confirmSendBtn").addEventListener("click", () => {
      if (!confirmModalCtx) return;
      const fail = (text, field) => { $('#confirmError').textContent = text; $('#confirmError').hidden = false; $('#confirmError').dataset.field = field?.id || ''; field?.focus(); };
      const plan = M360Request.read();
      if (plan.error) { fail(plan.error, document.getElementById(plan.field)); return; }
      let msg = confirmModalCtx.buildMessage(confirmPaymentMethod);
      msg += M360Request.message(plan);

      if (confirmRecipient === "other") {
        const name = sanitizeWaText($("#confirmRecipientName").value.trim());
        const phone = M360Core.phone($("#confirmRecipientPhone").value);
        if (name.length < 2) { fail('Escribe el nombre de la persona que viajará.', $('#confirmRecipientName')); return; }
        if (!phone) { fail('Escribe un teléfono válido para coordinar con quien viajará.', $('#confirmRecipientPhone')); return; }
        msg += `\n\n*Este viaje es para:* ${name}\n*Teléfono para coordinar:* ${phone}`;
      }

      if (confirmPaymentMethod === "Transferencia" && confirmBankChoice) {
        msg += `\n*Transferencia a:* ${confirmBankChoice.bank} — cuenta ${confirmBankChoice.number}`;
      }

      const negotiatePrice = $("#confirmNegotiatePrice").value.trim();
      const negotiatePriceNum = Number(negotiatePrice);
      // El input es type="number" min="0", pero como este modal no es un
      // <form> que se envía, esa validación del navegador nunca se dispara
      // — sin este chequeo, un valor no numérico mandaba "$NaN" al mensaje,
      // y uno negativo se enviaba tal cual.
      if (!$('#confirmNegotiatePanel').hidden && (!negotiatePrice || !Number.isFinite(negotiatePriceNum) || negotiatePriceNum <= 0 || negotiatePriceNum > 10000)) {
        fail('Indica una propuesta válida mayor que cero y de hasta $10,000, o desactiva la negociación.', $('#confirmNegotiatePrice')); return;
      }
      if (!$('#confirmNegotiatePanel').hidden && negotiatePrice && Number.isFinite(negotiatePriceNum) && negotiatePriceNum > 0) {
        msg += `\n*Precio propuesto por el cliente:* ${formatMoney(negotiatePriceNum)} (a negociar, sujeto a tráfico, hora, aire acondicionado y clima).`;
      }

      trackEvent("request_handoff", { service: confirmModalCtx.key.split(':')[0] });
      const url = waLink(msg);
      window.open(url, "_blank", "noopener");
      closeConfirmModal();
      const handoff = $('#requestHandoff');
      handoff.hidden = false;
      $('#requestContinue').onclick = () => window.open(url,'_blank','noopener');
      handoff.scrollIntoView({block:'center',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
      $('#requestHandoffTitle').focus();
    });
  }

  /* =====================================================================
     Mapa de cobertura (visual, carga diferida al llegar a la sección)
     ===================================================================== */
  let coverageMapRequested = false;
  function initCoverageMapIfNeeded() {
    if (coverageMapRequested) return;
    coverageMapRequested = true;
    loadLeaflet()
      .then(() => {
        // El mapa arranca "bloqueado" (sin arrastre/zoom táctil) para que
        // al hacer scroll por la página y pasar sobre el mapa, el dedo
        // siga moviendo la página en vez de mover el mapa — un problema
        // clásico de mapas embebidos en móvil. Un toque lo "activa".
        const cmap = L.map("coverage-map", {
          scrollWheelZoom: false,
          dragging: false,
          touchZoom: false,
          doubleClickZoom: false,
          boxZoom: false,
        }).setView([13.85, -89.1], 8);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "&copy; colaboradores de OpenStreetMap",
          maxZoom: 18,
        }).addTo(cmap);
        DEPARTMENTS.forEach((d) => {
          L.marker([d.lat, d.lng])
            .addTo(cmap)
            .bindPopup(`<b>${d.name}</b><br>${d.tag}`);
        });
        setTimeout(() => cmap.invalidateSize(), 150);

        const hint = $("#coverageMapHint");
        if (hint) {
          let interactive = false;
          hint.addEventListener("click", () => {
            interactive = !interactive;
            for (const type of ['dragging','touchZoom','doubleClickZoom','boxZoom','scrollWheelZoom']) cmap[type][interactive?'enable':'disable']();
            hint.textContent = interactive ? 'Terminar de explorar' : 'Explorar mapa';
            hint.setAttribute('aria-pressed',String(interactive));
          });
        }
      })
      .catch(() => {
        coverageMapRequested = false;
        const el = $("#coverage-map");
        if (el) el.textContent = "No se pudo cargar el mapa de cobertura. Verifica tu conexión a internet.";
        const hint = $('#coverageMapHint');
        if (hint) { hint.textContent = 'Reintentar mapa'; hint.onclick = () => { hint.onclick = null; initCoverageMapIfNeeded(); }; }
      });
  }

  function wireCoverageMap() {
    const section = $("#coverage-map");
    if (!section) return;
    if ("IntersectionObserver" in window) {
      const obs = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) {
              initCoverageMapIfNeeded();
              obs.disconnect();
            }
          });
        },
        { rootMargin: "200px" }
      );
      obs.observe(section);
    } else {
      initCoverageMapIfNeeded();
    }
  }

  /* =====================================================================
     Testimonios / vehículos (contenido editable desde data.js)
     ===================================================================== */
  // Dibuja "★★★★☆" para una calificación de 1 a 5. Devuelve "" si el
  // valor no es un número válido en ese rango (la tarjeta va sin estrellas).
  function renderStars(rating) {
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) return "";
    const full = Math.round(rating);
    return "★".repeat(full) + "☆".repeat(5 - full);
  }

  function renderTestimonials() {
    const grid = $("#testimonials-grid");
    if (!grid) return;
    const items = (Array.isArray(TESTIMONIALS) ? TESTIMONIALS : []).filter(t =>
      t && typeof t.name === "string" && t.name.trim() && typeof t.quote === "string" && t.quote.trim());
    const section = grid.closest(".reviews-section");
    const note = $("#testimonials-note");
    if (note) note.hidden = !items.length;
    if (section) section.classList.toggle("has-testimonials", items.length > 0);
    let sourceUrl = "";
    try {
      const url = new URL(CONFIG.googleReviewsUrl);
      if (url.protocol === "https:" && ["g.page", "www.google.com", "maps.google.com", "maps.app.goo.gl"].includes(url.hostname)) sourceUrl = url.href;
    } catch { /* Invalid source: omit the external link. */ }
    const summary = $("#google-rating-summary"), dateNote = $("#google-rating-date");
    const snapshot = CONFIG.googleReviewsSnapshot;
    const checkedDate = /^\d{4}-\d{2}-\d{2}$/.test(snapshot?.checkedOn || "") ? new Date(snapshot.checkedOn + "T12:00:00Z") : null;
    const validSnapshot = sourceUrl && Number.isFinite(snapshot?.rating) && snapshot.rating >= 1 && snapshot.rating <= 5 && Number.isInteger(snapshot?.count) && snapshot.count > 0 && checkedDate && Number.isFinite(checkedDate.getTime());
    if (summary) {
      summary.hidden = !validSnapshot;
      summary.textContent = validSnapshot ? `${snapshot.rating.toFixed(1).replace(".", ",")} de 5 · ${snapshot.count} ${snapshot.count === 1 ? "opinión" : "opiniones"} en Google` : "";
    }
    if (dateNote) {
      dateNote.hidden = !validSnapshot;
      dateNote.textContent = validSnapshot ? `Consultado el ${checkedDate.toLocaleDateString("es-SV", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}. Actualización manual, no en tiempo real.` : "";
    }
    // Sin testimonios reales todavía: no dibujamos tarjetas vacías.
    if (!items.length) {
      grid.innerHTML = "";
      grid.hidden = true;
      return;
    }
    grid.hidden = false;
    grid.innerHTML = items
      .map(
        (t) => `
      <figure class="testimonial-card">
        ${renderStars(t.rating) ? `<span class="review-stars" role="img" aria-label="${t.rating} de 5 estrellas">${renderStars(t.rating)}</span>` : ""}
        <blockquote>“${escapeHtml(t.quote)}”</blockquote>
        <figcaption><strong>${escapeHtml(t.name)}</strong><span>Extracto de una opinión pública</span>
          ${sourceUrl ? `<a class="review-source" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">Fuente: Google Maps</a>` : ""}
        </figcaption>
      </figure>`
      )
      .join("");
  }

  const VEHICLE_ICONS = {
    sedan: '<path d="M4 16l1.5-5.5A2 2 0 0 1 7.4 9h9.2a2 2 0 0 1 1.9 1.5L20 16"/><rect x="3" y="16" width="18" height="4" rx="1.4"/><circle cx="7.5" cy="20" r="1.6"/><circle cx="16.5" cy="20" r="1.6"/><path d="M7 13h10"/>',
    suv: '<path d="M3.5 16l1-6A2 2 0 0 1 6.4 8.5h11.2A2 2 0 0 1 19.5 10l1 6"/><rect x="2.5" y="16" width="19" height="4.2" rx="1.4"/><circle cx="7.5" cy="20.4" r="1.6"/><circle cx="16.5" cy="20.4" r="1.6"/><path d="M6.5 12.5h11M4 6.5h5"/>',
    van: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M3 12h18M8 7v10" /><rect x="3" y="16.6" width="18" height="3.6" rx="1.2"/><circle cx="7.5" cy="20.6" r="1.5"/><circle cx="16.5" cy="20.6" r="1.5"/>',
    pickup: '<path d="M2.5 15.5V10h6v5.5"/><path d="M8.5 11h4.5l3.5 3.2v1.3h-8"/><rect x="2.5" y="8" width="6" height="2" /><circle cx="6" cy="18" r="1.6"/><circle cx="16" cy="18" r="1.6"/><path d="M2.5 15.5h1.9M16.5 15.5h2"/>',
  };

  function renderVehicles() {
    const grid = $("#vehicles-grid");
    if (!grid) return;
    grid.innerHTML = VEHICLES.map((v, i) => {
      const photos = (v.units || []).map((u) => u.photo).filter(Boolean);
      return `
      <button type="button" class="vehicle-card" data-idx="${i}">
        <div class="vehicle-media">
          ${
            photos.length
              ? `<img class="vehicle-photo" src="/${photos[0]}" alt="${v.type}" loading="lazy" data-photos='${JSON.stringify(photos)}' data-photo-idx="0">`
              : `<svg class="vehicle-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${VEHICLE_ICONS[v.icon] || ""}</svg>`
          }
          ${
            photos.length > 1
              ? `<div class="vehicle-media-dots">${photos.map((_, di) => `<span class="vehicle-media-dot${di === 0 ? " on" : ""}"></span>`).join("")}</div>`
              : ""
          }
          <span class="vehicle-card-cta">Ver detalles</span>
        </div>
        <h4>${v.type}</h4>
        <p class="vehicle-capacity">${v.capacity}</p>
        <p class="vehicle-desc">${v.desc}</p>
      </button>`;
    }).join("");
    wireVehicleCardTilt();
    // Vehicle photos change only when the user opens/navigates the fleet viewer.
  }

  // Junta los conductores reales desde VEHICLES (un mismo conductor puede
  // manejar más de una unidad, ej. Edwin maneja el Spark y el Forland — en
  // ese caso aparece una sola vez con ambos tipos de vehículo listados).
  function collectDrivers() {
    const map = new Map();
    VEHICLES.forEach((v) => {
      (v.units || []).forEach((u) => {
        if (!u.driverName) return;
        if (!map.has(u.driverName)) {
          map.set(u.driverName, {
            name: u.driverName,
            photo: u.driverPhoto,
            trips: u.trips,
            experience: u.experience,
            vehicleTypes: [],
          });
        }
        const driver = map.get(u.driverName);
        if (!driver.vehicleTypes.includes(v.type)) driver.vehicleTypes.push(v.type);
      });
    });
    return Array.from(map.values());
  }

  function renderDrivers() {
    const section = document.querySelector(".drivers-section");
    const grid = $("#drivers-grid");
    if (!grid) return;
    const drivers = collectDrivers();
    if (!drivers.length) {
      if (section) section.hidden = true;
      return;
    }
    grid.innerHTML = drivers
      .map(
        (d) => `
      <div class="driver-card">
        <div class="driver-avatar">${
          d.photo ? `<img src="/${d.photo}" alt="${d.name}" loading="lazy">` : DRIVER_PLACEHOLDER_ICON
        }</div>
        <p class="driver-name">${d.name}</p>
        <p class="driver-vehicles">${d.vehicleTypes.join(" · ")}</p>
        <div class="driver-badges">
          ${d.experience ? `<span class="driver-badge">${d.experience}</span>` : ""}
          ${d.trips != null ? `<span class="driver-badge">${d.trips.toLocaleString("es-SV")}+ viajes</span>` : ""}
        </div>
        <span class="driver-verified">Datos del equipo</span>
      </div>`
      )
      .join("");
  }

  // Para tipos de vehículo con varias fotos reales (ej. Sedán), las va
  // rotando automáticamente para mostrar que puede llegar cualquiera de
  // esos autos — el cliente no elige el vehículo específico.


  // Efecto de tarjeta "fluida": inclinación 3D que sigue el cursor, para
  // que al pasar el mouse la tarjeta se sienta viva y la imagen/ícono del
  // vehículo se aprecie mejor. Al tocar/hacer clic, la tarjeta queda
  // resaltada como "en vista" (no es una selección de reserva: el vehículo
  // real lo asigna el equipo).
  function wireVehicleCardTilt() {
    const grid = $("#vehicles-grid");
    if (!grid) return;
    $$(".vehicle-card", grid).forEach((card) => {
      card.addEventListener("mousemove", (e) => {
        const rect = card.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        card.style.setProperty("--ry", `${x * 16}deg`);
        card.style.setProperty("--rx", `${-y * 16}deg`);
      });
      card.addEventListener("mouseleave", () => {
        card.style.setProperty("--ry", "0deg");
        card.style.setProperty("--rx", "0deg");
      });
      card.addEventListener("click", () => {
        $$(".vehicle-card", grid).forEach((c) => c.classList.remove("selected"));
        card.classList.add("selected");
        const v = VEHICLES[Number(card.dataset.idx)];
        openVehicleModal(v);
      });
    });
  }

  /* =====================================================================
     Detalle de vehículo — al escoger una tarjeta de la flota, se abre un
     modal con la(s) unidad(es) reales de ese tipo: foto, modelo, placa y
     los datos del conductor. Los datos del conductor son un ejemplo
     (⚠️ placeholder en data.js) hasta que el cliente entregue los reales.
     ===================================================================== */
  let vehicleModalCtx = null; // { vehicle, idx }
  let vehicleTransitionTimer = null;


  const DRIVER_PLACEHOLDER_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c1.4-3.6 4.4-5.5 7.5-5.5s6.1 1.9 7.5 5.5"/></svg>';

  function renderVehicleModalUnit(enterDir) {
    const { vehicle, idx } = vehicleModalCtx;
    const units = vehicle.units || [];
    $("#vehicleModalTitle").textContent = vehicle.type;

    const media = $("#vehicleModalMedia");
    const info = $("#vehicleModalInfo");
    const tabs = $("#vehicleModalTabs");

    if (!units.length) {
      media.innerHTML = `<div class="vehicle-modal-empty"><svg class="vehicle-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${VEHICLE_ICONS[vehicle.icon] || ""}</svg></div>`;
      info.innerHTML = `<p class="vehicle-modal-pending">Todavía no tenemos fotos de este tipo de vehículo en el sistema. No te preocupes: te compartimos el vehículo y el conductor asignado por WhatsApp antes de tu viaje.</p>`;
      tabs.innerHTML = "";
      return;
    }

    const u = units[idx];
    const enterClass = enterDir === "bwd" ? " enter-bwd" : "";
    const nav =
      units.length > 1
        ? `
      <button type="button" class="vehicle-modal-nav prev" aria-label="Vehículo anterior">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>
      </button>
      <button type="button" class="vehicle-modal-nav next" aria-label="Siguiente vehículo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
      </button>
      <span class="vehicle-modal-counter">${idx + 1} / ${units.length}</span>`
        : "";
    media.innerHTML = `<img src="/${u.photo}" alt="${vehicle.type} — ${u.model}" class="vehicle-modal-photo-fade${enterClass}">${nav}`;
    info.innerHTML = `
      <div class="vehicle-modal-row vehicle-modal-fade${enterClass}">
        <div>
          <h5>${u.model}</h5>
          <p class="vehicle-modal-color">${u.color} · ${vehicle.capacity}</p>
        </div>
        <span class="vehicle-modal-plate">${u.plate}</span>
      </div>
      <div class="vehicle-modal-driver vehicle-modal-fade${enterClass}">
        <div class="vehicle-modal-avatar">${u.driverPhoto ? `<img src="/${u.driverPhoto}" alt="${u.driverName}">` : DRIVER_PLACEHOLDER_ICON}</div>
        <div class="vehicle-modal-driver-text">
          <p class="vehicle-modal-driver-name">${u.driverName}</p>
          <p class="vehicle-modal-driver-meta">${
            u.rating != null ? `<span class="vehicle-modal-stars">${renderStars(u.rating)}</span> ${u.rating.toFixed(1)} · ` : ""
          }${u.trips} viajes completados${u.experience ? ` · ${u.experience}` : ""}</p>
        </div>
        <span class="vehicle-modal-verified">Datos del equipo</span>
      </div>
    `;

    tabs.innerHTML =
      units.length > 1
        ? units
            .map(
              (uu, i) =>
                `<button type="button" class="vehicle-modal-tab${i === idx ? " active" : ""}" data-idx="${i}" aria-pressed="${i === idx}">${uu.model.split(" ")[0]}</button>`
            )
            .join("")
        : "";
    $$(".vehicle-modal-tab", tabs).forEach((btn) => {
      btn.addEventListener("click", () => goToVehicleUnit(Number(btn.dataset.idx)));
    });

    if (units.length > 1) {
      $(".vehicle-modal-nav.prev", media).addEventListener("click", () => goToVehicleUnit((idx - 1 + units.length) % units.length, false));
      $(".vehicle-modal-nav.next", media).addEventListener("click", () => goToVehicleUnit((idx + 1) % units.length, true));
    }
  }

  // Cambia de unidad con una transición direccional (como un carrusel):
  // la tarjeta actual sale suavemente hacia el lado por el que "entró" y
  // la nueva llega desde el lado contrario. La salida es más corta que
  // la entrada — la entrada es el momento con autoría, la salida solo
  // despeja el paso.
  // "forwardHint" lo pasan las flechas (true = siguiente, false =
  // anterior) porque en el ciclo (del último al primero) comparar los
  // índices directamente da la dirección al revés; al elegir una
  // pestaña directamente, no hay pista y se infiere por el índice.
  function goToVehicleUnit(newIdx, forwardHint) {
    if (!vehicleModalCtx || vehicleModalCtx.animating) return;
    const { idx } = vehicleModalCtx;
    if (newIdx === idx) return;
    const forward = typeof forwardHint === "boolean" ? forwardHint : newIdx > idx;
    vehicleModalCtx.animating = true;

    const media = $("#vehicleModalMedia");
    const info = $("#vehicleModalInfo");
    const leavingEls = [...$$(".vehicle-modal-photo-fade", media), ...$$(".vehicle-modal-fade", info)];
    leavingEls.forEach((el) => el.classList.add("leaving", forward ? "leave-fwd" : "leave-bwd"));

    const focusClass = document.activeElement?.classList.contains('prev') ? '.vehicle-modal-nav.prev' :
      document.activeElement?.classList.contains('next') ? '.vehicle-modal-nav.next' : '.vehicle-modal-tab.active';
    const session = vehicleModalCtx;
    vehicleTransitionTimer = setTimeout(() => {
      if (vehicleModalCtx !== session) return;
      vehicleModalCtx.idx = newIdx;
      renderVehicleModalUnit(forward ? "fwd" : "bwd");
      vehicleModalCtx.animating = false;
      $(focusClass)?.focus({preventScroll:true});
    }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 170);
  }

  function openVehicleModal(vehicle) {
    clearTimeout(vehicleTransitionTimer);
    vehicleModalCtx = { vehicle, idx: 0 };
    renderVehicleModalUnit();
    M360UI.open('vehicleModal');
    trackEvent("vehicle_view", { vehicle_type: vehicle.type });
  }

  function closeVehicleModal() {
    clearTimeout(vehicleTransitionTimer);
    M360UI.close('vehicleModal');
    vehicleModalCtx = null;
  }

  function wireVehicleModal() {
    $("#vehicleModalClose").addEventListener("click", closeVehicleModal);
    $("#vehicleModalClose2").addEventListener("click", closeVehicleModal);
    $("#vehicleModal").addEventListener("click", (e) => {
      if (e.target.id === "vehicleModal") closeVehicleModal();
    });
    $("#vehicleModalWa").addEventListener("click", () => {
      if (!vehicleModalCtx) return;
      const { vehicle, idx } = vehicleModalCtx;
      const unit = (vehicle.units || [])[idx];
      const msg =
        `Hola *MOVILIDAD 360 SV*\n\n` +
        `Me interesa reservar un viaje con un vehículo tipo *${vehicle.type}*` +
        (unit ? ` (ej. ${unit.model}).` : `.`) +
        `\n¿Podrían darme más información?`;
      trackEvent("whatsapp_click", { link_id: "vehicle-modal" });
      window.open(waLink(msg), "_blank", "noopener");
      closeVehicleModal();
    });
  }

  function renderStats() {
    const tripsEl = $("#stat-trips");
    if (tripsEl) tripsEl.textContent = `+${CONFIG.tripsCompleted}`;
    const responseEls = $$(".response-badge-text");
    responseEls.forEach((el) => {
      el.textContent = `Respuesta estimada: ~${CONFIG.responseMinutes} min`;
    });
    // Umbral de cancelación gratuita en la barra de confianza — un solo
    // origen de verdad (CONFIG.cancellation), igual que en el FAQ y el
    // modal de confirmación.
    const cancelThresholdEl = $("#trust-cancel-threshold");
    if (cancelThresholdEl) cancelThresholdEl.textContent = CONFIG.cancellation.freeThresholdUsd;
    // Tarifa mínima mencionada en los avisos de "¿cómo se calcula el
    // precio?" bajo cada cotización — mismo CONFIG.minFareUsd que usa
    // estimatePrice(), para que nunca queden desincronizados.
    $$(".min-fare-amount").forEach((el) => {
      el.textContent = CONFIG.minFareUsd.toFixed(2).replace(/\.00$/, "");
    });
  }

  function renderFAQ() {
    const list = $("#faq-list");
    if (!list) return;
    list.innerHTML = FAQS.map(
      (item, i) => `
      <div class="faq-item">
        <button type="button" class="faq-question" id="faq-q-${i}" aria-expanded="false" aria-controls="faq-a-${i}">
          <span>${item.q}</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        </button>
        <div class="faq-answer" hidden id="faq-a-${i}" role="region" aria-labelledby="faq-q-${i}">
          <p>${item.a}</p>
        </div>
      </div>`
    ).join("");

    $$(".faq-question", list).forEach((btn) => {
      btn.addEventListener("click", () => {
        const answer = document.getElementById(btn.getAttribute("aria-controls"));
        const isOpen = answer.classList.toggle("open");
        answer.hidden = !isOpen;
        btn.setAttribute("aria-expanded", String(isOpen));
        btn.classList.toggle("open", isOpen);
      });
    });
  }

  // Enlaza los botones de reseñas de Google. Cada botón solo se muestra si
  // su URL correspondiente está configurada en data.js (CONFIG):
  //   #google-reviews-link  → CONFIG.googleReviewsUrl    (ver la ficha)
  //   #google-write-review  → CONFIG.googleWriteReviewUrl (dejar reseña)
  function wireGoogleReviewsLink() {
    const viewEl = $("#google-reviews-link");
    if (viewEl && CONFIG.googleReviewsUrl) {
      viewEl.href = CONFIG.googleReviewsUrl;
      viewEl.hidden = false;
    }
    const writeEl = $("#google-write-review");
    if (writeEl && CONFIG.googleWriteReviewUrl) {
      writeEl.href = CONFIG.googleWriteReviewUrl;
      writeEl.hidden = false;
    }
  }

  /* =====================================================================
     Analítica (lista para activar en cuanto se conecte Google Analytics)
     ===================================================================== */
  function trackEvent(name, params) {
    if (typeof window.m360Track === 'function') window.m360Track(name, params);
  }

  function wireAnalyticsEvents() {
    document.addEventListener('click', e => {
      const link = e.target.closest('a[href*="wa.me"]');
      if (!link) return;
      trackEvent(link.href.includes('50375308948') ? 'agency_contact' : 'contact_handoff', { action: link.id || 'link' });
    });
  }

  /* =====================================================================
     Botón "Instalar app": dispara el prompt nativo de instalación
     (Chrome/Android/Edge) o, si el navegador no lo soporta (Safari/iOS),
     muestra instrucciones manuales para agregarlo a la pantalla de inicio.
     ===================================================================== */
  function isRunningInstalled() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true
    );
  }

  function wireInstallFloat() {
    const btn = $("#float-install");
    const tip = $("#installTip");
    if (!btn) return;

    if (isRunningInstalled()) {
      btn.hidden = true;
      return;
    }

    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
      btn.hidden = true;
      if (tip) tip.hidden = true;
      trackEvent("pwa_installed", {});
    });

    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

    btn.addEventListener("click", async (e) => {
      e.preventDefault();

      if (deferredInstallPrompt) {
        if (tip) tip.hidden = true;
        deferredInstallPrompt.prompt();
        try {
          const choice = await deferredInstallPrompt.userChoice;
          trackEvent("pwa_install_prompt", { outcome: choice.outcome, link_id: "float-install" });
        } catch (err) {
          /* el usuario cerró el prompt; no hay nada más que hacer */
        }
        deferredInstallPrompt = null;
        return;
      }

      // El navegador no soporta el prompt nativo (Safari/iOS, o Chrome que
      // aún no decidió mostrarlo): mostramos instrucciones manuales.
      if (!tip) return;
      tip.textContent = isIOS
        ? "Para instalarla: toca el ícono de Compartir ⬆️ en Safari y luego \"Agregar a pantalla de inicio\"."
        : "Busca la opción \"Instalar app\" o \"Agregar a pantalla de inicio\" en el menú (⋮) de tu navegador.";
      tip.hidden = !tip.hidden;
      trackEvent("pwa_install_instructions_shown", { link_id: "float-install" });
    });

    document.addEventListener("click", (e) => {
      if (!tip || tip.hidden) return;
      if (!e.target.closest("#float-install") && !e.target.closest("#installTip")) {
        tip.hidden = true;
      }
    });
  }

  /* =====================================================================
     PWA: registro del service worker (instalable / carga más rápida)
     ===================================================================== */
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !['movilidad360sv.com','www.movilidad360sv.com'].includes(location.hostname)) return;
    let applying = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (applying) location.reload(); });
    navigator.serviceWorker.register('/sw.js').then(reg => {
      const offer = () => {
        if (!reg.waiting || !navigator.serviceWorker.controller) return;
        const notice = $('#updateNotice');
        if (!notice) return;
        notice.hidden = false;
        $('#dismissUpdate').onclick = () => { notice.hidden = true; };
        $('#applyUpdate').onclick = () => {
          if ($('#paradas')) persistAll();
          applying = true; reg.waiting.postMessage({type:'ACTIVATE_UPDATE'});
        };
      };
      offer();
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        installing?.addEventListener('statechange', () => { if (installing.state === 'installed') offer(); });
      });
    }).catch(() => { /* Browsing remains available without offline installation. */ });
  }

  /* =====================================================================
     Paneles expandibles (toggle)
     ===================================================================== */
  function wireTogglePanels() {
    $$("[data-toggle]").forEach((btn) => {
      const panel = document.getElementById(btn.dataset.toggle);
      panel.hidden = true; panel.inert = true;
      btn.setAttribute('aria-controls', panel.id);
      btn.addEventListener("click", () => {
        const isOpen = panel.classList.toggle("open");
        panel.hidden = !isOpen; panel.inert = !isOpen;
        btn.setAttribute("aria-expanded", String(isOpen));
        const icon = btn.querySelector("svg");
        if (icon) icon.style.transform = isOpen ? "rotate(45deg)" : "rotate(0deg)";
      });
    });
  }

  /* =====================================================================
     Video tutorial del hero: carga perezosa + autoplay en bucle
     El <video> arranca SIN <source src> real (solo data-src) para no
     descargar nada hasta que de verdad esté a la vista. En cuanto entra al
     viewport se le asigna el src, se reproduce en bucle (muted, requisito
     de los navegadores para autoplay), y si sale de pantalla se pausa sin
     volver a descargarlo — así no sigue consumiendo batería/CPU de fondo,
     pero tampoco hay que re-descargar el video cada vez que se desplaza de
     un lado a otro de la página.
     ===================================================================== */
  function wireHeroVideo() {
    const video = document.querySelector(".hero-video");
    if (!video) return;
    const source = video.querySelector("source[data-src]");
    if (!source) return;
    video.controls = true;
    const restricted = window.matchMedia('(prefers-reduced-motion: reduce)').matches || navigator.connection?.saveData;

    let loaded = false, inView = false, userPaused = false;
    video.addEventListener('pause',()=>{ if(inView && !document.hidden) userPaused=true; });
    video.addEventListener('play',()=>{ userPaused=false; });
    document.addEventListener('visibilitychange',()=>{ if(document.hidden) video.pause(); else if(inView && !restricted && !userPaused) tryPlay(); });
    function ensureLoaded() {
      if (loaded) return;
      loaded = true;
      source.src = source.dataset.src;
      video.load();
    }
    const playButton = $('#playTutorial');
    if (playButton) playButton.addEventListener('click', () => { ensureLoaded(); video.play().catch(()=>{playButton.textContent='Reintentar reproducción';}); });
    function tryPlay() {
      ensureLoaded();
      // El navegador puede bloquear el autoplay (poco común con muted,
      // pero pasa en algún navegador viejo o con datos ahorrados) — no es
      // un error real del sitio, el video simplemente se queda en el
      // poster hasta que el cliente lo toque.
      video.play().catch(() => {});
    }

    if (!("IntersectionObserver" in window)) {
      if (!restricted) tryPlay();
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          inView = entry.isIntersecting;
          if (inView && !restricted && !userPaused && !document.hidden) tryPlay();
          else if (!inView && loaded) video.pause();
        });
      },
      { threshold: 0.25 }
    );
    obs.observe(video);
  }

  /* =====================================================================
     Enlaces genéricos de WhatsApp
     ===================================================================== */
  function wireGenericWaLinks() {
    const genericMsg =
      `Hola *MOVILIDAD 360 SV*\n\nQuiero cotizar un viaje. ¿Me ayudan, por favor?`;
    ["header-wa", "hero-wa", "footer-wa", "float-wa", "cta-wa"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.href = waLink(genericMsg);
    });
  }

  // Formulario "Trabaja con nosotros": se llena en la página (no hay
  // backend) y al enviarlo arma el mensaje de WhatsApp con lo que la
  // persona escribió, en vez de mandarla a completar una plantilla vacía
  // dentro del chat.
  function wireJoinUsForm() {
    const form = document.getElementById("join-form");
    if (!form) return;

    const driverToggle = document.getElementById("join-driver-toggle");
    const driverFields = document.getElementById("join-driver-fields");
    driverFields.hidden = true; driverFields.inert = true;
    driverToggle.addEventListener("click", () => {
      const isOn = driverToggle.classList.toggle("on");
      driverToggle.setAttribute("aria-pressed", String(isOn));
      driverFields.classList.toggle("open", isOn);
      driverFields.hidden = !isOn; driverFields.inert = !isOn;
    });

    const val = (id) => sanitizeWaText((document.getElementById(id).value || "").trim().slice(0, 600));

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const errorEl = document.getElementById("join-form-error");
      const name = val("join-name");
      const phone = M360Core.phone(val("join-phone"));
      if (!name || !phone) {
        errorEl.textContent = "Escribe tu nombre y un teléfono válido para poder contactarte.";
        errorEl.hidden = false;
        (name ? document.getElementById("join-phone") : document.getElementById("join-name")).focus();
        return;
      }

      // El campo tiene min="18" max="80" en el HTML, pero como el formulario
      // usa novalidate (para controlar nosotros el mensaje de error), esos
      // límites nunca se aplicaban solos — se podía enviar una edad como
      // "3" o "999" tal cual al mensaje de WhatsApp.
      const age = val("join-age");
      const ageNum = Number(age);
      if (age && (!Number.isInteger(ageNum) || ageNum < 18 || ageNum > 80)) {
        errorEl.textContent = "Escribe una edad válida (entre 18 y 80 años), o deja el campo vacío.";
        errorEl.hidden = false;
        document.getElementById("join-age").focus();
        return;
      }
      errorEl.hidden = true;

      const lines = [
        `Hola *MOVILIDAD 360 SV*`,
        ``,
        `Quiero postularme para trabajar con ustedes. Aquí mi información:`,
        ``,
        `*Nombre completo:* ${name}`,
        `*Teléfono/WhatsApp:* ${phone}`,
      ];
      if (age) lines.push(`*Edad:* ${age}`);
      const location = val("join-location");
      if (location) lines.push(`*Municipio y departamento:* ${location}`);
      const area = val("join-area");
      if (area) lines.push(`*Área de interés:* ${area}`);
      const schedule = val("join-schedule");
      if (schedule) lines.push(`*Horarios disponibles:* ${schedule}`);
      const experience = val("join-experience");
      if (experience) lines.push(`*Experiencia relacionada:* ${experience}`);

      if (driverToggle.classList.contains("on")) {
        lines.push(``, `*Aplico como conductor:*`);
        const license = val("join-license");
        if (license) lines.push(`Licencia: ${license}`);
        const ownVehicle = val("join-own-vehicle");
        if (ownVehicle) lines.push(`¿Vehículo propio?: ${ownVehicle}`);
        const vehicleInfo = val("join-vehicle-info");
        if (vehicleInfo) lines.push(`Marca/modelo/año: ${vehicleInfo}`);
        const vehicleType = val("join-vehicle-type");
        if (vehicleType) lines.push(`Tipo de vehículo: ${vehicleType}`);
        const driverExperience = val("join-driver-experience");
        if (driverExperience) lines.push(`Experiencia transportando pasajeros/encomiendas: ${driverExperience}`);
      }

      trackEvent("job_handoff", { action: "application" });
      window.open(waLink(lines.join("\n")), "_blank", "noopener");
    });
  }

  /* =====================================================================
     Recalcular todo cuando cambia el origen (nueva ubicación)
     ===================================================================== */
  function refreshAllQuotesForNewOrigin() {
    renderAirports();
    renderDepartments();
    renderTourism();
    ['movilizarte','aeropuerto','departamento','turismo'].forEach(prefix => invalidateQuote(prefix));
    refreshActiveQuote();
  }

  function refreshActiveQuote() {
    if (activeService === 'movilizarte' && lastMovilizarteSelection) selectMovilizarteDestination(lastMovilizarteSelection);
    if (activeService === 'aeropuerto' && lastAirportSelection) selectAirport(lastAirportSelection);
    if (activeService === 'departamento' && lastDepartmentSelection) selectDepartment(lastDepartmentSelection);
    if (activeService === 'turismo' && lastTourismSelection) selectTourism(lastTourismSelection);
    if (activeService === 'turismo' && lastTourismRouteSelection) selectTouristRoute(lastTourismRouteSelection);
  }

  /* =====================================================================
     Guardar / restaurar cotizaciones (localStorage)
     No se vuelve a llamar al servicio de ruteo al restaurar: se guarda el
     resultado ya calculado para que la última cotización aparezca al
     instante, incluso sin conexión.
     ===================================================================== */
  const STORAGE_KEY = "movilidad360_state_v1";
  let draftCleared = false;

  function captureSavedRoute(service, rows) {
    if (service === 'tarifafija') return M360Planner.route({ service, fixedName: FIXED_ROUTES.destinations[fixedRouteIdx]?.name });
    const names = labels => rows.find(row => labels.includes(row.label))?.value;
    const data = quoteRouteData[service];
    const source = service === 'encomienda' ? parcelState : service === 'mudanza' ? mudanzaState : null;
    const origin = data?.originLatLng ? { lat: data.originLatLng[0], lng: data.originLatLng[1] } : source?.fromPoint;
    const destination = data?.destLatLng ? { lat: data.destLatLng[0], lng: data.destLatLng[1] } : source?.toPoint;
    return M360Planner.route({ service, origin: { ...origin, name: names(['Desde','Recolección']) }, destination: { ...destination, name: names(['Hasta','Entrega']) },
      airportDirection, stops: data?.stops, size: source?.size });
  }

  function repeatSavedRoute(raw) {
    const saved = M360Planner.route(raw); if (!saved) return;
    const fixedIndex = saved.service === 'tarifafija' ? FIXED_ROUTES.destinations.findIndex(d => d.name === saved.fixedName) : null;
    if (fixedIndex === -1) {
      $('#savedRoutesPanel').open = true;
      $('#savedRoutesStatus').textContent = 'Esta tarifa ya no está en el catálogo. Elige un destino actualizado.';
      $('#savedRoutesPanel summary').focus();
      return;
    }
    lastMovilizarteSelection = null; lastAirportSelection = null; lastDepartmentSelection = null;
    lastTourismSelection = null; lastTourismRouteSelection = null;
    confirmationDrafts.clear();
    M360Request.clearDrafts();
    TRAVEL_PREFIXES.forEach(prefix => applyPaxPetsUi(prefix, 1, false));
    TRAVEL_PREFIXES.filter(p => p !== 'tarifafija').forEach(p => invalidateQuote(p));
    history.replaceState(null, '', '#stop-' + saved.service);
    activeService = saved.service;
    if (saved.service === 'tarifafija') {
      fixedRouteIdx = fixedIndex;
      renderFixedRoutes(); updateFixedQuote();
    } else if (saved.service === 'encomienda' || saved.service === 'mudanza') {
      const parcel = saved.service === 'encomienda';
      const state = parcel ? parcelState : mudanzaState;
      state.size = saved.size; state.fromPoint = saved.origin; state.toPoint = saved.destination;
      if (parcel) {
        state.urgent = false; state.fragile = false;
        for (const id of ['parcel-urgent', 'parcel-fragile']) { $('#' + id).classList.remove('on'); $('#' + id).setAttribute('aria-pressed', 'false'); }
        $('#parcel-urgent-warning').hidden = true;
      }
      const prefix = parcel ? 'parcel' : 'mudanza';
      $('#' + prefix + '-from').value = saved.origin.name; $('#' + prefix + '-to').value = saved.destination.name;
      $('#' + prefix + '-notes').value = '';
      $$('#' + prefix + '-size .pill-option').forEach(button => { const selected = button.dataset.size === saved.size; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); });
      $('#' + prefix + '-from-map-hint').textContent = 'Punto guardado: revisa que siga siendo correcto.';
      $('#' + prefix + '-to-map-hint').textContent = 'Punto guardado: revisa que siga siendo correcto.';
      if (parcel) updateParcelQuote(); else updateMudanzaQuote();
    } else if (saved.service === 'aeropuerto' && saved.airportDirection === 'from') {
      airportDirection = 'from'; airportArrivalDestination = saved.destination;
      $('#airport-destination').value = saved.destination.name; syncAirportDirection(); selectAirport(saved.origin);
    } else {
      selectOriginFromSearch(saved.origin);
      if (saved.service === 'movilizarte') selectMovilizarteDestination(saved.destination);
      if (saved.service === 'departamento') selectDepartment(saved.destination);
      if (saved.service === 'aeropuerto') { airportDirection = 'to'; syncAirportDirection(); selectAirport(saved.destination); }
      if (saved.service === 'turismo') {
        if (saved.stops?.length) selectTouristRoute({ name: 'Ruta guardada', stops: saved.stops.map(p => p.name), points: saved.stops });
        else selectTourism(saved.destination);
      }
    }
    activateService(saved.service, true);
    $('#draftStatus').textContent = 'Ruta recuperada. Revisa los puntos; fecha, pasajeros y equipaje se confirman de nuevo.';
    persistAll();
  }

  function persistAll() {
    if (draftCleared) return;
    try {
      const state = { travel: {}, parcel: null, mudanza: null, tourismRoute: null, fixedRoute: null };
      state.version = M360Core.DRAFT_VERSION; state.savedAt = Date.now();
      state.airportDirection = airportDirection;
      state.airportArrivalDestination = airportArrivalDestination;
      state.origin = userLocation ? { point:{...userLocation}, name:userLocationPlaceName, source:originSource } : null;
      TRAVEL_PREFIXES.forEach((prefix) => {
        const selection = {
          movilizarte: lastMovilizarteSelection,
          aeropuerto: lastAirportSelection,
          departamento: lastDepartmentSelection,
          turismo: lastTourismSelection,
        }[prefix];
        if (!selection) return;
        state.travel[prefix] = {
          place: selection,
          paxPets: paxPetsState[prefix] || { pax: 1, pets: false },
        };
      });
      if (lastTourismRouteSelection && lastQuoteResult.turismo) {
        state.tourismRoute = {
          route: lastTourismRouteSelection,
          paxPets: paxPetsState.turismo || { pax: 1, pets: false },
        };
      }
      if (parcelState.size) {
        state.parcel = {
          size: parcelState.size,
          urgent: parcelState.urgent,
          fragile: parcelState.fragile,
          fromPoint: parcelState.fromPoint,
          toPoint: parcelState.toPoint,
          fromName: $("#parcel-from") ? $("#parcel-from").value : "",
          toName: $("#parcel-to") ? $("#parcel-to").value : "",
          notes: $("#parcel-notes") ? $("#parcel-notes").value : "",
        };
      }
      if (mudanzaState.size) {
        state.mudanza = {
          size: mudanzaState.size,
          fromPoint: mudanzaState.fromPoint,
          toPoint: mudanzaState.toPoint,
          fromName: $("#mudanza-from") ? $("#mudanza-from").value : "",
          toName: $("#mudanza-to") ? $("#mudanza-to").value : "",
          notes: $("#mudanza-notes") ? $("#mudanza-notes").value : "",
        };
      }
      if (fixedRouteIdx != null) {
        state.fixedRoute = { id: M360Core.placeId(FIXED_ROUTES.destinations[fixedRouteIdx].name), paxPets: paxPetsState.tarifafija || { pax: 1, pets: false } };
      }
      const remember = $('#rememberDraft')?.checked;
      (remember ? localStorage : sessionStorage).setItem(STORAGE_KEY, JSON.stringify(state));
      (remember ? sessionStorage : localStorage).removeItem(STORAGE_KEY);
    } catch (err) {
      // localStorage puede fallar en modo privado; no es crítico para el sitio.
    }
  }

  // Todo el cuerpo va en un único try/catch (no solo el JSON.parse): el
  // estado guardado puede venir de una versión anterior del sitio con una
  // forma distinta (STORAGE_KEY no se ha versionado en cada cambio), y sin
  // esto un campo faltante (ej. "saved.place" sin "name") lanzaba una
  // excepción que cortaba silenciosamente el resto de la inicialización de
  // la página — incluyendo el requestGeolocation() que viene justo después
  // de restoreAll() en DOMContentLoaded, dejando al cliente sin que se le
  // pida su ubicación nunca más, sin ningún error visible.
  function restoreAll() {
    try {
      const remembered = localStorage.getItem(STORAGE_KEY);
      const raw = remembered || sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const state = M360Core.restoreDraft(JSON.parse(raw));
      if (!state) { localStorage.removeItem(STORAGE_KEY); sessionStorage.removeItem(STORAGE_KEY); return; }
      if ($('#rememberDraft')) $('#rememberDraft').checked = !!remembered;
      if (state.origin) {
        userLocation = {...state.origin.point};
        userLocationPlaceName = (state.origin.source === 'gps' ? 'Punto GPS guardado: ' : '') + String(state.origin.name || 'Origen elegido');
        originSource = 'search'; // A stored GPS point is not the user's current location.
        $('#origin-search-input').value = userLocationPlaceName;
        $('#geo-status').textContent = `Salida recuperada: ${originLabel()}. Puedes cambiarla.`;
        $('.geo-banner').classList.add('located');
      }
      restoreAllFromState(state);
    } catch (err) {
      /* Estado guardado corrupto o de una forma que ya no reconocemos:
         se ignora por completo y el sitio arranca limpio, como si fuera
         la primera visita. */
    }
  }

  function restoreAllFromState(state) {
    airportDirection = state.airportDirection === 'from' ? 'from' : 'to';
    airportArrivalDestination = M360Core.validPoint(state.airportArrivalDestination) && typeof state.airportArrivalDestination.name === 'string' ? state.airportArrivalDestination : null;
    if (airportArrivalDestination) $('#airport-destination').value = airportArrivalDestination.name;
    syncAirportDirection();
    if (state.travel) {
      Object.keys(state.travel).forEach((prefix) => {
        if (!['movilizarte','aeropuerto','departamento','turismo'].includes(prefix)) return;
        const saved = state.travel[prefix];
        if (!saved || !M360Core.validPoint(saved.place) || typeof saved.place.name !== 'string') return;
        if (prefix === "movilizarte") {
          lastMovilizarteSelection = saved.place;
          $("#input-movilizarte").value = saved.place.name || "";
        }
        if (prefix === "aeropuerto") lastAirportSelection = saved.place;
        if (prefix === "departamento") lastDepartmentSelection = saved.place;
        if (prefix === "turismo") lastTourismSelection = saved.place;

        if (saved.paxPets) applyPaxPetsUi(prefix, saved.paxPets.pax, saved.paxPets.pets);
        // Stored amounts and geometry are never trusted as a current quote.
      });
    }

    if (state.tourismRoute) {
      const savedTour = state.tourismRoute.route;
      lastTourismRouteSelection = TOURIST_ROUTES.find(r=>r.name===savedTour?.name) || null;
      if (!lastTourismRouteSelection && Array.isArray(savedTour?.points) && savedTour.points.length > 0 && savedTour.points.length <= 12 && savedTour.points.every(p=>M360Core.validPoint(p) && typeof p.name === 'string')) {
        lastTourismRouteSelection = { name: 'Ruta guardada', stops: savedTour.points.map(p=>p.name), points: savedTour.points };
      }
      if (state.tourismRoute.paxPets) applyPaxPetsUi("turismo", state.tourismRoute.paxPets.pax, state.tourismRoute.paxPets.pets);
    }

    if (state.mudanza && mudanzaSizeLabels[state.mudanza.size]) {
      mudanzaState.size = state.mudanza.size;
      mudanzaState.fromPoint = state.mudanza.fromPoint;
      mudanzaState.toPoint = state.mudanza.toPoint;
      $$("#mudanza-size .pill-option").forEach((btn) => {
        const isSel = btn.dataset.size === state.mudanza.size;
        btn.classList.toggle("selected", isSel);
        btn.setAttribute("aria-pressed", String(isSel));
      });
      $("#mudanza-from").value = state.mudanza.fromName || "";
      $("#mudanza-to").value = state.mudanza.toName || "";
      $("#mudanza-notes").value = state.mudanza.notes || "";
      if (state.mudanza.fromPoint) $("#mudanza-from-map-hint").textContent = "Punto marcado en el mapa ✓";
      if (state.mudanza.toPoint) $("#mudanza-to-map-hint").textContent = "Punto marcado en el mapa ✓";
      updateMudanzaQuote();
    }

    if (state.parcel && parcelSizeLabels[state.parcel.size]) {
      parcelState.size = state.parcel.size;
      parcelState.urgent = state.parcel.urgent;
      parcelState.fragile = state.parcel.fragile;
      parcelState.fromPoint = state.parcel.fromPoint;
      parcelState.toPoint = state.parcel.toPoint;

      $$("#parcel-size .pill-option").forEach((btn) => {
        const isSel = btn.dataset.size === state.parcel.size;
        btn.classList.toggle("selected", isSel);
        btn.setAttribute("aria-pressed", String(isSel));
      });
      const urgentSwitch = $("#parcel-urgent");
      urgentSwitch.classList.toggle("on", !!state.parcel.urgent);
      urgentSwitch.setAttribute("aria-pressed", String(!!state.parcel.urgent));
      $('#parcel-urgent-warning').hidden = !state.parcel.urgent;
      const fragileSwitch = $("#parcel-fragile");
      fragileSwitch.classList.toggle("on", !!state.parcel.fragile);
      fragileSwitch.setAttribute("aria-pressed", String(!!state.parcel.fragile));
      $("#parcel-from").value = state.parcel.fromName || "";
      $("#parcel-to").value = state.parcel.toName || "";
      $("#parcel-notes").value = state.parcel.notes || "";
      if (state.parcel.fromPoint) $("#parcel-from-map-hint").textContent = "Punto marcado en el mapa ✓";
      if (state.parcel.toPoint) $("#parcel-to-map-hint").textContent = "Punto marcado en el mapa ✓";
      updateParcelQuote();
    }

    const fixedIndex = state.fixedRoute ? FIXED_ROUTES.destinations.findIndex(d=>M360Core.placeId(d.name)===state.fixedRoute.id) : -1;
    if (fixedIndex >= 0) {
      fixedRouteIdx = fixedIndex;
      renderFixedRoutes();
      if (state.fixedRoute.paxPets) applyPaxPetsUi("tarifafija", state.fixedRoute.paxPets.pax, state.fixedRoute.paxPets.pets);
      updateFixedQuote();
    }
  }

  /* =====================================================================
     Efecto de "ruta" al hacer scroll (línea + pines)
     ===================================================================== */
  function wireJourneyScrollFx() {
    const stops = $$("[data-stop]");
    if ("IntersectionObserver" in window) {
      const obs = new IntersectionObserver(
        (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add("in-view")),
        { threshold: 0.32 }
      );
      stops.forEach((s) => obs.observe(s));
    } else {
      stops.forEach((s) => s.classList.add("in-view"));
    }

    const journey = $(".journey");
    const progressEl = $("#spineProgress");
    let ticking = false;

    function update() {
      const rect = journey.getBoundingClientRect();
      const vh = window.innerHeight;
      const total = rect.height;
      const scrolled = Math.min(Math.max(vh * 0.5 - rect.top, 0), total);
      const pct = total > 0 ? scrolled / total : 0;
      // scaleY en vez de height: evita recalcular layout en cada frame de
      // scroll, solo composita (más fluido en móviles de gama baja).
      progressEl.style.transform = `scaleY(${pct})`;
      ticking = false;
    }
    window.addEventListener(
      "scroll",
      () => {
        if (!ticking) {
          requestAnimationFrame(update);
          ticking = true;
        }
      },
      { passive: true }
    );
    window.addEventListener("resize", update);
    update();
  }

  /* =====================================================================
     Inicialización
     ===================================================================== */
  let activeService = 'movilizarte';
  function activateService(service, focus = false) {
    const current = ['movilizarte','aeropuerto','encomienda','departamento','turismo','mudanza','tarifafija'].includes(service) ? service : 'movilizarte';
    const changed = current !== activeService;
    activeService = current;
    $$('[data-stop]').forEach(stop => {
      const active = stop.id === 'stop-' + current;
      stop.hidden = !active; stop.inert = !active; stop.classList.add('in-view');
      const panel = $('.panel', stop), launch = $('[data-toggle]', stop);
      if (active && panel) { panel.hidden = false; panel.inert = false; panel.classList.add('open'); launch?.setAttribute('aria-expanded','true'); }
    });
    $$('[data-service]').forEach(b=>b.setAttribute('aria-pressed', String(b.dataset.service===current)));
    const needsOrigin = !['encomienda','mudanza','tarifafija'].includes(current) && !(current === 'aeropuerto' && airportDirection === 'from');
    $('.geo-banner').hidden = !needsOrigin;
    $('#airportDirectionGroup').hidden = current !== 'aeropuerto';
    $('#chosenServiceLabel').textContent = $('[data-service="' + current + '"]').dataset.name;
    if (changed) refreshActiveQuote();
    if (focus) {
      $('#serviceSelector').open = false;
      const title = $('#stop-' + current + ' h3'); title.tabIndex = -1;
      const target = needsOrigin && !userLocation ? $('#origin-search-input') :
        current === 'aeropuerto' && airportDirection === 'from' && !airportArrivalDestination ? $('#airport-destination') : title;
      target.focus({preventScroll:true}); target.scrollIntoView({block:'center', behavior:'auto'});
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    if ($('#year')) $('#year').textContent = new Date().getFullYear();
    wireHeroVideo(); wireGenericWaLinks(); wireAnalyticsEvents(); wireInstallFloat(); registerServiceWorker();
    wireCoverageMap(); renderTestimonials(); renderVehicles(); renderDrivers(); renderStats(); renderFAQ(); wireGoogleReviewsLink(); wireJoinUsForm();
    if ($('#vehicleModal')) { M360UI.register('vehicleModal', closeVehicleModal); wireVehicleModal(); }
    if (!$('#paradas')) return;
    M360UI.register('mapModal', closeMapModal); M360UI.register('confirmModal', closeConfirmModal);
    wireTogglePanels(); wireMapModal(); wireConfirmModal(); M360Request.init(repeatSavedRoute);
    TRAVEL_PREFIXES.forEach(injectPaxPetsControls);
    renderLocalSuggestions('');
    wireExplicitSearch($('#input-movilizarte'), $('#list-movilizarte'), selectMovilizarteDestination);
    $('#input-movilizarte').addEventListener('input', () => { lastMovilizarteSelection = null; invalidateQuote('movilizarte'); persistAll(); });
    renderAirports(); wireAirportDirection();
    $('#btn-locate').addEventListener('click', () => requestGeolocation(refreshAllQuotesForNewOrigin));
    wireOriginSearch(); wireParcelForm(); renderDepartments();
    wireExplicitSearch($('#input-departamento'), $('#departamento-suggestions'), selectDepartment);
    $('#input-departamento').addEventListener('input', () => { lastDepartmentSelection=null; invalidateQuote('departamento'); persistAll(); });
    renderTouristRoutes(); renderTouristChips(); renderTourism();
    wireExplicitSearch($('#input-turismo'), $('#turismo-suggestions'), selectTourism);
    $('#input-turismo').addEventListener('input', () => {
      lastTourismSelection=null; lastTourismRouteSelection=null; invalidateQuote('turismo');
      touristSearch = $('#input-turismo').value; renderTourism(); persistAll();
    });
    wireMudanzaForm(); wireFixedRoutesForm(); restoreAll(); refreshAllQuotesForNewOrigin();
    $$('[data-service]').forEach(b=>b.addEventListener('click',()=>{
      history.replaceState(null,'','#stop-'+b.dataset.service); activateService(b.dataset.service,true);
    }));
    window.addEventListener('hashchange',()=>activateService(location.hash.replace('#stop-','')));
    activateService(location.hash.replace('#stop-',''));
    if (location.hash.startsWith('#stop-')) $('#serviceSelector').open = false;
    $('#rememberDraft').addEventListener('change',()=>{
      persistAll(); $('#draftStatus').textContent = $('#rememberDraft').checked ? 'Ruta guardada por 24 horas. Evita esta opción en dispositivos compartidos.' : 'Solo se conservará en esta pestaña.';
    });
    $('#clearDraft').addEventListener('click',()=>{
      draftCleared = true;
      try { localStorage.removeItem(STORAGE_KEY); sessionStorage.removeItem(STORAGE_KEY); localStorage.removeItem('movilidad360_trip_requests_count'); } catch {}
      location.reload();
    });
    window.addEventListener('pagehide',persistAll);
  });
})();
