const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/app.js', 'utf8');
function extract(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
}
function fixture() {
  const els = new Map();
  const classes = new Set();
  const section = { classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); } } };
  const $ = selector => {
    if (!els.has(selector)) els.set(selector, { hidden: true, textContent: '', innerHTML: '', closest: () => section });
    return els.get(selector);
  };
  const ctx = { $, URL, Date, console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('js/data.js', 'utf8') + ';globalThis.config=CONFIG;globalThis.reviews=TESTIMONIALS;', ctx);
  vm.runInContext(extract('escapeHtml') + '\n' + extract('renderStars') + '\n' + extract('renderTestimonials'), ctx);
  return { ctx, $, classes };
}
test('real Google review snapshot displays source, consultation date and accessible ratings', () => {
  const { ctx, $ } = fixture();
  ctx.renderTestimonials();
  assert.equal($('#testimonials-grid').hidden, false);
  assert.equal(( $('#testimonials-grid').innerHTML.match(/class="testimonial-card"/g) || []).length, 3);
  assert.match($('#testimonials-grid').innerHTML, /aria-label="5 de 5 estrellas"/);
  assert.match($('#testimonials-grid').innerHTML, /Fuente: Google Maps/);
  assert.equal($('#google-rating-summary').textContent, '5,0 de 5 · 8 opiniones en Google');
  assert.match($('#google-rating-date').textContent, /2026/);
  assert.match($('#google-rating-date').textContent, /manual, no en tiempo real/);
});
test('empty or malformed review entries cannot leave empty cards or stale classes', () => {
  const { ctx, $, classes } = fixture();
  ctx.renderTestimonials();
  ctx.reviews.splice(0, ctx.reviews.length, null, {}, { name: ' ', quote: ' ' });
  ctx.renderTestimonials();
  assert.equal($('#testimonials-grid').hidden, true);
  assert.equal($('#testimonials-grid').innerHTML, '');
  assert.equal($('#testimonials-note').hidden, true);
  assert.equal(classes.has('has-testimonials'), false);
});
test('review text is escaped and unsafe source URLs or invalid snapshots are omitted', () => {
  const { ctx, $ } = fixture();
  ctx.reviews.splice(0, ctx.reviews.length, { name: '<img>', quote: '<script>alert(1)</script>', rating: 8 });
  ctx.config.googleReviewsUrl = 'javascript:alert(1)';
  ctx.config.googleReviewsSnapshot.count = -1;
  ctx.renderTestimonials();
  const html = $('#testimonials-grid').innerHTML;
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script|javascript:|class="review-stars"/);
  assert.equal($('#google-rating-summary').hidden, true);
  assert.equal($('#google-rating-date').hidden, true);
});
test('review stars reject missing, non-numeric and out-of-range ratings', () => {
  const { ctx } = fixture();
  for (const bad of [undefined, null, '5', NaN, 0, -1, 6]) assert.equal(ctx.renderStars(bad), '');
  assert.equal(ctx.renderStars(5), '★★★★★');
});
