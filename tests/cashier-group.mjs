import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../cashier.html',import.meta.url),'utf8');
for(const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
const source=html.slice(html.indexOf('    function visibleHistory()'),html.indexOf('    toastAction.addEventListener'));
const order=(id,group,total,seat='3番席')=>({id,check_group_id:group,total,paid_at:new Date().toISOString(),payment_method:'cash',dining_tables:{name:seat},order_items:[{product_name_snapshot:'油そば',quantity:1}],order_channel_code:'dine_in'});
const orders=[order(11,40,1000),order(12,40,400),order(13,41,900),order(14,null,300),order(15,null,200,'4番席')];
const search={value:''},filter={value:''},app={innerHTML:''},statusNode={textContent:''};
const c={orders,currentMode:'pending',loadedMode:'pending',busy:new Set(),historyTools:{classList:{toggle(){}}},
  document:{getElementById:id=>id==='history-search'?search:filter,querySelectorAll:()=>[]},
  app,statusNode,esc:x=>String(x),yen:x=>'¥'+x,paymentLabel:x=>x,paidTime:()=>'',
  takeoutInfo:()=>null,takeoutMeta:()=>'',displaySeat:o=>o.dining_tables.name,sourceClass:()=>'',sourceLabel:()=>'',
  withinUndo:()=>true,confirm:()=>true,alert:()=>{},showToast:()=>{},toast:{classList:{remove(){}}},
  load:async()=>{},apiPost:async()=>({ok:true,total:1400,order_count:2}),
  AbortController,setTimeout,clearTimeout};
vm.createContext(c);vm.runInContext(source,c);c.load=async()=>{};
assert.equal(c.checkoutCards(orders).length,4);
c.render();assert.match(statusNode.textContent,/4組・¥2800/);
assert.equal((app.innerHTML.match(/来店会計 · 注文2件/g)||[]).length,1);
assert.match(app.innerHTML,/data-group="40"/);assert.match(app.innerHTML,/data-group="41"/);
assert.match(app.innerHTML,/注文 #14/);assert.match(app.innerHTML,/4番席/);
assert.equal((app.innerHTML.match(/現金を受け取りました/g)||[]).length,4);
c.currentMode='history';c.loadedMode='history';search.value='12';
assert.equal(c.visibleHistory().length,2,'matching one order retains the whole group');
search.value='';filter.value='paypay';assert.equal(c.visibleHistory().length,0);
filter.value='';c.currentMode='pending';c.loadedMode='pending';
let resolve,submitted=[];
c.apiPost=body=>{submitted.push(body);return new Promise(r=>{resolve=r})};
const pending=c.payGroup(40,'cash');await c.payGroup(40,'paypay');
assert.equal(submitted.length,1);assert.equal(submitted[0].group_id,40);
assert.equal(submitted[0].expected_total,1400);
assert.deepEqual([...submitted[0].expected_order_ids],[11,12]);
resolve({ok:true,total:1400,order_count:2});await pending;
assert.equal(c.busy.size,0);
let undoSubmitted;
c.apiPost=async body=>{undoSubmitted=body;return{ok:true,external_refund_required:false}};
await c.undoGroup(40,{seat:'3番席',total:1400,method:'cash'});
assert.equal(undoSubmitted.action,'undo_group_payment');
assert.equal(c.currentMode,'pending');
console.log('PASS: same visit grouped, next visit and other table separate, history search preserves full group, one payment, double-click guard, group undo');
