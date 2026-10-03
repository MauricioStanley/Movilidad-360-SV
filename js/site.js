(function () {
  'use strict';
  document.addEventListener('DOMContentLoaded', () => {
    // Preserve links shared before sections were moved into dedicated pages.
    if (location.pathname === '/' || location.pathname === '/index.html') {
      const routes={'#paradas':'/cotizar/','#faq':'/ayuda/#faq','#nosotros':'/nosotros/','#trabaja-con-nosotros':'/trabaja-con-nosotros/'};
      const target=/^#stop-(movilizarte|aeropuerto|encomienda|departamento|turismo|mudanza|tarifafija)$/.test(location.hash)?'/cotizar/'+location.hash:routes[location.hash];
      if(target){location.replace(target);return;}
    }
    document.querySelectorAll('nav a').forEach(link => {
      if (new URL(link.href).pathname === location.pathname) link.setAttribute('aria-current','page');
    });
    const preference = document.getElementById('analyticsPreference');
    const status = document.getElementById('analyticsStatus');
    const refresh = () => {
      if (!preference) return;
      const allowed = window.M360Analytics?.allowed();
      preference.textContent = allowed ? 'Desactivar estadísticas' : 'Permitir estadísticas opcionales';
    };
    refresh();
    preference?.addEventListener('click', () => {
      const enable = !window.M360Analytics.allowed();
      window.M360Analytics.setAllowed(enable);
      status.textContent = enable ? 'Estadísticas activadas. No enviamos direcciones ni teléfonos en nuestros eventos.' : 'Estadísticas desactivadas.';
      refresh();
    });
    document.querySelectorAll('.mobile-menu').forEach(menu => menu.addEventListener('keydown', e => { if(e.key==='Escape') { menu.open=false; menu.querySelector('summary').focus(); } }));
  });
})();
