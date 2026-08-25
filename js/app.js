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

  function currentOrigin() {
    return userLocation || CONFIG.originFallback;
  }
  function originLabel() {
    return userLocation ? "Tu ubicación actual" : CONFIG.originFallback.name;
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
        if (statusEl) statusEl.textContent = "Ubicación activada ✓ Todas las cotizaciones se calculan desde tu posición actual.";
        if (bannerEl) bannerEl.classList.add("located");
        cb(true);
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
  const TRAVEL_PREFIXES = ["movilizarte", "aeropuerto", "departamento", "turismo"];
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

  function showQuote(prefix, { originName, destName, price, minutes, distanceKm, extraLine, real, passengers, pets }) {
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

    const serviceNames = {
      movilizarte: "viaje local",
      aeropuerto: "traslado al aeropuerto",
      departamento: "viaje interdepartamental",
      turismo: "viaje turístico",
    };

    const msg =
      `Hola *MOVILIDAD 360 SV* 👋\n\n` +
      `Quiero cotizar un *${serviceNames[prefix]}*:\n` +
      `📍 Desde: ${originName}\n` +
      `🎯 Hasta: ${destName}\n` +
      `📏 Distancia ${real ? "real por carretera" : "aproximada"}: ${distanceKm.toFixed(1)} km\n` +
      `💵 Precio estimado: ${formatMoney(price)}\n` +
      `⏱️ Tiempo estimado: ${formatEta(minutes)}\n` +
      `👥 Pasajeros: ${passengers || 1}\n` +
      `🐾 Mascota: ${pets ? "Sí" : "No"}` +
      (extraLine ? `\n${extraLine}` : "") +
      `\n\n¿Podrían confirmar disponibilidad?`;

    $(`#wa-${prefix}`).href = waLink(msg);
  }

  /* =====================================================================
     PARADA 1 — ¿Necesitas movilizarte?
     ===================================================================== */
  function renderLocalSuggestions(filterText) {
    const list = $("#list-movilizarte");
    const empty = $("#empty-movilizarte");
    const q = norm(filterText);
    const matches = q
      ? LOCAL_PLACES.filter((p) => norm(p.name).includes(q))
      : LOCAL_PLACES.slice(0, 8);

    if (matches.length === 0) {
      list.innerHTML = "";
      empty.classList.add("show");
      return;
    }
    empty.classList.remove("show");
    list.innerHTML = matches
      .map(
        (p, i) => `
      <button type="button" class="suggestion-item" data-idx="${i}">
        <span>
          <span class="suggestion-name">${p.name}</span><br>
          <span class="suggestion-meta">Punto popular del área metropolitana</span>
        </span>
        <span class="suggestion-tag">Elegir</span>
      </button>`
      )
      .join("");

    $$(".suggestion-item", list).forEach((btn, i) => {
      btn.addEventListener("click", () => selectMovilizarteDestination(matches[i]));
    });
  }

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
    const { passengers, pets } = paxPetsFor("movilizarte");
    showQuote("movilizarte", {
      originName,
      destName: place.name,
      price,
      minutes: route.minutes,
      distanceKm: route.distanceKm,
      real: route.real,
      passengers,
      pets,
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
    const { passengers, pets } = paxPetsFor("aeropuerto");
    showQuote("aeropuerto", {
      originName,
      destName: airport.name,
      price,
      minutes: route.minutes,
      distanceKm: route.distanceKm,
      real: route.real,
      passengers,
      pets,
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

    const msg =
      `Hola *MOVILIDAD 360 SV* 👋\n\n` +
      `Quiero cotizar el envío de una *encomienda*:\n` +
      `📦 Tamaño: ${parcelSizeLabels[parcelState.size]}\n` +
      `🚀 Urgencia: ${parcelState.urgent ? "Mismo día (express)" : "Estándar"}\n` +
      `⚠️ Frágil: ${parcelState.fragile ? "Sí" : "No"}\n` +
      `📍 Recolección: ${from}\n` +
      `🎯 Entrega: ${to}` +
      (distanceKm !== null ? `\n📏 Distancia ${real ? "real por carretera" : "aproximada"}: ${distanceKm.toFixed(1)} km` : "") +
      (notes ? `\n📝 Instrucciones: ${notes}` : "") +
      `\n💵 Precio estimado: ${formatMoney(price)}\n\n¿Podrían confirmar disponibilidad?`;

    $("#wa-encomienda").href = waLink(msg);
    persistAll();
  }

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
    const { passengers, pets } = paxPetsFor("departamento");
    showQuote("departamento", {
      originName,
      destName,
      price,
      minutes: route.minutes,
      distanceKm: route.distanceKm,
      real: route.real,
      passengers,
      pets,
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

    if (filtered.length === 0) {
      grid.innerHTML = "";
      empty.classList.add("show");
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

  let lastTourismSelection = null;

  async function selectTourism(place) {
    lastTourismSelection = place;
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
    const { passengers, pets } = paxPetsFor("turismo");
    showQuote("turismo", {
      originName,
      destName: place.name,
      price,
      minutes: route.minutes,
      distanceKm: route.distanceKm,
      real: route.real,
      passengers,
      pets,
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
      closeMapModal();
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
    moto: '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17l4-8h4l2 4h3M10 9H8m4 8h4"/>',
  };

  function renderVehicles() {
    const grid = $("#vehicles-grid");
    if (!grid) return;
    grid.innerHTML = VEHICLES.map(
      (v) => `
      <div class="vehicle-card">
        <div class="vehicle-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${VEHICLE_ICONS[v.icon] || ""}</svg>
        </div>
        <h4>${v.type}</h4>
        <p class="vehicle-capacity">${v.capacity}</p>
        <p class="vehicle-desc">${v.desc}</p>
      </div>`
    ).join("");
  }

  function renderStats() {
    const tripsEl = $("#stat-trips");
    if (tripsEl) tripsEl.textContent = `+${CONFIG.tripsCompleted}`;
    const responseEls = $$(".response-badge-text");
    responseEls.forEach((el) => {
      el.textContent = `Respuesta estimada: ~${CONFIG.responseMinutes} min`;
    });
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

  function wireJoinUsLink() {
    const el = document.getElementById("footer-join-us");
    if (!el) return;
    const msg =
      `Hola *MOVILIDAD 360 SV* 👋\n\nMe interesa trabajar con ustedes. ` +
      `¿Podrían darme más información sobre cómo unirme al equipo?`;
    el.href = waLink(msg);
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
      const state = { travel: {}, parcel: null };
      TRAVEL_PREFIXES.forEach((prefix) => {
        const selection = {
          movilizarte: lastMovilizarteSelection,
          aeropuerto: lastAirportSelection,
          departamento: lastDepartmentSelection,
          turismo: lastTourismSelection,
        }[prefix];
        if (!selection) return;
        const priceText = $(`#quote-${prefix}-price`).textContent;
        const routeText = $(`#quote-${prefix}-route`).textContent;
        const etaText = $(`#quote-${prefix}-eta`).textContent;
        if (!priceText || priceText === "…") return;
        state.travel[prefix] = {
          place: selection,
          originName: originLabel(),
          priceText,
          routeText,
          etaText,
          route: quoteRouteData[prefix] || null,
          paxPets: paxPetsState[prefix] || { pax: 1, pets: false },
        };
      });
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

        $(`#quote-${prefix}-route`).textContent = saved.routeText;
        $(`#quote-${prefix}-price`).textContent = saved.priceText;
        $(`#quote-${prefix}-eta`).textContent = saved.etaText;
        $(`#quote-${prefix}`).classList.add("show");
        const badge = $(`#quote-${prefix}-badge`);
        if (badge && saved.route) {
          badge.textContent = saved.route.real ? "🧭 Ruta real por carretera" : "≈ Ruta aproximada (línea recta)";
          badge.classList.toggle("is-approx", !saved.route.real);
        }
        const routeLinkEl = $(`#route-link-${prefix}`);
        if (routeLinkEl) routeLinkEl.hidden = !saved.route;
      });
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
      const pct = total > 0 ? (scrolled / total) * 100 : 0;
      progressEl.style.height = pct + "%";
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
    wireJourneyScrollFx();
    wireCoverageMap();
    renderTestimonials();
    renderVehicles();
    renderStats();

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
    renderTouristChips();
    renderTourism();
    $("#input-turismo").addEventListener(
      "input",
      debounce((e) => {
        touristSearch = e.target.value;
        renderTourism();
      }, 180)
    );

    // Trabaja con nosotros
    wireJoinUsLink();

    // Restauramos la última cotización guardada (si existe) antes de pedir
    // ubicación, para que el cliente no pierda lo que ya tenía seleccionado.
    restoreAll();

    // Pedimos ubicación una sola vez al cargar, para que todas las
    // cotizaciones (no solo aeropuerto) usen la posición real del usuario.
    requestGeolocation(refreshAllQuotesForNewOrigin);
  });
})();
