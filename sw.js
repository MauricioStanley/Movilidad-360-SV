/* Atomic offline shell. An update waits for explicit user activation. */
const CACHE_NAME = 'movilidad360-shell-v36';
const SHELL_FILES = ['/', '/cotizar/', '/flota/', '/ayuda/', '/nosotros/', '/trabaja-con-nosotros/', '/404.html',
 '/css/styles.css?v=36','/css/preview.css?v=36','/css/pages.css?v=36',
 '/js/core.js?v=36','/js/planner.js?v=36','/js/request-options.js?v=36','/js/geo.js?v=36','/js/ui.js?v=36','/js/data.js?v=36','/js/app.js?v=36',
 '/js/enhance.js?v=36','/js/site.js?v=36','/js/ga.js?v=36','/js/year.js?v=36'];
self.addEventListener('install', event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(SHELL_FILES)));
});
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE_UPDATE')self.skipWaiting();});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('movilidad360-')&&k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const request=event.request, url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin)return;
  if(request.headers.has('range')||url.pathname.startsWith('/video/')||url.pathname.startsWith('/img/'))return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request,{cache:'no-cache'}).catch(async()=>{
      const cache=await caches.open(CACHE_NAME);
      return await cache.match(url.pathname)||await cache.match('/404.html')||new Response('Sin conexión',{status:503});
    }));return;
  }
  if(SHELL_FILES.includes(url.pathname+url.search)){
    event.respondWith(caches.open(CACHE_NAME).then(async cache=>await cache.match(request)||fetch(request)));
  }
});
