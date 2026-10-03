/* Pure business rules. No DOM, network or storage dependencies. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.M360Core = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DRAFT_VERSION = 2;
  const DRAFT_TTL = 24 * 60 * 60 * 1000;
  function validPoint(p) {
    return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) &&
      Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
  }
  function distancePrice(km, config) {
    if (!Number.isFinite(km) || km < 0) throw new RangeError('Distancia inválida');
    let total = 0, lower = 0;
    for (const tier of config.distanceTiers) {
      if (!(tier.upTo > lower) || !Number.isFinite(tier.rate) || tier.rate < 0) throw new RangeError('Tarifa inválida');
      total += Math.max(0, Math.min(km, tier.upTo) - lower) * tier.rate;
      lower = tier.upTo;
      if (km <= lower) break;
    }
    return total;
  }
  function breakdown(km, pets, config) {
    const distance = distancePrice(km, config);
    const minimumAdjustment = Math.max(0, config.minFareUsd - distance);
    const petFee = pets ? config.petFee : 0;
    const cents = n => Math.round((n + Number.EPSILON) * 100) / 100;
    return { distance: cents(distance), minimumAdjustment: cents(minimumAdjustment), petFee,
      total: cents(distance + minimumAdjustment + petFee), tariffVersion: config.tariffVersion };
  }
  function phone(value) {
    const raw = String(value || '').trim();
    if (!/^[+\d\s().-]+$/.test(raw)) return null;
    let digits = raw.replace(/\D/g, '');
    if (digits.length === 8) digits = '503' + digits;
    if (digits.length < 10 || digits.length > 15) return null;
    if (digits.startsWith('503') && !/^503[267]\d{7}$/.test(digits)) return null;
    return '+' + digits;
  }
  function placeId(name) {
    return String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  function gates() {
    const versions = new Map();
    return { next(key) { const v = (versions.get(key) || 0) + 1; versions.set(key, v); return v; },
      current(key, v) { return versions.get(key) === v; } };
  }
  function restoreDraft(raw, now = Date.now()) {
    if (!raw || raw.version !== DRAFT_VERSION || !Number.isFinite(raw.savedAt) ||
        raw.savedAt > now + 60000 || now - raw.savedAt > DRAFT_TTL) return null;
    if (raw.origin && (!validPoint(raw.origin.point) || !['gps','search'].includes(raw.origin.source))) return null;
    return raw;
  }
  return { validPoint, distancePrice, breakdown, phone, placeId, gates, restoreDraft, DRAFT_VERSION, DRAFT_TTL };
});
