
(function(){
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
