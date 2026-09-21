
(function(){
 const isKitchen=location.pathname==='/kitchen.html'||location.pathname==='/kitchen';
 const isCashier=location.pathname==='/cashier.html'||location.pathname==='/cashier';
 const params=new URLSearchParams(location.search),storeKey=isKitchen?params.get('store'):null;
 const requestedStoreId=storeKey==='shirakibaru'?2:Number(params.get('store_id')||localStorage.getItem('machi_store_id')||1);
 const storeId=[1,2].includes(requestedStoreId)?requestedStoreId:1;
 localStorage.setItem('machi_store_id',String(storeId));
 window.MACHI_STORE_ID=storeId;
 const nativeFetch=window.fetch.bind(window);
 const authUrl='https://tejglrlkaqolbghoagqj.supabase.co/auth/v1/token?grant_type=refresh_token';
 const publishableKey='sb_publishable_beZla85Y6Ngrx0hji9I9rg_FbcRSUoT';
 let refreshPromise=null;
 const refreshSession=()=>{
  if(refreshPromise)return refreshPromise;
  const refreshToken=localStorage.getItem('machi_refresh_token')||'';
  if(!refreshToken)return Promise.resolve('');
  refreshPromise=nativeFetch(authUrl,{method:'POST',headers:{apikey:publishableKey,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:refreshToken})}).then(async response=>{
   const data=await response.json().catch(()=>({}));
   if(!response.ok||!data.access_token){['machi_access_token','mo_staff_token','access_token','sb_access_token','machi_refresh_token','machi_token_expires_at'].forEach(key=>localStorage.removeItem(key));return''}
   localStorage.setItem('machi_access_token',data.access_token);localStorage.setItem('mo_staff_token',data.access_token);
   if(data.refresh_token)localStorage.setItem('machi_refresh_token',data.refresh_token);
   localStorage.setItem('machi_token_expires_at',String(Date.now()+Math.max(60,Number(data.expires_in)||3600)*1000));
   return data.access_token;
  }).catch(()=>'').finally(()=>{refreshPromise=null});
  return refreshPromise;
 };
 window.fetch=async(input,init)=>{
  const raw=typeof input==='string'?input:input?.url||'';
  if(storeId===2&&raw.includes('/functions/v1/')&&raw.includes('store_id=1')){
   const changed=raw.replace(/([?&])store_id=1(?=&|$)/,'$1store_id=2');
   input=typeof input==='string'?changed:new Request(changed,input);
  }
  const retryInput=input instanceof Request?input.clone():input;
  const response=await nativeFetch(input,init);
  if(response.status!==401||raw.includes('/auth/v1/token'))return response;
  const accessToken=await refreshSession();
  if(!accessToken)return response;
  const retryHeaders=new Headers(input instanceof Request?input.headers:init?.headers||{});retryHeaders.set('Authorization','Bearer '+accessToken);
  return nativeFetch(retryInput,{...init,headers:retryHeaders});
 };
 const storePages=new Set(['manager.html','store-command.html','product-admin.html','opening-check.html','closing.html','today.html','operation-log.html','system-check.html','inventory.html','prep.html','hygiene.html','cashier.html','kitchen.html','staff-order.html','staff.html','time-clock.html','my-shifts.html','shift-request.html','shift-builder.html','shift-collection.html','emergency-cover.html','notifications.html','labor-dashboard.html','daily-profit.html','cost-editor.html','staff-meal.html','point-approval.html','reminder-settings.html','takeout-settings.html']);
 const propagateStoreLinks=()=>document.querySelectorAll('a[href]').forEach(link=>{try{const url=new URL(link.getAttribute('href'),location.href),page=url.pathname.split('/').pop();if(url.origin===location.origin&&storePages.has(page)){url.searchParams.set('store_id',String(storeId));link.href=url.pathname+url.search+url.hash}}catch{}});
 document.addEventListener('DOMContentLoaded',()=>setTimeout(propagateStoreLinks,0));
 if(storeId===2&&(isKitchen||isCashier)){
  const manifest=document.querySelector('link[rel="manifest"]');
  if(manifest)manifest.href='/kitchen-shirakibaru.webmanifest';
  document.title=isKitchen?'白木原店 厨房｜MACHI ORDER':'白木原店 会計｜MACHI ORDER';
  document.addEventListener('DOMContentLoaded',()=>{
   const heading=document.querySelector('.head h1');if(heading)heading.textContent=isKitchen?'白木原店 厨房':'白木原店 会計';
   const brand=document.querySelector('.brand');if(brand)brand.textContent='MACHI ORDER · 白木原店';
   document.querySelectorAll('a[href="/kitchen.html"]').forEach(link=>link.href='/kitchen.html?store=shirakibaru');
   document.querySelectorAll('a[href="/cashier.html"]').forEach(link=>link.href='/cashier.html?store_id=2');
   const app=document.getElementById('app');
   if(app)new MutationObserver(()=>document.querySelectorAll('a[href^="/login.html?next="]').forEach(link=>link.href='/login.html?next='+encodeURIComponent(isKitchen?'/kitchen.html?store=shirakibaru':'/cashier.html?store_id=2'))).observe(app,{childList:true,subtree:true});
  });
 }
 const defaults={brandName:"MACHI ORDER",storeName:"長浜店",accent:"#171717",radius:"20px",density:"comfortable"};
 const cfg={...defaults,...JSON.parse(localStorage.getItem("mo_ui_config")||"{}")};
 document.documentElement.style.setProperty("--mo-accent",cfg.accent);
 document.documentElement.style.setProperty("--mo-radius",cfg.radius);
 document.documentElement.dataset.density=cfg.density;
 window.MACHI_UI={get:()=>({...cfg}),set:(patch)=>{const n={...cfg,...patch};localStorage.setItem("mo_ui_config",JSON.stringify(n));location.reload()},reset:()=>{localStorage.removeItem("mo_ui_config");location.reload()}};
})();

