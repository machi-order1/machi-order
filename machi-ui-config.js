
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
});
