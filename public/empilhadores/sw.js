'use strict';
const CACHE="selene-empilhadores-2.1.1",ASSETS=["/empilhadores/icon.svg", "/empilhadores/assets/admin-actions.js", "/empilhadores/assets/app.bundle.css", "/empilhadores/assets/app.bundle.js", "/empilhadores/assets/checklist-code.css", "/empilhadores/assets/checklist-code.js", "/empilhadores/assets/operation-focus.css", "/empilhadores/assets/operation-focus.js", "/shared/api.js", "/shared/production.css", "/shared/pwa.js", "/empilhadores/offline.html"];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith("selene-empilhadores-")&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);if(url.origin!==self.location.origin||event.request.method!=='GET')return;
  // Never cache API calls, sessions, exported reports or authenticated payloads.
  if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/auth/'))return;
  if(event.request.mode==='navigate'){event.respondWith(fetch(event.request).catch(()=>caches.match("/empilhadores/offline.html")));return;}
  if(ASSETS.includes(url.pathname))event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}return response;}).catch(()=>caches.match(event.request)));
});