document.addEventListener('DOMContentLoaded',()=>{
 if(location.pathname!=='/store-command.html'&&location.pathname!=='/store-command')return;
 const grid=document.querySelector('.grid'),inventory=grid?.querySelector('a[href="/inventory.html"]');
 if(!grid||!inventory||grid.querySelector('a[href="/product-admin.html"]'))return;
 const link=document.createElement('a');
 link.className='tile';link.href='/product-admin.html';
 link.innerHTML='<div class="ico">🏷️</div><b>商品・売切</b><span>販売中・売切・停止</span>';
 grid.insertBefore(link,inventory);
 const open=document.createElement('a');
 open.className='tile';open.href='/opening-check.html';
 open.innerHTML='<div class="ico">✅</div><b>営業前チェック</b><span>QR・厨房・会計・通知音</span>';
 grid.insertBefore(open,inventory);
 const oral=document.createElement('a');
 oral.className='tile';oral.href='/staff-order.html?store_id=1';
 oral.innerHTML='<div class="ico">＋</div><b>口頭注文</b><span>席を選んで代理入力</span>';
 grid.insertBefore(oral,inventory);
 const system=document.createElement('a');
 system.className='tile';system.href='/system-check.html';
 system.innerHTML='<div class="ico">🛟</div><b>システム確認</b><span>通信・ログイン・復旧</span>';
 grid.appendChild(system);
});

document.addEventListener('DOMContentLoaded',()=>{
 const isKitchen=location.pathname==='/kitchen.html'||location.pathname==='/kitchen';
 if(!isKitchen)return;
 const kitchenParams=new URLSearchParams(location.search),white=kitchenParams.get('store')==='shirakibaru'||kitchenParams.get('store_id')==='2',head=document.querySelector('.headside');
 if(!head||head.querySelector('.oral-order-link'))return;
 const link=document.createElement('a');link.className='device-test oral-order-link';
 link.style.textDecoration='none';link.href='/staff-order.html?store_id='+(white?'2':'1');link.textContent='＋ 口頭注文';
 head.insertBefore(link,head.firstChild);
});

document.addEventListener('DOMContentLoaded',()=>{
 if(location.pathname!=='/kitchen.html'&&location.pathname!=='/kitchen')return;
 const style=document.createElement('style');
 style.textContent='.card.warn{border:2px solid #e99a00}.card.urgent{box-shadow:0 0 0 4px #e51b2322}.card.urgent .age{background:#e51b23;color:#fff}.card.warn:not(.urgent) .age{background:#fff0c8;color:#8a5300}.opts{margin-top:7px!important;padding:7px 9px;background:#fff0c8;border-left:4px solid #e99a00;border-radius:7px;color:#3f2d00!important;font-size:14px!important;font-weight:900}.kitchen-legend{font-size:12px;color:#6f665f;margin:0 0 11px;padding:10px 12px;background:#fff;border-radius:12px}.kitchen-legend b{color:#e51b23}';
 document.head.appendChild(style);
 const app=document.getElementById('app');let lastNew=0;
 const enhance=()=>{
  const count=Number(document.getElementById('nnew')?.textContent||0);
  document.title=count?`(${count}) 新規注文｜厨房`:'厨房｜MACHI ORDER';
  if(count>lastNew&&lastNew>=0)navigator.vibrate?.([180,90,180]);lastNew=count;
  document.querySelectorAll('.card').forEach(card=>{const mins=Number(card.querySelector('.age')?.textContent.replace(/\D/g,'')||0);card.classList.toggle('warn',mins>=5)});
  const grid=app?.querySelector('.grid');if(grid&&!app.querySelector('.kitchen-legend'))grid.insertAdjacentHTML('afterbegin','<div class="kitchen-legend" style="grid-column:1/-1"><b>赤：10分以上</b>　黄：5分以上　黄色枠：麺量・トッピング</div>');
 };
 if(app)new MutationObserver(enhance).observe(app,{childList:true,subtree:true});enhance();
});

document.addEventListener('DOMContentLoaded',()=>{
 if(location.pathname!=='/staff.html'&&location.pathname!=='/staff')return;
 const grid=document.querySelector('.grid'),shift=grid?.querySelector('a[href="/my-shifts.html"]');
 if(!grid||!shift||grid.querySelector('a[href="/time-clock.html"]'))return;
 const link=document.createElement('a');
 link.className='mo-card tile';link.href='/time-clock.html';
 link.innerHTML='<i>⏱</i><b>勤怠打刻</b><small>出勤・休憩・退勤</small>';
 grid.insertBefore(link,shift);
});
