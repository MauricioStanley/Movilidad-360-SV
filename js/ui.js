(function (root) {
  'use strict';
  const dialogs = new Map();
  let active = null, returnFocus = null, previousOverflow = '', inerted = [];
  const focusable = 'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]';
  function visibleControls(el) { return [...el.querySelectorAll(focusable)].filter(e=>e.getClientRects().length && !e.closest('[hidden],[inert]')); }
  function register(id, onClose) { dialogs.set(id, onClose); }
  function close(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('open'); el.hidden = true;
    if (active !== el) return;
    inerted.forEach(([node, was])=>{node.inert = was;}); inerted = [];
    document.body.style.overflow = previousOverflow;
    active = null;
    if (returnFocus?.isConnected && !returnFocus.closest('[hidden],[inert]')) returnFocus.focus();
    returnFocus = null;
  }
  function open(id) {
    const el = document.getElementById(id);
    if (!el) return;
    if (active && active !== el) (dialogs.get(active.id) || (()=>close(active.id)))();
    if (active !== el) {
      returnFocus = document.activeElement; previousOverflow = document.body.style.overflow;
      inerted = [...document.body.children].filter(n=>n!==el && !n.contains(el) && !['SCRIPT','LINK'].includes(n.tagName)).map(n=>[n,n.inert]);
      inerted.forEach(([n])=>{n.inert = true;});
    }
    active = el; el.hidden = false; el.classList.add('open'); document.body.style.overflow = 'hidden';
    const heading = el.querySelector('h2,h3,h4');
    if (heading) { heading.tabIndex = -1; heading.focus(); }
    else visibleControls(el)[0]?.focus();
  }
  document.addEventListener('keydown', e=>{
    if (!active) return;
    if (e.key === 'Escape') { e.preventDefault(); (dialogs.get(active.id) || (()=>close(active.id)))(); return; }
    if (e.key !== 'Tab') return;
    const controls = visibleControls(active);
    if (!controls.length) { e.preventDefault(); return; }
    const first = controls[0], last = controls.at(-1);
    if (e.shiftKey && (document.activeElement===first || !controls.includes(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement===last || !active.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  });
  root.M360UI = { register, open, close };
})(globalThis);
