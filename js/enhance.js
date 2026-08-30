/* =========================================================================
   MOVILIDAD 360 SV — enhance.js
   Capa de movimiento y pulido, 100% aditiva. No toca la lógica de
   cotización. Si este archivo no carga, el sitio queda idéntico y estático.

   Se desactiva por completo cuando el usuario pide menos movimiento
   (prefers-reduced-motion: reduce): no se añade la clase .js-motion, así
   que ningún elemento se oculta a la espera de animarse.
   ========================================================================= */
(function () {
  "use strict";

  var reduceMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var root = document.documentElement;

  /* ---- Header: elevación al hacer scroll (siempre, es un estado, no motion) */
  function wireHeaderElevation() {
    var header = document.querySelector(".site-header");
    if (!header) return;
    var onScroll = function () {
      header.classList.toggle("scrolled", window.scrollY > 8);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* ---- Contador de viajes: sube una sola vez al entrar en vista ---- */
  function wireStatCountUp() {
    var stats = document.querySelectorAll(".hero-stat b");
    if (!stats.length) return;

    function animateNumber(el) {
      var raw = el.textContent.trim();
      var m = raw.match(/^(\D*)(\d[\d,.]*)(\D*)$/);
      if (!m) return;
      var prefix = m[1];
      var suffix = m[3];
      var target = parseInt(m[2].replace(/[.,]/g, ""), 10);
      if (!isFinite(target) || target < 2) return;
      if (reduceMotion) {
        return;
      }
      var start = null;
      var dur = 1100;
      function frame(t) {
        if (start === null) start = t;
        var p = Math.min((t - start) / dur, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = prefix + Math.round(target * eased).toLocaleString("es") + suffix;
        if (p < 1) requestAnimationFrame(frame);
        else el.textContent = raw;
      }
      requestAnimationFrame(frame);
    }

    if (!("IntersectionObserver" in window)) return;
    var obs = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            animateNumber(e.target);
            obs.unobserve(e.target);
          }
        });
      },
      { threshold: 0.6 }
    );
    stats.forEach(function (el) {
      obs.observe(el);
    });
  }

  /* ---- Rejillas con entrada escalonada (flota + guías) ---- */
  function wireGridReveals() {
    var grids = document.querySelectorAll(".vehicles-grid, .guides-grid, .drivers-grid");
    if (!grids.length || !("IntersectionObserver" in window)) return;

    var obs = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            obs.unobserve(e.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
    );

    grids.forEach(function (grid) {
      grid.classList.add("reveal-grid");
      var kids = grid.children;
      for (var i = 0; i < kids.length; i++) {
        kids[i].style.setProperty("--i", i % 8);
      }
      obs.observe(grid);
    });
  }

  /* ---- Red de seguridad: ninguna .stop debe quedarse invisible ---- */
  function wireStopSafetyNet() {
    var stops = document.querySelectorAll("[data-stop]");
    if (!stops.length) return;

    if ("IntersectionObserver" in window) {
      var obs = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (e) {
            if (e.isIntersecting) {
              e.target.classList.add("in-view");
              obs.unobserve(e.target);
            }
          });
        },
        { threshold: 0.04, rootMargin: "0px 0px -8% 0px" }
      );
      stops.forEach(function (s) {
        obs.observe(s);
      });
    }

    // Último recurso: si algo falla, mostrar todo tras cargar del todo.
    window.addEventListener("load", function () {
      setTimeout(function () {
        stops.forEach(function (s) {
          s.classList.add("in-view");
        });
      }, 2000);
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    wireHeaderElevation();

    if (!reduceMotion) {
      root.classList.add("js-motion");
      wireStatCountUp();
      wireGridReveals();
      wireStopSafetyNet();
    }
  });
})();
