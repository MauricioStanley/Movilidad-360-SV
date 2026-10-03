/* Request preferences and explicitly saved routes; no simulated reservation status. */
(function (root) {
  'use strict';
  const $ = id => document.getElementById(id);
  const STORAGE = 'm360_saved_routes_v1';
  const drafts = new Map();
  let mode = 'now', service = '', currentRoute = null, repeatRoute = null;
  function read() {
    return M360Planner.schedule({ mode, date: $('planDate').value, time: $('planTime').value,
      bags: $('planTravelExtras').hidden ? '' : $('planBags').value,
      flight: service === 'aeropuerto' ? $('planFlight').value : '' });
  }
  function sync() {
    document.querySelectorAll('[data-plan-mode]').forEach(b => {
      const selected = b.dataset.planMode === mode;
      b.classList.toggle('selected', selected); b.setAttribute('aria-pressed', String(selected));
    });
    $('planSchedule').hidden = mode !== 'later';
    $('planDate').min = M360Planner.localDate();
    const plan = read();
    $('planSummary').textContent = plan.error || `${plan.when}. La solicitud queda pendiente de aceptación del equipo.`;
    const error = $('confirmError');
    if (!plan.error && error?.dataset.field?.startsWith('plan')) error.hidden = true;
  }
  function remember(key) {
    if (drafts.size >= 12 && !drafts.has(key)) drafts.delete(drafts.keys().next().value);
    drafts.set(key, { mode, date: $('planDate').value, time: $('planTime').value, bags: $('planBags').value, flight: $('planFlight').value });
  }
  function open(key, nextService, route) {
    service = nextService; currentRoute = M360Planner.route(route);
    const draft = drafts.get(key) || {};
    mode = draft.mode === 'later' ? 'later' : 'now';
    for (const [id, key] of [['planDate','date'],['planTime','time'],['planBags','bags'],['planFlight','flight']]) $(id).value = draft[key] || '';
    $('planTravelExtras').hidden = ['encomienda','mudanza'].includes(service);
    $('planTravelExtras').open = false;
    $('planFlightField').hidden = service !== 'aeropuerto';
    $('saveRoutePanel').hidden = !currentRoute; $('saveRoutePanel').open = false;
    $('saveRouteConsent').checked = false; $('saveRouteStatus').textContent = '';
    $('saveRouteName').value = currentRoute ? (currentRoute.fixedName || `${currentRoute.origin.name} → ${currentRoute.destination.name}`).slice(0,48) : '';
    sync();
  }
  function message(plan) {
    return `\n\n*Recogida solicitada:* ${plan.when}` +
      (plan.bags !== null ? `\n*Maletas:* ${plan.bags} (confirmar espacio y cualquier ajuste)` : '') +
      (plan.flight ? `\n*Vuelo:* ${plan.flight}` : '') +
      '\nSolicitud pendiente de aceptación. Por favor confirmar disponibilidad, hora y precio final.';
  }
  function readSaved() {
    try { return M360Planner.savedRoutes(JSON.parse(localStorage.getItem(STORAGE))); }
    catch { return []; }
  }
  function storeSaved(routes) {
    try {
      if (routes.length) localStorage.setItem(STORAGE, JSON.stringify({ version: 1, routes }));
      else localStorage.removeItem(STORAGE);
      return true;
    } catch { return false; }
  }
  function renderSaved() {
    const routes = readSaved(), list = $('savedRoutesList');
    list.replaceChildren(); $('savedRoutesCount').textContent = routes.length ? `(${routes.length})` : '';
    $('clearSavedRoutes').hidden = !routes.length;
    if (!routes.length) {
      const empty = document.createElement('p'); empty.className = 'field-hint';
      empty.textContent = 'Aún no guardaste rutas. Puedes hacerlo al revisar una solicitud; no necesitas una cuenta.';
      list.appendChild(empty); return;
    }
    routes.forEach((entry, i) => {
      const row = document.createElement('div'); row.className = 'saved-route';
      const use = document.createElement('button'); use.type = 'button'; use.className = 'saved-route-use';
      const title = document.createElement('strong'); title.textContent = entry.label;
      const description = document.createElement('span'); description.textContent = entry.route.fixedName || `${entry.route.origin.name} → ${entry.route.destination.name}`;
      const action = document.createElement('span'); action.className = 'saved-route-action'; action.textContent = 'Usar y recalcular';
      use.append(title, description, action);
      use.addEventListener('click', () => { $('savedRoutesPanel').open = false; repeatRoute?.(entry.route); });
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button';
      remove.textContent = 'Eliminar'; remove.setAttribute('aria-label', `Eliminar ruta ${entry.label}`);
      remove.addEventListener('click', () => {
        // Read again to avoid overwriting a route saved in another tab.
        const next = readSaved().filter(e => !(e.savedAt === entry.savedAt && JSON.stringify(e.route) === JSON.stringify(entry.route)));
        const removed = storeSaved(next); renderSaved();
        $('savedRoutesStatus').textContent = removed ? 'Ruta eliminada de este dispositivo.' : 'No se pudo eliminar. Revisa el almacenamiento del navegador.';
        $('savedRoutesPanel').querySelector('summary').focus();
      });
      row.append(use, remove); list.appendChild(row);
    });
  }
  function init(onRepeat) {
    repeatRoute = onRepeat;
    document.querySelectorAll('[data-plan-mode]').forEach(button => button.addEventListener('click', () => {
      mode = button.dataset.planMode; sync(); if (mode === 'later') $('planDate').focus();
    }));
    ['planDate','planTime','planBags','planFlight'].forEach(id => $(id).addEventListener('input', sync));
    $('saveRouteButton').addEventListener('click', () => {
      const status = $('saveRouteStatus'), label = $('saveRouteName').value.trim();
      if (!label) { status.textContent = 'Escribe un nombre para reconocer la ruta.'; $('saveRouteName').focus(); return; }
      if (!$('saveRouteConsent').checked) { status.textContent = 'Confirma que deseas guardar estas direcciones en este dispositivo.'; $('saveRouteConsent').focus(); return; }
      if (!currentRoute) return;
      const routes = readSaved().filter(e => JSON.stringify(e.route) !== JSON.stringify(currentRoute));
      if (routes.length >= 6) { status.textContent = 'Ya tienes seis rutas. Elimina una en «Mis rutas guardadas» antes de añadir otra.'; return; }
      routes.unshift({ label: label.slice(0,48), savedAt: Date.now(), route: currentRoute });
      const saved = storeSaved(routes); renderSaved();
      status.textContent = saved ? 'Ruta guardada durante 90 días. No se guardaron precios ni datos de contacto.' : 'Tu navegador no permite guardar. Puedes continuar sin guardar la ruta.';
    });
    $('clearSavedRoutes').addEventListener('click', () => {
      const removed = storeSaved([]); renderSaved();
      $('savedRoutesStatus').textContent = removed ? 'Rutas eliminadas de este dispositivo.' : 'No se pudo borrar el almacenamiento.';
      $('savedRoutesPanel').querySelector('summary').focus();
    });
    root.addEventListener('storage', event => { if (event.key === STORAGE) renderSaved(); });
    renderSaved();
  }
  root.M360Request = { init, open, remember, read, message, clearDrafts: () => drafts.clear() };
})(globalThis);
