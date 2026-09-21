const C='machi-order-v71-33';
const A=[
  '/index.html','/login.html','/reset-password.html','/order-entry.html','/staff-order.html','/launchpad.html','/store-command.html','/product-admin.html','/opening-check.html','/closing.html','/inventory.html','/prep.html','/inventory-message-import.html','/inventory-text-parser.js','/operation-log.html','/system-check.html','/offline.html','/website-inquiries.html','/takeout-settings.html','/kitchen.html','/cashier.html','/today.html','/staff.html','/time-clock.html','/my-shifts.html','/shift-request.html',
  '/machi-app.js','/machi-design-system.css','/machi-ui-config.js','/manifest.webmanifest','/kitchen.webmanifest','/kitchen-shirakibaru.webmanifest','/kitchen-shirakibaru.html','/kitchen-apps.html',
  '/assets/brand/151-logo-white.webp',
  '/assets/menu-items/web/hakata-aburasoba.webp','/assets/menu-items/web/ebi-shio-aburasoba.webp','/assets/menu-items/web/iki-beef-hakata.webp','/assets/menu-items/web/iki-beef-ebi-shio.webp',
  '/assets/menu-items/web/chashu-hakata.webp','/assets/menu-items/web/chashu-ebi-shio.webp','/assets/menu-items/web/double-aburasoba.webp',
  '/assets/menu-items/web/extra-chashu.webp','/assets/menu-items/web/takana.webp','/assets/menu-items/web/spicy-takana.webp','/assets/menu-items/web/raw-egg.webp','/assets/menu-items/web/half-boiled-egg.webp','/assets/menu-items/web/iki-premium-beef.webp','/assets/menu-items/web/dashi.webp',
  '/assets/menu-items/web/set-a.webp','/assets/menu-items/web/set-b.webp','/assets/menu-items/web/set-c.webp','/assets/menu-items/web/set-d.webp','/assets/menu-items/web/set-e.webp',
  '/assets/menu-items/web/dumplings-3.webp','/assets/menu-items/web/dumplings-5.webp','/assets/menu-items/web/edamame.webp','/assets/menu-items/web/iriko-mayo.webp','/assets/menu-items/web/grilled-chashu.webp',
  '/assets/menu-items/web/chashu-don.webp','/assets/menu-items/web/soup-dumplings-3.webp','/assets/menu-items/web/soup-dumplings-5.webp',
  '/assets/menu-items/web/beer.webp','/assets/menu-items/web/highball.webp','/assets/menu-items/web/lemon-sour.webp','/assets/menu-items/web/shochu.webp',
  '/assets/menu-items/web/cola.webp','/assets/menu-items/web/ginger-ale.webp','/assets/menu-items/web/orange-juice.webp','/assets/menu-items/web/calpis.webp','/assets/menu-items/web/oolong-tea.webp'
];
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
  }).catch(async()=>{
    const cached=await caches.match(event.request);
    if(cached)return cached;
    if(event.request.mode==='navigate')return caches.match('/offline.html');
    return new Response('',{status:503,statusText:'Offline'});
  }));
});
