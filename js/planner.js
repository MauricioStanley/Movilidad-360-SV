/* Scheduling and saved-route contracts. No network, DOM or storage side effects. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.M360Planner = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SERVICES = ['movilizarte', 'aeropuerto', 'departamento', 'turismo', 'encomienda', 'mudanza', 'tarifafija'];
  const ROUTE_TTL = 90 * 24 * 60 * 60 * 1000;
  const text = (v, max = 160) => typeof v === 'string' ? v.replace(/[\r\n\t]/g, ' ').trim().slice(0, max) : '';
  function localDate(now = Date.now()) {
    return new Date(now - 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
  function schedule(input = {}, now = Date.now()) {
    const mode = input.mode === 'later' ? 'later' : 'now';
    let instant = null;
    if (mode === 'later') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || '')) return { error: 'Elige la fecha de recogida.', field: 'planDate' };
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time || '')) return { error: 'Elige la hora de recogida.', field: 'planTime' };
      instant = Date.parse(`${input.date}T${input.time}:00-06:00`);
      if (!Number.isFinite(instant) || localDate(instant) !== input.date) return { error: 'La fecha no es válida.', field: 'planDate' };
      if (instant <= now) return { error: 'Elige una fecha y hora futuras de El Salvador.', field: 'planTime' };
    }
    const bags = input.bags === '' || input.bags == null ? null : Number(input.bags);
    if (bags !== null && (!Number.isInteger(bags) || bags < 0 || bags > 20)) return { error: 'Indica entre 0 y 20 maletas; para más equipaje coordina con el equipo.', field: 'planBags' };
    const flight = text(input.flight, 20).toUpperCase();
    if (flight && !/^[A-Z0-9 -]{2,12}$/.test(flight)) return { error: 'Revisa el número de vuelo (por ejemplo AV123).', field: 'planFlight' };
    const when = mode === 'later'
      ? new Intl.DateTimeFormat('es-SV', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/El_Salvador' }).format(new Date(instant)) + ' · hora de El Salvador'
      : 'Ahora · sujeto a disponibilidad';
    return { mode, date: mode === 'later' ? input.date : '', time: mode === 'later' ? input.time : '', instant, bags, flight, when };
  }
  function point(value) {
    if (!value || !Number.isFinite(value.lat) || !Number.isFinite(value.lng) || Math.abs(value.lat) > 90 || Math.abs(value.lng) > 180 || !text(value.name)) return null;
    return { name: text(value.name), lat: value.lat, lng: value.lng };
  }
  function route(input) {
    if (!input || !SERVICES.includes(input.service)) return null;
    if (input.service === 'tarifafija') return text(input.fixedName) ? { service: input.service, fixedName: text(input.fixedName) } : null;
    const origin = point(input.origin), destination = point(input.destination);
    if (!origin || !destination) return null;
    const result = { service: input.service, origin, destination };
    if (input.service === 'aeropuerto') result.airportDirection = input.airportDirection === 'from' ? 'from' : 'to';
    if (input.service === 'turismo' && input.stops?.length) {
      if (!Array.isArray(input.stops) || input.stops.length > 12) return null;
      result.stops = input.stops.map(point);
      if (result.stops.some(p => !p)) return null;
    }
    if (input.service === 'encomienda') result.size = ['small','medium','large'].includes(input.size) ? input.size : 'small';
    if (input.service === 'mudanza') result.size = ['estudio','apartamento','casa'].includes(input.size) ? input.size : 'estudio';
    return result;
  }
  function savedRoutes(raw, now = Date.now()) {
    if (!raw || raw.version !== 1 || !Array.isArray(raw.routes)) return [];
    return raw.routes.slice(0, 6).flatMap(entry => {
      const value = route(entry?.route);
      return value && text(entry.label, 48) && Number.isFinite(entry.savedAt) && entry.savedAt <= now + 60000 && now - entry.savedAt < ROUTE_TTL
        ? [{ label: text(entry.label, 48), savedAt: entry.savedAt, route: value }] : [];
    });
  }
  return { schedule, localDate, route, savedRoutes, SERVICES, ROUTE_TTL };
});
