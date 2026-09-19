
(function(){
 const defaults={brandName:"MACHI ORDER",storeName:"長浜店",accent:"#171717",radius:"20px",density:"comfortable"};
 const cfg={...defaults,...JSON.parse(localStorage.getItem("mo_ui_config")||"{}")};
 document.documentElement.style.setProperty("--mo-accent",cfg.accent);
 document.documentElement.style.setProperty("--mo-radius",cfg.radius);
 document.documentElement.dataset.density=cfg.density;
 window.MACHI_UI={get:()=>({...cfg}),set:(patch)=>{const n={...cfg,...patch};localStorage.setItem("mo_ui_config",JSON.stringify(n));location.reload()},reset:()=>{localStorage.removeItem("mo_ui_config");location.reload()}};
})();
