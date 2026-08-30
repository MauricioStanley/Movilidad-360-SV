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

  function pickSpeed(distanceKm) {
    return distanceKm <= 18 ? CONFIG.avgSpeedKmh.city : CONFIG.avgSpeedKmh.highway;
  }

  function estimateMinutes(distanceKm) {
    const speed = pickSpeed(distanceKm);
    // +6 min de "colchón" por abordaje / tráfico local
    return Math.max(5, Math.round((distanceKm / speed) * 60) + 6);
  }

  function estimatePrice(distanceKm) {
    return distanceKm * CONFIG.ratePerKm;
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
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("No se pudo cargar el mapa."));
      document.body.appendChild(script);
    });
    return leafletLoadingPromise;
  }

  /* ---------------- Ruteo real por carretera (OSRM) ----------------
     OSRM (router.project-osrm.org) es un servicio público y gratuito de
     ruteo basado en OpenStreetMap, sin necesidad de API key. Si no
     responde a tiempo (o el navegador está sin internet), se usa un
     respaldo en línea recta con un factor de corrección, y se marca la
     cotización como "aproximada" para que quede claro que no es la
     distancia real de manejo. */
  const routeCache = new Map();

  async function fetchRoute(origin, dest) {
    const key = `${origin.lat.toFixed(5)},${origin.lng.toFixed(5)}|${dest.lat.toFixed(5)},${dest.lng.toFixed(5)}`;
    if (routeCache.has(key)) return routeCache.get(key);

    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${origin.lng},${origin.lat};${dest.lng},${dest.lat}` +
      `?overview=full&geometries=geojson`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);

    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error("routing-http-error");
      const data = await res.json();
      const route = data.routes && data.routes[0];
      if (!route) throw new Error("no-route");
      const result = {
        distanceKm: route.distance / 1000,
        minutes: Math.max(5, Math.round(route.duration / 60) + 6),
        coords: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
        real: true,
      };
      routeCache.set(key, result);
      return result;
    } catch (err) {
      clearTimeout(timeoutId);
      // Respaldo: línea recta corregida (+35%, aproxima curvas de carretera)
      const distanceKm = haversineKm(origin.lat, origin.lng, dest.lat, dest.lng) * 1.35;
      return {
        distanceKm,
        minutes: estimateMinutes(distanceKm),
        coords: null,
        real: false,
      };
    }
  }

  /* ---------------- Ubicación del usuario ---------------- */
  let userLocation = null;
  let userLocationPlaceName = null; // texto legible (reverse geocoding), si se pudo obtener

  function currentOrigin() {
    return userLocation || CONFIG.originFallback;
  }
  function originLabel() {
    if (userLocation) return userLocationPlaceName ? `Tu ubicación (${userLocationPlaceName})` : "Tu ubicación actual";
    return CONFIG.originFallback.name;
  }
  function googleMapsLink(lat, lng) {
    return `https://www.google.com/maps?q=${lat},${lng}`;
  }
  // Enlace de Google Maps al punto de origen, solo cuando el origen es la
  // ubicación real del usuario (el punto de referencia fijo ya tiene nombre).
  function originMapsLink() {
    return userLocation ? googleMapsLink(userLocation.lat, userLocation.lng) : null;
  }
  // Enlace de Google Maps para un punto marcado a mano (encomienda/mudanza),
  // que puede venir de la ubicación real del cliente si usó el mapa para
  // marcarlo. Si solo escribió una dirección de texto, no hay coordenadas
  // y no se puede armar el enlace.
  function pointMapsLink(point) {
    return point ? googleMapsLink(point.lat, point.lng) : null;
  }

  // Convierte coordenadas en una referencia legible (colonia/calle) usando
  // Nominatim (OpenStreetMap), gratuito y sin API key. Es un "mejor esfuerzo":
  // si falla o tarda, simplemente no se agrega el nombre y se sigue usando
  // el enlace de Google Maps como punto de referencia.
  async function reverseGeocode(lat, lng) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`;
      const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
      clearTimeout(timeoutId);
      if (!res.ok) return null;
      const data = await res.json();
      const a = data.address || {};
      const place = a.neighbourhood || a.suburb || a.road || a.village || a.town || a.city_district;
      const city = a.city || a.town || a.municipality;
      const parts = [place, place !== city ? city : null].filter(Boolean);
      return parts.length ? parts.join(", ") : null;
    } catch (err) {
      clearTimeout(timeoutId);
      return null;
    }
  }

  // Búsqueda de direcciones reales (Nominatim/OpenStreetMap) — respaldo
  // cuando el lugar que el cliente escribe no está en nuestra lista
  // curada de sitios populares. Así puede pedir un viaje a cualquier
  // dirección real de El Salvador aunque no sepa marcarla en el mapa.
  async function geocodeSearch(query) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=sv&limit=5&q=${encodeURIComponent(query)}`;
      const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
      clearTimeout(timeoutId);
      if (!res.ok) return [];
      const data = await res.json();
      return data.map((d) => {
        const parts = d.display_name.split(",").map((s) => s.trim());
        return { name: parts.slice(0, 2).join(", "), fullName: d.display_name, lat: parseFloat(d.lat), lng: parseFloat(d.lon) };
      });
    } catch (err) {
      clearTimeout(timeoutId);
      return [];
    }
  }

  function requestGeolocation(cb) {
    const statusEl = $("#geo-status");
    const bannerEl = $(".geo-banner");
    if (!navigator.geolocation) {
      if (statusEl) statusEl.textContent = "Tu navegador no permite compartir ubicación. Usando San Salvador (Centro) como referencia.";
      cb(false);
      return;
    }
    if (statusEl) statusEl.textContent = "Buscando tu ubicación…";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        userLocationPlaceName = null;
        if (statusEl) statusEl.textContent = "Ubicación activada ✓ Todas las cotizaciones se calculan desde tu posición actual.";
        if (bannerEl) bannerEl.classList.add("located");
        cb(true);
        reverseGeocode(userLocation.lat, userLocation.lng).then((name) => {
          if (name) userLocationPlaceName = name;
        });
      },
      () => {
        if (statusEl) statusEl.textContent = "No pudimos acceder a tu ubicación. Usando San Salvador (Centro) como referencia — puedes intentar de nuevo.";
        if (bannerEl) bannerEl.classList.remove("located");
        cb(false);
      },
      { timeout: 8000, maximumAge: 60000 }
    );
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
    `;
    panel.insertBefore(row, quoteBox);

    const valueEl = $(`#pax-${prefix}`, row);
    $$(".stepper-btn", row).forEach((btn) => {
      btn.addEventListener("click", () => {
        const dir = Number(btn.dataset.dir);
        const next = Math.min(8, Math.max(1, paxPetsState[prefix].pax + dir));
        paxPetsState[prefix].pax = next;
        valueEl.textContent = String(next);
        persistAll();
      });
    });

    const petsBtn = $(`#pets-${prefix}`, row);
    petsBtn.addEventListener("click", () => {
      petsBtn.classList.toggle("on");
      paxPetsState[prefix].pets = petsBtn.classList.contains("on");
      petsBtn.setAttribute("aria-pressed", String(paxPetsState[prefix].pets));
      persistAll();
    });
  }

  function paxPetsFor(prefix) {
    const s = paxPetsState[prefix] || { pax: 1, pets: false };
    return { passengers: s.pax, pets: s.pets };
  }

  function applyPaxPetsUi(prefix, pax, pets) {
    paxPetsState[prefix] = { pax, pets };
    const valueEl = $(`#pax-${prefix}`);
    if (valueEl) valueEl.textContent = String(pax);
    const petsBtn = $(`#pets-${prefix}`);
    if (petsBtn) {
      petsBtn.classList.toggle("on", pets);
      petsBtn.setAttribute("aria-pressed", String(pets));
    }
  }

  /* ---------------- Cotización genérica ---------------- */
  const quoteRouteData = {}; // por prefijo: { originLatLng, destLatLng, coords, real }
  const lastQuoteResult = {}; // por prefijo: datos de la última cotización mostrada (sin pax/mascota)

  const SERVICE_NAMES = {
    movilizarte: "viaje local",
    aeropuerto: "traslado al aeropuerto",
    departamento: "viaje interdepartamental",
    turismo: "viaje turístico",
  };

  // Línea de política de cancelación, calculada según el precio real de
  // esta cotización — se advierte SIEMPRE al solicitar el viaje.
  function cancellationLine(price) {
    if (price == null) {
      return "La política de cancelación se confirma junto con tu cotización personalizada.";
    }
    if (price > CONFIG.cancellation.freeThresholdUsd) {
      const fee = (price * CONFIG.cancellation.feePercent) / 100;
      return `Cancelación: se cobra ${CONFIG.cancellation.feePercent}% (${formatMoney(fee)}) por ser mayor a ${formatMoney(CONFIG.cancellation.freeThresholdUsd)}.`;
    }
    return `Cancelación: sin cargo (viaje de ${formatMoney(price)}, no supera ${formatMoney(CONFIG.cancellation.freeThresholdUsd)}).`;
  }

  function buildQuoteMessage(prefix, { originName, destName, price, minutes, distanceKm, extraLine, real }, paymentMethod) {
    const { passengers, pets } = paxPetsFor(prefix);
    const mapsLink = originMapsLink();
    return (
      `Hola *MOVILIDAD 360 SV* 👋\n\n` +
      `Quiero cotizar un *${SERVICE_NAMES[prefix]}*:\n` +
      `📍 Desde: ${originName}` +
      (mapsLink ? ` — ${mapsLink}` : "") +
      `\n` +
      `🎯 Hasta: ${destName}\n` +
      `📏 Distancia ${real ? "real por carretera" : "aproximada"}: ${distanceKm.toFixed(1)} km\n` +
      `💵 Precio estimado: ${formatMoney(price)}\n` +
      `⏱️ Tiempo estimado: ${formatEta(minutes)}\n` +
      `👥 Pasajeros: ${passengers}\n` +
      `🐾 Mascota: ${pets ? "Sí" : "No"}\n` +
      `💳 Método de pago: ${paymentMethod}` +
      (extraLine ? `\n${extraLine}` : "") +
      `\n⚠️ ${cancellationLine(price)}` +
      `\n\n¿Podrían confirmar disponibilidad?`
    );
  }

  function showQuoteLoading(prefix, originName, destName) {
    $(`#quote-${prefix}-route`).textContent = `${originName} → ${destName}`;
    $(`#quote-${prefix}-price`).textContent = "…";
    $(`#quote-${prefix}-eta`).textContent = "🧭 Calculando ruta real por carretera…";
    const badge = $(`#quote-${prefix}-badge`);
    if (badge) badge.textContent = "";
    $(`#quote-${prefix}`).classList.add("show");
    const waBtn = $(`#wa-${prefix}`);
    if (waBtn) {
      waBtn.setAttribute("aria-disabled", "true");
      waBtn.classList.add("is-loading");
    }
    const routeLinkEl = $(`#route-link-${prefix}`);
    if (routeLinkEl) routeLinkEl.hidden = true;
  }

  function showQuote(prefix, data) {
    const { originName, destName, price, minutes, distanceKm, real } = data;
    $(`#quote-${prefix}-route`).textContent = `${originName} → ${destName} · ${distanceKm.toFixed(1)} km`;
    $(`#quote-${prefix}-price`).textContent = formatMoney(price);
    $(`#quote-${prefix}-eta`).textContent = `Tiempo estimado: ${formatEta(minutes)}`;
    $(`#quote-${prefix}`).classList.add("show");

    const badge = $(`#quote-${prefix}-badge`);
    if (badge) {
      badge.textContent = real ? "🧭 Ruta real por carretera" : "≈ Ruta aproximada (línea recta)";
      badge.classList.toggle("is-approx", !real);
    }

    const waBtn = $(`#wa-${prefix}`);
    if (waBtn) {
      waBtn.removeAttribute("aria-disabled");
      waBtn.classList.remove("is-loading");
    }

    const routeLinkEl = $(`#route-link-${prefix}`);
    if (routeLinkEl) routeLinkEl.hidden = false;

    lastQuoteResult[prefix] = data;
    if (waBtn) {
      waBtn.onclick = () => {
        const { passengers, pets } = paxPetsFor(prefix);
        openConfirmModal({
          price: data.price,
          rows: [
            { label: "Servicio", value: SERVICE_NAMES[prefix] },
            { label: "Desde", value: data.originName },
            { label: "Hasta", value: data.destName },
            { label: "Distancia", value: `${data.distanceKm.toFixed(1)} km (${data.real ? "ruta real" : "aproximada"})` },
            { label: "Tiempo estimado", value: formatEta(data.minutes) },
            { label: "Precio estimado", value: formatMoney(data.price) },
            { label: "Pasajeros", value: String(passengers) },
            { label: "Mascota", value: pets ? "Sí" : "No" },
          ],
          buildMessage: (paymentMethod) => buildQuoteMessage(prefix, data, paymentMethod),
        });
      };
    }
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
    const token = localGeoToken;
    empty.classList.remove("show");
    list.innerHTML = `<p class="suggestion-loading">Buscando "${filterText}"…</p>`;
    debouncedGeocode(filterText, (results) => {
      if (token !== localGeoToken) return; // el cliente ya escribió otra cosa
      if (!results.length) {
        list.innerHTML = "";
        empty.classList.add("show");
        return;
      }
      renderSuggestionItems(list, results, null, selectMovilizarteDestination);
    });
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
          <span class="suggestion-name">${p.name}</span><br>
          <span class="suggestion-meta">${fixedMeta || `📍 ${p.fullName}`}</span>
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
  // geocodificación mientras el cliente sigue escribiendo.
  const debouncedGeocode = debounce((query, cb) => {
    geocodeSearch(query + ", El Salvador").then(cb);
  }, 500);

  let lastMovilizarteSelection = null;

  async function selectMovilizarteDestination(place) {
    lastMovilizarteSelection = place;
    $("#input-movilizarte").value = place.name;
    const origin = currentOrigin();
    const originName = originLabel();
    showQuoteLoading("movilizarte", originName, place.name);
    const route = await fetchRoute(origin, place);
    quoteRouteData.movilizarte = {
      originLatLng: [origin.lat, origin.lng],
      destLatLng: [place.lat, place.lng],
      coords: route.coords,
      real: route.real,
    };
    const price = estimatePrice(route.distanceKm);
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
      distanceKm: haversineKm(origin.lat, origin.lng, a.lat, a.lng),
    })).sort((a, b) => a.distanceKm - b.distanceKm);

    $("#list-aeropuerto").innerHTML = withDist
      .map((a, i) => {
        return `
        <button type="button" class="option-card" data-idx="${i}">
          <div class="option-card-top">
            <span class="option-title">${a.name}</span>
            ${i === 0 ? '<span class="option-badge">Más cercano</span>' : ""}
          </div>
          <span class="option-desc">${a.short} · ${a.type}</span>
          <div class="option-foot">
            <span class="price">desde ${formatMoney(estimatePrice(a.distanceKm))}</span>
            <span class="eta">${formatEta(estimateMinutes(a.distanceKm))}</span>
          </div>
        </button>`;
      })
      .join("");

    $$(".option-card", $("#list-aeropuerto")).forEach((card, i) => {
      card.addEventListener("click", () => {
        $$(".option-card", $("#list-aeropuerto")).forEach((c) => c.classList.remove("selected"));
        card.classList.add("selected");
        selectAirport(withDist[i]);
      });
    });
  }

  let lastAirportSelection = null;

  async function selectAirport(airport) {
    lastAirportSelection = airport;
    const origin = currentOrigin();
    const originName = originLabel();
    showQuoteLoading("aeropuerto", originName, airport.name);
    const route = await fetchRoute(origin, airport);
    quoteRouteData.aeropuerto = {
      originLatLng: [origin.lat, origin.lng],
      destLatLng: [airport.lat, airport.lng],
      coords: route.coords,
      real: route.real,
    };
    const price = estimatePrice(route.distanceKm);
    showQuote("aeropuerto", {
      originName,
      destName: airport.name,
      price,
      minutes: route.minutes,
      distanceKm: route.distanceKm,
      real: route.real,
      extraLine: "✈️ Por favor confirmar hora de vuelo para calcular hora de recogida.",
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

  async function updateParcelQuote() {
    if (!parcelState.size) return;
    let price = CONFIG.pricing.parcel[parcelState.size];
    if (parcelState.urgent) price += CONFIG.pricing.parcel.urgentSurcharge;

    let distanceKm = null;
    let real = false;
    if (parcelState.fromPoint && parcelState.toPoint) {
      $("#quote-encomienda-eta").textContent = "🧭 Calculando ruta real por carretera…";
      $("#quote-encomienda").classList.add("show");
      const route = await fetchRoute(parcelState.fromPoint, parcelState.toPoint);
      distanceKm = route.distanceKm;
      real = route.real;
      price += estimatePrice(distanceKm);
      quoteRouteData.encomienda = {
        originLatLng: [parcelState.fromPoint.lat, parcelState.fromPoint.lng],
        destLatLng: [parcelState.toPoint.lat, parcelState.toPoint.lng],
        coords: route.coords,
        real: route.real,
      };
    }

    $("#quote-encomienda-route").textContent =
      `Encomienda ${parcelSizeLabels[parcelState.size]}${parcelState.fragile ? " · frágil" : ""}` +
      (distanceKm !== null ? ` · ${distanceKm.toFixed(1)} km` : "");
    $("#quote-encomienda-price").textContent = formatMoney(price);
    $("#quote-encomienda-eta").textContent = parcelState.urgent
      ? "Entrega estimada: mismo día"
      : "Entrega estimada: 24–48 horas";
    $("#quote-encomienda").classList.add("show");

    const badge = $("#quote-encomienda-badge");
    if (badge) {
      badge.textContent = distanceKm !== null ? (real ? "🧭 Ruta real por carretera" : "≈ Ruta aproximada (línea recta)") : "";
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
      waBtn.onclick = () => {
        openConfirmModal({
          price,
          rows: [
            { label: "Servicio", value: "Encomienda" },
            { label: "Tamaño", value: parcelSizeLabels[parcelState.size] },
            { label: "Urgencia", value: parcelState.urgent ? "Mismo día (express)" : "Estándar" },
            { label: "Frágil", value: parcelState.fragile ? "Sí" : "No" },
            { label: "Recolección", value: from },
            { label: "Entrega", value: to },
            ...(distanceKm !== null ? [{ label: "Distancia", value: `${distanceKm.toFixed(1)} km (${real ? "ruta real" : "aproximada"})` }] : []),
            { label: "Precio estimado", value: formatMoney(price) },
          ],
          buildMessage: (paymentMethod) =>
            `Hola *MOVILIDAD 360 SV* 👋\n\n` +
            `Quiero cotizar el envío de una *encomienda*:\n` +
            `📦 Tamaño: ${parcelSizeLabels[parcelState.size]}\n` +
            `🚀 Urgencia: ${parcelState.urgent ? "Mismo día (express)" : "Estándar"}\n` +
            `⚠️ Frágil: ${parcelState.fragile ? "Sí" : "No"}\n` +
            `📍 Recolección: ${from}` +
            (pointMapsLink(parcelState.fromPoint) ? ` — ${pointMapsLink(parcelState.fromPoint)}` : "") +
            `\n` +
            `🎯 Entrega: ${to}` +
            (pointMapsLink(parcelState.toPoint) ? ` — ${pointMapsLink(parcelState.toPoint)}` : "") +
            (distanceKm !== null ? `\n📏 Distancia ${real ? "real por carretera" : "aproximada"}: ${distanceKm.toFixed(1)} km` : "") +
            (notes ? `\n📝 Instrucciones: ${notes}` : "") +
            `\n💵 Precio estimado: ${formatMoney(price)}\n` +
            `💳 Método de pago: ${paymentMethod}` +
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
    $(hintId).textContent = "Punto marcado en el mapa ✓";
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
    urgentSwitch.addEventListener("click", () => {
      urgentSwitch.classList.toggle("on");
      parcelState.urgent = urgentSwitch.classList.contains("on");
      urgentSwitch.setAttribute("aria-pressed", String(parcelState.urgent));
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
      parcelState.fromPoint = null;
      $("#parcel-from-map-hint").textContent = "";
      debouncedParcelQuote();
    });
    $("#parcel-to").addEventListener("input", () => {
      parcelState.toPoint = null;
      $("#parcel-to-map-hint").textContent = "";
      debouncedParcelQuote();
    });
    $("#parcel-notes").addEventListener("input", debouncedParcelQuote);
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
    if (!mudanzaState.size) return;
    $("#quote-mudanza-route").textContent = `Mudanza (${mudanzaSizeLabels[mudanzaState.size]}) — cotización personalizada`;
    $("#quote-mudanza-eta").textContent = "Te confirmamos el precio por WhatsApp.";
    $("#quote-mudanza").classList.add("show");

    const from = $("#mudanza-from").value.trim() || "(pendiente de confirmar)";
    const to = $("#mudanza-to").value.trim() || "(pendiente de confirmar)";
    const notes = $("#mudanza-notes").value.trim();

    const waBtn = $("#wa-mudanza");
    if (waBtn) {
      waBtn.onclick = () => {
        openConfirmModal({
          price: null,
          rows: [
            { label: "Servicio", value: "Mudanza" },
            { label: "Tamaño", value: mudanzaSizeLabels[mudanzaState.size] },
            { label: "Recolección", value: from },
            { label: "Entrega", value: to },
          ],
          buildMessage: (paymentMethod) =>
            `Hola *MOVILIDAD 360 SV* 👋\n\n` +
            `Quiero cotizar una *mudanza*:\n` +
            `🏠 Tamaño: ${mudanzaSizeLabels[mudanzaState.size]}\n` +
            `📍 Recolección: ${from}` +
            (pointMapsLink(mudanzaState.fromPoint) ? ` — ${pointMapsLink(mudanzaState.fromPoint)}` : "") +
            `\n` +
            `🎯 Entrega: ${to}` +
            (pointMapsLink(mudanzaState.toPoint) ? ` — ${pointMapsLink(mudanzaState.toPoint)}` : "") +
            (notes ? `\n📝 Detalles: ${notes}` : "") +
            `\n💳 Método de pago preferido: ${paymentMethod}` +
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
    $(hintId).textContent = "Punto marcado en el mapa ✓";
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
      mudanzaState.fromPoint = null;
      $("#mudanza-from-map-hint").textContent = "";
      debouncedMudanzaQuote();
    });
    $("#mudanza-to").addEventListener("input", () => {
      mudanzaState.toPoint = null;
      $("#mudanza-to-map-hint").textContent = "";
      debouncedMudanzaQuote();
    });
    $("#mudanza-notes").addEventListener("input", debouncedMudanzaQuote);
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
    $("#quote-tarifafija-route").textContent = `${FIXED_ROUTES.origin} → ${dest.name}`;
    $("#quote-tarifafija-price").textContent = formatMoney(dest.price);
    $("#quote-tarifafija-eta").textContent = dest.negotiable
      ? "Precio negociable, se confirma por WhatsApp."
      : "Precio fijo, sin cálculo de distancia.";
    $("#quote-tarifafija").classList.add("show");

    const waBtn = $("#wa-tarifafija");
    if (waBtn) {
      waBtn.onclick = () => {
        const { passengers, pets } = paxPetsFor("tarifafija");
        openConfirmModal({
          price: dest.price,
          rows: [
            { label: "Servicio", value: "Tarifa fija" },
            { label: "Desde", value: FIXED_ROUTES.origin },
            { label: "Hasta", value: dest.name },
            { label: "Precio", value: formatMoney(dest.price) + (dest.negotiable ? " (negociable)" : "") },
          ],
          buildMessage: (paymentMethod) =>
            `Hola *MOVILIDAD 360 SV* 👋\n\n` +
            `Quiero reservar un viaje con *tarifa fija*:\n` +
            `📍 Desde: ${FIXED_ROUTES.origin}\n` +
            `🎯 Hasta: ${dest.name}\n` +
            `💵 Precio: ${formatMoney(dest.price)}${dest.negotiable ? " (negociable, a confirmar)" : ""}\n` +
            `👥 Pasajeros: ${passengers}\n` +
            `🐾 Mascota: ${pets ? "Sí" : "No"}\n` +
            `💳 Método de pago: ${paymentMethod}` +
            `\n⚠️ ${cancellationLine(dest.price)}` +
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
    const origin = currentOrigin();
    $("#list-departamento").innerHTML = DEPARTMENTS.map((d, i) => {
      const distanceKm = haversineKm(origin.lat, origin.lng, d.lat, d.lng);
      return `
        <button type="button" class="option-card" data-idx="${i}">
          <div class="option-card-top">
            <span class="option-title">${d.name}</span>
            ${d.popular ? '<span class="option-badge">Popular</span>' : ""}
          </div>
          <span class="option-desc">${d.tag}</span>
          <div class="option-foot">
            <span class="price">desde ${formatMoney(estimatePrice(distanceKm))}</span>
            <span class="eta">${formatEta(estimateMinutes(distanceKm))}</span>
          </div>
        </button>`;
    }).join("");

    $$(".option-card", $("#list-departamento")).forEach((card, i) => {
      card.addEventListener("click", () => {
        $$(".option-card", $("#list-departamento")).forEach((c) => c.classList.remove("selected"));
        card.classList.add("selected");
        selectDepartment(DEPARTMENTS[i]);
      });
    });
  }

  let lastDepartmentSelection = null;

  async function selectDepartment(dept) {
    lastDepartmentSelection = dept;
    const origin = currentOrigin();
    const originName = originLabel();
    const destName = `Departamento de ${dept.name}`;
    showQuoteLoading("departamento", originName, destName);
    const route = await fetchRoute(origin, dept);
    quoteRouteData.departamento = {
      originLatLng: [origin.lat, origin.lng],
      destLatLng: [dept.lat, dept.lng],
      coords: route.coords,
      real: route.real,
    };
    const price = estimatePrice(route.distanceKm);
    showQuote("departamento", {
      originName,
      destName,
      price,
      minutes: route.minutes,
      distanceKm: route.distanceKm,
      real: route.real,
    });
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
        const distanceKm = haversineKm(origin.lat, origin.lng, p.lat, p.lng);
        return `
        <button type="button" class="option-card" data-idx="${i}">
          <div class="option-card-top">
            <span class="option-title">${p.name}</span>
            <span class="option-badge teal">${p.category}</span>
          </div>
          <span class="option-desc">${p.desc}</span>
          <div class="option-foot">
            <span class="price">desde ${formatMoney(estimatePrice(distanceKm))}</span>
            <span class="eta">${formatEta(estimateMinutes(distanceKm))}</span>
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
    const query = touristSearch.trim();
    if (query.length < 3) {
      grid.innerHTML = "";
      empty.classList.add("show");
      return;
    }
    const token = touristGeoToken;
    empty.classList.remove("show");
    grid.innerHTML = `<p class="suggestion-loading">Buscando "${query}"…</p>`;
    debouncedGeocode(query, (results) => {
      if (token !== touristGeoToken) return;
      if (!results.length) {
        grid.innerHTML = "";
        empty.classList.add("show");
        return;
      }
      const origin = currentOrigin();
      grid.innerHTML = results
        .map((p, i) => {
          const distanceKm = haversineKm(origin.lat, origin.lng, p.lat, p.lng);
          return `
          <button type="button" class="option-card" data-idx="${i}">
            <div class="option-card-top">
              <span class="option-title">${p.name}</span>
            </div>
            <span class="option-desc">📍 ${p.fullName}</span>
            <div class="option-foot">
              <span class="price">desde ${formatMoney(estimatePrice(distanceKm))}</span>
              <span class="eta">${formatEta(estimateMinutes(distanceKm))}</span>
            </div>
          </button>`;
        })
        .join("");
      $$(".option-card", grid).forEach((card, i) => {
        card.addEventListener("click", () => {
          $$(".option-card", grid).forEach((c) => c.classList.remove("selected"));
          card.classList.add("selected");
          selectTourism(results[i]);
        });
      });
    });
  }

  let lastTourismSelection = null;
  let lastTourismRouteSelection = null;

  async function selectTourism(place) {
    lastTourismSelection = place;
    lastTourismRouteSelection = null;
    const origin = currentOrigin();
    const originName = originLabel();
    showQuoteLoading("turismo", originName, place.name);
    const route = await fetchRoute(origin, place);
    quoteRouteData.turismo = {
      originLatLng: [origin.lat, origin.lng],
      destLatLng: [place.lat, place.lng],
      coords: route.coords,
      real: route.real,
    };
    const price = estimatePrice(route.distanceKm);
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
    lastTourismRouteSelection = route;
    lastTourismSelection = null;
    const stopPlaces = route.stops.map((name) => TOURIST_PLACES.find((p) => p.name === name)).filter(Boolean);
    if (stopPlaces.length === 0) return;

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
      const leg = await fetchRoute(legOrigin, stop);
      totalKm += leg.distanceKm;
      totalMinutes += leg.minutes;
      if (!leg.real) allReal = false;
      if (leg.coords) coordsAll = coordsAll.concat(leg.coords);
      legOrigin = stop;
    }

    const lastStop = stopPlaces[stopPlaces.length - 1];
    quoteRouteData.turismo = {
      originLatLng: [origin.lat, origin.lng],
      destLatLng: [lastStop.lat, lastStop.lng],
      coords: coordsAll.length ? coordsAll : null,
      real: allReal,
    };
    const price = estimatePrice(totalKm);
    showQuote("turismo", {
      originName,
      destName: destLabel,
      price,
      minutes: totalMinutes,
      distanceKm: totalKm,
      real: allReal,
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
      else marker = L.marker(e.latlng, { draggable: true }).addTo(map);
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

  async function openMapModal(context) {
    mapContext = context;
    $("#mapModal").classList.add("open");
    $("#mapModalTitle").textContent = "Elige tu destino en el mapa";
    $("#mapModalConfirm").style.display = "";
    $("#mapModalConfirm").disabled = true;
    $("#mapModalHint").textContent = "Cargando mapa…";
    try {
      await loadLeaflet();
    } catch (err) {
      $("#mapModalHint").textContent = "No se pudo cargar el mapa. Verifica tu conexión a internet.";
      return;
    }
    ensureMap();
    clearRouteLayer();
    pendingLatLng = null;
    if (marker) {
      marker.remove();
      marker = null;
    }
    $("#mapModalHint").textContent = "Toca el mapa para colocar un pin en tu destino.";
    map.setView([13.7, -89.2], 8);
    setTimeout(() => map.invalidateSize(), 60);
  }

  async function openRouteView(prefix) {
    const data = quoteRouteData[prefix];
    if (!data) return;
    mapContext = "view-route";
    $("#mapModal").classList.add("open");
    $("#mapModalTitle").textContent = "Ruta estimada del viaje";
    $("#mapModalConfirm").style.display = "none";
    $("#mapModalHint").textContent = "Cargando mapa…";
    try {
      await loadLeaflet();
    } catch (err) {
      $("#mapModalHint").textContent = "No se pudo cargar el mapa. Verifica tu conexión a internet.";
      return;
    }
    ensureMap();
    clearRouteLayer();
    if (marker) {
      marker.remove();
      marker = null;
    }
    const latlngs = data.coords && data.coords.length ? data.coords : [data.originLatLng, data.destLatLng];
    routeLine = L.polyline(latlngs, {
      color: data.real ? "#7cb342" : "#8fa0ad",
      weight: 4,
      dashArray: data.real ? null : "8 8",
    }).addTo(map);
    routeMarkers = [
      L.marker(data.originLatLng).addTo(map).bindPopup("Origen"),
      L.marker(data.destLatLng).addTo(map).bindPopup("Destino"),
    ];
    map.fitBounds(routeLine.getBounds(), { padding: [30, 30] });
    $("#mapModalHint").textContent = data.real
      ? "Ruta real calculada por carretera (la misma referencia que usamos para cobrar)."
      : "Ruta aproximada en línea recta — no se pudo calcular la ruta exacta por carretera en este momento.";
    setTimeout(() => map.invalidateSize(), 60);
  }

  function closeMapModal() {
    $("#mapModal").classList.remove("open");
  }

  function wireMapModal() {
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
      if (!pendingLatLng) return;
      const place = {
        name: `Punto en el mapa (${pendingLatLng.lat.toFixed(3)}, ${pendingLatLng.lng.toFixed(3)})`,
        lat: pendingLatLng.lat,
        lng: pendingLatLng.lng,
      };
      if (mapContext === "movilizarte") selectMovilizarteDestination(place);
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

  function renderConfirmRows(rows) {
    $("#confirmRows").innerHTML = rows
      .map((r) => `<div class="confirm-row"><span>${r.label}</span><strong>${r.value}</strong></div>`)
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
      });
    });
  }

  function renderCancellationNotice(price) {
    const el = $("#confirmCancellation");
    const isFee = price != null && price > CONFIG.cancellation.freeThresholdUsd;
    el.textContent = (isFee ? "⚠️ " : price == null ? "ℹ️ " : "✅ ") + cancellationLine(price);
    el.classList.toggle("is-fee", isFee);
  }

  function openConfirmModal({ rows, price, buildMessage }) {
    confirmModalCtx = { buildMessage };
    renderConfirmRows(rows);
    renderConfirmPaymentPills();
    renderCancellationNotice(price);
    $("#confirmModal").classList.add("open");
  }

  function closeConfirmModal() {
    $("#confirmModal").classList.remove("open");
    confirmModalCtx = null;
  }

  function wireConfirmModal() {
    $("#confirmModalClose").addEventListener("click", closeConfirmModal);
    $("#confirmEditBtn").addEventListener("click", closeConfirmModal);
    $("#confirmModal").addEventListener("click", (e) => {
      if (e.target.id === "confirmModal") closeConfirmModal();
    });
    $("#confirmSendBtn").addEventListener("click", () => {
      if (!confirmModalCtx) return;
      const msg = confirmModalCtx.buildMessage(confirmPaymentMethod);
      trackEvent("whatsapp_click", { link_id: "confirm-send" });
      window.open(waLink(msg), "_blank", "noopener");
      closeConfirmModal();
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
        const cmap = L.map("coverage-map", { scrollWheelZoom: false }).setView([13.85, -89.1], 8);
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
      })
      .catch(() => {
        const el = $("#coverage-map");
        if (el) el.textContent = "No se pudo cargar el mapa de cobertura. Verifica tu conexión a internet.";
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
  function renderTestimonials() {
    const grid = $("#testimonials-grid");
    if (!grid) return;
    grid.innerHTML = TESTIMONIALS.map(
      (t) => `
      <figure class="testimonial-card">
        <blockquote>"${t.quote}"</blockquote>
        <figcaption><strong>${t.name}</strong><span>${t.service}</span></figcaption>
      </figure>`
    ).join("");
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
              ? `<img class="vehicle-photo" src="${photos[0]}" alt="${v.type}" loading="lazy" data-photos='${JSON.stringify(photos)}' data-photo-idx="0">`
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
    wireVehiclePhotoRotation();
  }

  // Para tipos de vehículo con varias fotos reales (ej. Sedán), las va
  // rotando automáticamente para mostrar que puede llegar cualquiera de
  // esos autos — el cliente no elige el vehículo específico.
  function wireVehiclePhotoRotation() {
    $$(".vehicle-photo[data-photos]").forEach((img) => {
      let photos;
      try {
        photos = JSON.parse(img.dataset.photos);
      } catch (err) {
        return;
      }
      if (photos.length < 2) return;
      const dots = img.parentElement.querySelectorAll(".vehicle-media-dot");
      setInterval(() => {
        const next = (Number(img.dataset.photoIdx) + 1) % photos.length;
        img.dataset.photoIdx = String(next);
        img.src = photos[next];
        dots.forEach((d, i) => d.classList.toggle("on", i === next));
      }, 3200);
    });
  }

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

  function renderStars(rating) {
    const full = Math.round(rating);
    return Array.from({ length: 5 }, (_, i) => (i < full ? "★" : "☆")).join("");
  }

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
    media.innerHTML = `<img src="${u.photo}" alt="${vehicle.type} — ${u.model}" class="vehicle-modal-photo-fade${enterClass}">${nav}`;
    info.innerHTML = `
      <div class="vehicle-modal-row vehicle-modal-fade${enterClass}">
        <div>
          <h5>${u.model}</h5>
          <p class="vehicle-modal-color">${u.color} · ${vehicle.capacity}</p>
        </div>
        <span class="vehicle-modal-plate">${u.plate}</span>
      </div>
      <div class="vehicle-modal-driver vehicle-modal-fade${enterClass}">
        <div class="vehicle-modal-avatar">${u.driverPhoto ? `<img src="${u.driverPhoto}" alt="${u.driverName}">` : DRIVER_PLACEHOLDER_ICON}</div>
        <div class="vehicle-modal-driver-text">
          <p class="vehicle-modal-driver-name">${u.driverName}</p>
          <p class="vehicle-modal-driver-meta"><span class="vehicle-modal-stars">${renderStars(u.rating)}</span> ${u.rating.toFixed(1)} · ${u.trips} viajes completados</p>
        </div>
        <span class="vehicle-modal-verified">✓ Verificado</span>
      </div>
    `;

    tabs.innerHTML =
      units.length > 1
        ? units
            .map(
              (uu, i) =>
                `<button type="button" class="vehicle-modal-tab${i === idx ? " active" : ""}" data-idx="${i}" role="tab" aria-selected="${i === idx}">${uu.model.split(" ")[0]}</button>`
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

    setTimeout(() => {
      vehicleModalCtx.idx = newIdx;
      renderVehicleModalUnit(forward ? "fwd" : "bwd");
      vehicleModalCtx.animating = false;
    }, 170);
  }

  function openVehicleModal(vehicle) {
    vehicleModalCtx = { vehicle, idx: 0 };
    renderVehicleModalUnit();
    $("#vehicleModal").classList.add("open");
    trackEvent("vehicle_view", { vehicle_type: vehicle.type });
  }

  function closeVehicleModal() {
    $("#vehicleModal").classList.remove("open");
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
        `Hola *MOVILIDAD 360 SV* 👋\n\n` +
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
        <div class="faq-answer" id="faq-a-${i}" role="region" aria-labelledby="faq-q-${i}">
          <p>${item.a}</p>
        </div>
      </div>`
    ).join("");

    $$(".faq-question", list).forEach((btn) => {
      btn.addEventListener("click", () => {
        const answer = document.getElementById(btn.getAttribute("aria-controls"));
        const isOpen = answer.classList.toggle("open");
        btn.setAttribute("aria-expanded", String(isOpen));
        btn.classList.toggle("open", isOpen);
      });
    });
  }

  // Muestra el enlace a reseñas de Google solo si ya se configuró la URL
  // real en CONFIG.googleReviewsUrl (data.js).
  function wireGoogleReviewsLink() {
    const el = $("#google-reviews-link");
    if (!el) return;
    if (CONFIG.googleReviewsUrl) {
      el.href = CONFIG.googleReviewsUrl;
      el.hidden = false;
    }
  }

  /* =====================================================================
     Analítica (lista para activar en cuanto se conecte Google Analytics)
     ===================================================================== */
  function trackEvent(name, params) {
    if (typeof window.gtag === "function") {
      window.gtag("event", name, params || {});
    }
  }

  function wireAnalyticsEvents() {
    document.addEventListener("click", (e) => {
      const waBtn = e.target.closest('a[href*="wa.me"]');
      if (waBtn) trackEvent("whatsapp_click", { link_id: waBtn.id || "unknown" });
    });
  }

  /* =====================================================================
     PWA: registro del service worker (instalable / carga más rápida)
     ===================================================================== */
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    // Si una pestaña queda abierta y publicamos una actualización, el
    // navegador instala el nuevo service worker en segundo plano pero la
    // pestaña sigue mostrando el código viejo hasta que recarga. Con esto,
    // en cuanto el nuevo worker toma control, recargamos una sola vez
    // automáticamente para que nadie se quede con una versión desactualizada.
    let refreshed = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshed) return;
      refreshed = true;
      window.location.reload();
    });
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  /* =====================================================================
     Paneles expandibles (toggle)
     ===================================================================== */
  function wireTogglePanels() {
    $$("[data-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const panel = document.getElementById(btn.dataset.toggle);
        const isOpen = panel.classList.toggle("open");
        btn.setAttribute("aria-expanded", String(isOpen));
        const icon = btn.querySelector("svg");
        if (icon) icon.style.transform = isOpen ? "rotate(45deg)" : "rotate(0deg)";
      });
    });
  }

  /* =====================================================================
     Enlaces genéricos de WhatsApp
     ===================================================================== */
  function wireGenericWaLinks() {
    const genericMsg =
      `Hola *MOVILIDAD 360 SV* 👋\n\nQuiero cotizar un viaje. ¿Me ayudan, por favor?`;
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
    driverToggle.addEventListener("click", () => {
      const isOn = driverToggle.classList.toggle("on");
      driverToggle.setAttribute("aria-pressed", String(isOn));
      driverFields.classList.toggle("open", isOn);
    });

    const val = (id) => (document.getElementById(id).value || "").trim();

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const errorEl = document.getElementById("join-form-error");
      const name = val("join-name");
      const phone = val("join-phone");
      if (!name || !phone) {
        errorEl.hidden = false;
        (name ? document.getElementById("join-phone") : document.getElementById("join-name")).focus();
        return;
      }
      errorEl.hidden = true;

      const lines = [
        `Hola *MOVILIDAD 360 SV* 👋`,
        ``,
        `Quiero postularme para trabajar con ustedes. Aquí mi información:`,
        ``,
        `👤 Nombre completo: ${name}`,
        `📱 Teléfono/WhatsApp: ${phone}`,
      ];
      const age = val("join-age");
      if (age) lines.push(`🎂 Edad: ${age}`);
      const location = val("join-location");
      if (location) lines.push(`📍 Municipio y departamento: ${location}`);
      const area = val("join-area");
      if (area) lines.push(`💼 Área de interés: ${area}`);
      const schedule = val("join-schedule");
      if (schedule) lines.push(`🕐 Horarios disponibles: ${schedule}`);
      const experience = val("join-experience");
      if (experience) lines.push(`📋 Experiencia relacionada: ${experience}`);

      if (driverToggle.classList.contains("on")) {
        lines.push(``, `🚗 Aplico como conductor:`);
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

      trackEvent("whatsapp_click", { link_id: "join-us" });
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
    if (lastMovilizarteSelection) selectMovilizarteDestination(lastMovilizarteSelection);
    if (lastAirportSelection) selectAirport(lastAirportSelection);
    if (lastDepartmentSelection) selectDepartment(lastDepartmentSelection);
    if (lastTourismSelection) selectTourism(lastTourismSelection);
    if (lastTourismRouteSelection) selectTouristRoute(lastTourismRouteSelection);
  }

  /* =====================================================================
     Guardar / restaurar cotizaciones (localStorage)
     No se vuelve a llamar al servicio de ruteo al restaurar: se guarda el
     resultado ya calculado para que la última cotización aparezca al
     instante, incluso sin conexión.
     ===================================================================== */
  const STORAGE_KEY = "movilidad360_state_v1";

  function persistAll() {
    try {
      const state = { travel: {}, parcel: null, mudanza: null, tourismRoute: null, fixedRoute: null };
      TRAVEL_PREFIXES.forEach((prefix) => {
        const selection = {
          movilizarte: lastMovilizarteSelection,
          aeropuerto: lastAirportSelection,
          departamento: lastDepartmentSelection,
          turismo: lastTourismSelection,
        }[prefix];
        if (!selection || !lastQuoteResult[prefix]) return;
        state.travel[prefix] = {
          place: selection,
          quoteData: lastQuoteResult[prefix],
          route: quoteRouteData[prefix] || null,
          paxPets: paxPetsState[prefix] || { pax: 1, pets: false },
        };
      });
      if (lastTourismRouteSelection && lastQuoteResult.turismo) {
        state.tourismRoute = {
          route: lastTourismRouteSelection,
          quoteData: lastQuoteResult.turismo,
          route_: quoteRouteData.turismo || null,
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
        state.fixedRoute = { idx: fixedRouteIdx, paxPets: paxPetsState.tarifafija || { pax: 1, pets: false } };
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      // localStorage puede fallar en modo privado; no es crítico para el sitio.
    }
  }

  function restoreAll() {
    let state;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      state = JSON.parse(raw);
    } catch (err) {
      return;
    }

    if (state.travel) {
      Object.keys(state.travel).forEach((prefix) => {
        const saved = state.travel[prefix];
        if (!saved) return;
        if (prefix === "movilizarte") {
          lastMovilizarteSelection = saved.place;
          $("#input-movilizarte").value = saved.place.name;
        }
        if (prefix === "aeropuerto") lastAirportSelection = saved.place;
        if (prefix === "departamento") lastDepartmentSelection = saved.place;
        if (prefix === "turismo") lastTourismSelection = saved.place;

        if (saved.paxPets) applyPaxPetsUi(prefix, saved.paxPets.pax, saved.paxPets.pets);
        if (saved.route) quoteRouteData[prefix] = saved.route;
        if (saved.quoteData) showQuote(prefix, saved.quoteData);
      });
    }

    if (state.tourismRoute) {
      lastTourismRouteSelection = state.tourismRoute.route;
      if (state.tourismRoute.paxPets) applyPaxPetsUi("turismo", state.tourismRoute.paxPets.pax, state.tourismRoute.paxPets.pets);
      if (state.tourismRoute.route_) quoteRouteData.turismo = state.tourismRoute.route_;
      if (state.tourismRoute.quoteData) showQuote("turismo", state.tourismRoute.quoteData);
    }

    if (state.mudanza) {
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

    if (state.parcel) {
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

    if (state.fixedRoute && FIXED_ROUTES.destinations[state.fixedRoute.idx]) {
      fixedRouteIdx = state.fixedRoute.idx;
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
  document.addEventListener("DOMContentLoaded", () => {
    $("#year").textContent = new Date().getFullYear();

    wireGenericWaLinks();
    wireTogglePanels();
    wireMapModal();
    wireConfirmModal();
    wireVehicleModal();
    wireJourneyScrollFx();
    wireCoverageMap();
    renderTestimonials();
    renderVehicles();
    renderStats();
    renderFAQ();
    wireGoogleReviewsLink();
    wireAnalyticsEvents();
    registerServiceWorker();

    TRAVEL_PREFIXES.forEach(injectPaxPetsControls);

    // Parada 1
    renderLocalSuggestions("");
    $("#input-movilizarte").addEventListener(
      "input",
      debounce((e) => renderLocalSuggestions(e.target.value), 180)
    );

    // Parada 2
    renderAirports();
    $("#btn-locate").addEventListener("click", () => {
      requestGeolocation(refreshAllQuotesForNewOrigin);
    });

    // Parada 3
    wireParcelForm();

    // Parada 4
    renderDepartments();

    // Parada 5
    renderTouristRoutes();
    renderTouristChips();
    renderTourism();
    $("#input-turismo").addEventListener(
      "input",
      debounce((e) => {
        touristSearch = e.target.value;
        renderTourism();
      }, 180)
    );

    // Parada 6
    wireMudanzaForm();

    // Parada 7
    wireFixedRoutesForm();

    // Trabaja con nosotros
    wireJoinUsForm();

    // Restauramos la última cotización guardada (si existe) antes de pedir
    // ubicación, para que el cliente no pierda lo que ya tenía seleccionado.
    restoreAll();

    // Pedimos ubicación una sola vez al cargar, para que todas las
    // cotizaciones (no solo aeropuerto) usen la posición real del usuario.
    requestGeolocation(refreshAllQuotesForNewOrigin);
  });
})();
