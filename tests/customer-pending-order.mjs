import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
for(const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
const source=html.slice(html.indexOf('    function pendingOrder()'),html.indexOf('    function closeModal()'));
const item=(id,quantity,option_ids=[])=>({product_id:id,quantity,option_ids,name:'油そば',option_names:[]});
function setup(receivedCart=[item(1,2),item(2,1)],submitted=[item(1,1)]) {
 const saved=new Map([['pending',JSON.stringify({request_id:'test',items:submitted})],['cart',JSON.stringify(receivedCart)]]);
 const nodes=new Map();let cartOpened=0,alerts=[];
 const ctx={pendingKey:'pending',cartKey:'cart',sending:false,cart:receivedCart,localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},restoreCart:()=>JSON.parse(saved.get('cart')),confirm:()=>true,alert:s=>alerts.push(s),$:id=>{if(!nodes.has(id))nodes.set(id,{remove(){}});return nodes.get(id)},updateCart(){},closeModal(){},showCart(){cartOpened++;}};
 vm.createContext(ctx);vm.runInContext(source,ctx);return {ctx,saved,alerts,cartOpened:()=>cartOpened};
}
let t=setup();t.ctx.resolvePendingOrder(true);assert.deepEqual(JSON.parse(t.saved.get('cart')).map(i=>[i.product_id,i.quantity]),[[1,1],[2,1]]);assert.equal(t.saved.has('pending'),false);
t=setup();t.ctx.resolvePendingOrder(false);assert.equal(JSON.parse(t.saved.get('cart'))[0].quantity,2);assert.equal(t.saved.has('pending'),false);assert.equal(t.cartOpened(),1);
t=setup();t.ctx.confirm=()=>false;t.ctx.resolvePendingOrder(true);assert.equal(t.saved.has('pending'),true);
t=setup([item(1,1,[2])],[item(1,1,[3])]);t.ctx.resolvePendingOrder(true);assert.equal(t.saved.has('pending'),true);assert.equal(t.alerts.length,1);
t=setup();t.saved.set('pending','invalid');t.ctx.resolvePendingOrder(true);assert.equal(t.saved.get('pending'),'invalid');
t=setup();const input=[item(1,1,[3,2]),item(1,2,[2,3]),item(1,1,[4])];const next=t.ctx.cartAfterReceived(input,[item(1,2,[2,3])]);assert.equal(next.length,2);assert.equal(next[0].quantity,1);assert.equal(input[0].quantity,1);
// Saved uncertainty blocks new network requests, including after a reload.
const orderSource=html.slice(html.indexOf('    async function order()'),html.indexOf('    function showSuccess('));
async function attempt(storageFailure=false) {
 let posts=0,warnings=0;
 const c={cart:[item(1,1)],sending:false,orderingMessage:()=>'',testMode:false,navigator:{onLine:true},localStorage:{getItem:()=>storageFailure?null:'pending',setItem(){throw Error('storage')}},pendingKey:'pending',showPendingWarning:()=>warnings++,confirm:()=>true,orderDestination:()=> '店／席',Machi:{createId:()=> 'test',api:()=>posts++},alert(){}};
 vm.createContext(c);vm.runInContext(orderSource,c);await c.order();assert.equal(posts,0);assert.equal(c.sending,false);return warnings;
}
assert.equal(await attempt(),1);assert.equal(await attempt(true),0);
assert.doesNotMatch(source,/Machi\.api/);
console.log('PASS: received removes only submitted quantities/options; not-received preserves cart; cancellation/corruption/mismatch keeps lock; storage failure and saved uncertainty prevent sends; resolution never posts.');
