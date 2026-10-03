/* Public-service adapter. Search is EXPLICIT, never autocomplete. A production
   multi-user quota must be enforced by a chosen provider/proxy, not this tab. */
(function (root) {
  'use strict';
  const cache = new Map();
  const pending = new Map();
  let queue = Promise.resolve(), lastRequest = 0;
  class GeoError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  async function json(url, timeout = 7000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) throw new GeoError(response.status === 429 ? 'rate-limit' : 'unavailable',
        response.status === 429 ? 'El buscador está ocupado. Espera un momento y vuelve a buscar.' : 'El servicio no respondió. Intenta de nuevo o marca el punto en el mapa.');
      return await response.json();
    } catch (error) {
      if (error instanceof GeoError) throw error;
      throw new GeoError(error.name === 'AbortError' ? 'timeout' : 'offline',
        error.name === 'AbortError' ? 'La búsqueda tardó demasiado. Vuelve a intentarlo.' : 'No pudimos conectar. Revisa tu conexión y vuelve a buscar.');
    } finally { clearTimeout(timer); }
  }
  function geocoder(path, signal) {
    const base = CONFIG.geocodingBaseUrl;
    if (!base || !base.startsWith('https://')) return Promise.reject(new GeoError('configuration', 'Búsqueda no disponible. Puedes elegir un punto en el mapa.'));
    const url = base.replace(/\/$/, '') + path;
    const found = cache.get(url);
    if (found && Date.now() - found.time < 15 * 60 * 1000) return Promise.resolve(found.data);
    const cancelled = () => new GeoError('cancelled', 'Búsqueda sustituida por una nueva.');
    if (signal?.aborted) return Promise.reject(cancelled());
    const existing = pending.get(url);
    if (existing) {
      existing.signals.push(signal);
      return existing.promise.then(data => { if (signal?.aborted) throw cancelled(); return data; });
    }
    const job = { signals: [signal] };
    const wanted = () => job.signals.some(s => !s?.aborted);
    const run = queue.catch(() => {}).then(async () => {
      if (!wanted()) throw cancelled();
      // Courtesy throttle for this browser; this is not a global application quota.
      const wait = Math.max(0, 1100 - (Date.now() - lastRequest));
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      if (!wanted()) throw cancelled();
      lastRequest = Date.now();
      const data = await json(url);
      if (cache.size >= 50) cache.delete(cache.keys().next().value);
      cache.set(url, { time: Date.now(), data });
      return data;
    });
    queue = run;
    job.promise = run.finally(() => pending.delete(url));
    pending.set(url, job);
    return job.promise.then(data => { if (signal?.aborted) throw cancelled(); return data; });
  }
  async function search(query, { signal } = {}) {
    const q = String(query).trim().slice(0, 180);
    if (q.length < 3) return [];
    const data = await geocoder('/search?format=jsonv2&countrycodes=sv&limit=5&q=' + encodeURIComponent(q), signal);
    if (!Array.isArray(data)) throw new GeoError('invalid', 'El buscador devolvió una respuesta inesperada. Inténtalo de nuevo.');
    return data.filter(d => typeof d.display_name === 'string' && d.lat != null && d.lon != null && String(d.lat).trim() && String(d.lon).trim()).map(d => ({
      name: d.display_name.split(',').slice(0,2).join(',').trim(), fullName: d.display_name,
      lat: Number(d.lat), lng: Number(d.lon)
    })).filter(M360Core.validPoint);
  }
  async function reverse(point) {
    if (!M360Core.validPoint(point)) return null;
    try {
      const data = await geocoder(`/reverse?format=jsonv2&lat=${point.lat}&lon=${point.lng}&zoom=16&addressdetails=1`);
      const a = data.address || {};
      return [...new Set([a.neighbourhood || a.suburb || a.road || a.village || a.town, a.city || a.town || a.municipality].filter(Boolean))].join(',') || null;
    } catch { return null; }
  }
  root.M360Geo = { json, search, reverse, GeoError };
})(globalThis);
