/* =========================================================================
   MOVILIDAD 360 SV — app.js
   Toda la interacción vive del lado del cliente (sitio 100% estático,
   pensado para GitHub Pages). Las cotizaciones se calculan con distancia
   en línea recta (fórmula de Haversine) + una velocidad promedio, y se
   envían como mensaje pre-armado a WhatsApp para que el equipo confirme.
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

  /* ---------------- Cotización genérica ---------------- */
  function showQuote(prefix, { originName, destName, price, minutes, distanceKm, extraLine }) {
    $(`#quote-${prefix}-route`).textContent = `${originName} → ${destName} · ${distanceKm.toFixed(1)} km`;
    $(`#quote-${prefix}-price`).textContent = formatMoney(price);
    $(`#quote-${prefix}-eta`).textContent = `Tiempo estimado: ${formatEta(minutes)}`;
    $(`#quote-${prefix}`).classList.add("show");

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
      `📏 Distancia aprox: ${distanceKm.toFixed(1)} km\n` +
      `💵 Precio estimado: ${formatMoney(price)}\n` +
      `⏱️ Tiempo estimado: ${formatEta(minutes)}` +
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

  function selectMovilizarteDestination(place) {
    lastMovilizarteSelection = place;
    $("#input-movilizarte").value = place.name;
    const origin = currentOrigin();
    const distanceKm = haversineKm(origin.lat, origin.lng, place.lat, place.lng);
    const minutes = estimateMinutes(distanceKm);
    const price = estimatePrice(distanceKm);
    showQuote("movilizarte", { originName: originLabel(), destName: place.name, price, minutes, distanceKm });
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
        const minutes = estimateMinutes(a.distanceKm);
        const price = estimatePrice(a.distanceKm);
        return `
        <button type="button" class="option-card" data-idx="${i}">
          <div class="option-card-top">
            <span class="option-title">${a.name}</span>
            ${i === 0 ? '<span class="option-badge">Más cercano</span>' : ""}
          </div>
          <span class="option-desc">${a.short} · ${a.type}</span>
          <div class="option-foot">
            <span class="price">${formatMoney(price)}</span>
            <span class="eta">${formatEta(minutes)}</span>
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

  function selectAirport(airport) {
    lastAirportSelection = airport;
    const origin = currentOrigin();
    const distanceKm = haversineKm(origin.lat, origin.lng, airport.lat, airport.lng);
    const minutes = estimateMinutes(distanceKm);
    const price = estimatePrice(distanceKm);
    showQuote("aeropuerto", {
      originName: originLabel(),
      destName: airport.name,
      price,
      minutes,
      distanceKm,
      extraLine: "✈️ Por favor confirmar hora de vuelo para calcular hora de recogida.",
    });
  }

  /* =====================================================================
     PARADA 3 — ¿Enviar una encomienda?
     ===================================================================== */
  const parcelState = { size: null, urgent: false, fragile: false, fromPoint: null, toPoint: null };
  const parcelSizeLabels = {
    small: "Pequeño (<2kg)",
    medium: "Mediano (2–8kg)",
    large: "Grande (8–20kg)",
  };

  function updateParcelQuote() {
    if (!parcelState.size) return;
    let price = CONFIG.pricing.parcel[parcelState.size];
    if (parcelState.urgent) price += CONFIG.pricing.parcel.urgentSurcharge;

    let distanceKm = null;
    if (parcelState.fromPoint && parcelState.toPoint) {
      distanceKm = haversineKm(
        parcelState.fromPoint.lat, parcelState.fromPoint.lng,
        parcelState.toPoint.lat, parcelState.toPoint.lng
      );
      price += estimatePrice(distanceKm);
    }

    $("#quote-encomienda-route").textContent =
      `Encomienda ${parcelSizeLabels[parcelState.size]}${parcelState.fragile ? " · frágil" : ""}` +
      (distanceKm !== null ? ` · ${distanceKm.toFixed(1)} km` : "");
    $("#quote-encomienda-price").textContent = formatMoney(price);
    $("#quote-encomienda-eta").textContent = parcelState.urgent
      ? "Entrega estimada: mismo día"
      : "Entrega estimada: 24–48 horas";
    $("#quote-encomienda").classList.add("show");

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
      (distanceKm !== null ? `\n📏 Distancia aprox: ${distanceKm.toFixed(1)} km` : "") +
      (notes ? `\n📝 Instrucciones: ${notes}` : "") +
      `\n💵 Precio estimado: ${formatMoney(price)}\n\n¿Podrían confirmar disponibilidad?`;

    $("#wa-encomienda").href = waLink(msg);
  }

  function selectParcelPoint(which, place) {
    const inputId = which === "from" ? "#parcel-from" : "#parcel-to";
    const hintId = which === "from" ? "#parcel-from-map-hint" : "#parcel-to-map-hint";
    $(inputId).value = place.name;
    $(hintId).textContent = "Punto marcado en el mapa ✓";
    if (which === "from") parcelState.fromPoint = { lat: place.lat, lng: place.lng };
    else parcelState.toPoint = { lat: place.lat, lng: place.lng };
    updateParcelQuote();
  }

  function wireParcelForm() {
    $$("#parcel-size .pill-option").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$("#parcel-size .pill-option").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
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
      const minutes = estimateMinutes(distanceKm);
      const price = estimatePrice(distanceKm);
      return `
        <button type="button" class="option-card" data-idx="${i}">
          <div class="option-card-top">
            <span class="option-title">${d.name}</span>
            ${d.popular ? '<span class="option-badge">Popular</span>' : ""}
          </div>
          <span class="option-desc">${d.tag}</span>
          <div class="option-foot">
            <span class="price">${formatMoney(price)}</span>
            <span class="eta">${formatEta(minutes)}</span>
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

  function selectDepartment(dept) {
    lastDepartmentSelection = dept;
    const origin = currentOrigin();
    const distanceKm = haversineKm(origin.lat, origin.lng, dept.lat, dept.lng);
    const minutes = estimateMinutes(distanceKm);
    const price = estimatePrice(distanceKm);
    showQuote("departamento", {
      originName: originLabel(),
      destName: `Departamento de ${dept.name}`,
      price,
      minutes,
      distanceKm,
    });
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
      .map((c) => `<button type="button" class="chip${c === touristCategory ? " active" : ""}" data-cat="${c}">${c}</button>`)
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
        const minutes = estimateMinutes(distanceKm);
        const price = estimatePrice(distanceKm);
        return `
        <button type="button" class="option-card" data-idx="${i}">
          <div class="option-card-top">
            <span class="option-title">${p.name}</span>
            <span class="option-badge teal">${p.category}</span>
          </div>
          <span class="option-desc">${p.desc}</span>
          <div class="option-foot">
            <span class="price">${formatMoney(price)}</span>
            <span class="eta">${formatEta(minutes)}</span>
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

  function selectTourism(place) {
    lastTourismSelection = place;
    const origin = currentOrigin();
    const distanceKm = haversineKm(origin.lat, origin.lng, place.lat, place.lng);
    const minutes = estimateMinutes(distanceKm);
    const price = estimatePrice(distanceKm);
    showQuote("turismo", {
      originName: originLabel(),
      destName: place.name,
      price,
      minutes,
      distanceKm,
    });
  }

  /* =====================================================================
     Mapa (Leaflet) — respaldo cuando no se encuentra una ubicación
     ===================================================================== */
  let map, marker, pendingLatLng, mapContext;

  function ensureMap() {
    if (map) return;
    map = L.map("leaflet-map", { scrollWheelZoom: true }).setView([13.7, -89.2], 8);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; colaboradores de OpenStreetMap",
      maxZoom: 18,
    }).addTo(map);
    map.on("click", (e) => {
      pendingLatLng = e.latlng;
      if (marker) marker.setLatLng(e.latlng);
      else marker = L.marker(e.latlng, { draggable: true }).addTo(map);
      $("#mapModalHint").textContent = `Punto seleccionado: ${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`;
      $("#mapModalConfirm").disabled = false;
    });
  }

  function openMapModal(context) {
    mapContext = context;
    $("#mapModal").classList.add("open");
    ensureMap();
    pendingLatLng = null;
    if (marker) {
      marker.remove();
      marker = null;
    }
    $("#mapModalConfirm").disabled = true;
    $("#mapModalHint").textContent = "Toca el mapa para colocar un pin en tu destino.";
    setTimeout(() => map.invalidateSize(), 60);
  }

  function closeMapModal() {
    $("#mapModal").classList.remove("open");
  }

  function wireMapModal() {
    $$("[data-open-map]").forEach((btn) => {
      btn.addEventListener("click", () => openMapModal(btn.dataset.openMap));
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

    // Pedimos ubicación una sola vez al cargar, para que todas las
    // cotizaciones (no solo aeropuerto) usen la posición real del usuario.
    requestGeolocation(refreshAllQuotesForNewOrigin);
  });
})();