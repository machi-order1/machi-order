const C='machi-order-v71-1';
const A=['/index.html','/order-entry.html','/staff-order.html','/launchpad.html','/store-command.html','/kitchen.html','/cashier.html','/today.html','/staff.html','/machi-app.js','/machi-design-system.css','/machi-ui-config.js','/manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil(caches.open(C).then(cache=>cache.addAll(A)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==C).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==location.origin||url.pathname.startsWith('/.netlify/')||url.pathname.includes('/functions/'))return;
  event.respondWith(fetch(event.request).then(response=>{
    if(!response.ok)return response;
    const copy=response.clone();
    caches.open(C).then(cache=>cache.put(event.request,copy));
    return response;
  }).catch(()=>caches.match(event.request)));
});
