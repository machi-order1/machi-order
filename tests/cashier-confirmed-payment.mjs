import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const html = fs.readFileSync(new URL('../cashier.html', import.meta.url), 'utf8');
for (const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(m[1]);
const source = html.slice(html.indexOf('    async function load()'), html.indexOf('    toastAction.addEventListener'));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b}); return {promise,resolve,reject}; };
function setup() {
  const requests=[], messages=[], renders=[];
  const c={API:'https://example.test?store_id=1',currentMode:'pending',loadedMode:'pending',loadGeneration:0,
    busy:new Set(),orders:[{id:1,total:1000}],token:async()=>'token',
    statusNode:{textContent:''},app:{innerHTML:''},clearSession(){},location:{replace(){}},
    AbortController,setTimeout,clearTimeout,confirm:()=>true,alert:message=>messages.push([message]),
    yen:n=>'¥'+n,displaySeat:()=> '3番席',paymentLabel:m=>m==='paypay'?'PayPay':'現金',
    showToast:(...args)=>messages.push(args),render:()=>renders.push(c.orders),
    fetch:(url,opts)=>{const d=deferred();requests.push({url,opts,...d});return d.promise},
    toast:{classList:{remove(){}}},document:{querySelectorAll:()=>[]}};
  vm.createContext(c);vm.runInContext(source,c);
  return {c,requests,messages,renders};
}
const response = orders => ({ok:true,status:200,json:async()=>({orders})});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
// An old pending response must never become the history list after a tab switch.
let t=setup();const old=t.c.load();await tick();t.c.currentMode='history';const next=t.c.load();await tick();
t.requests[1].resolve(response([{id:2}]));await next;t.requests[0].resolve(response([{id:1}]));await old;
assert.equal(t.c.orders[0].id,2);assert.equal(t.c.loadedMode,'history');assert.equal(t.renders.length,1);
// Same-mode overlapping refreshes retain the latest response; old 401s do not sign out.
t=setup();let a=t.c.load();await tick();let b=t.c.load();await tick();
t.requests[1].resolve(response([{id:3}]));await b;t.requests[0].resolve({status:401,json:async()=>({})});await a;
assert.equal(t.c.orders[0].id,3);assert.equal(t.renders.length,1);
// A failed read disables payment of the stale data; recovery restores it.
t=setup();a=t.c.load();await tick();t.requests[0].reject(Error('offline'));await a;
assert.equal(t.c.loadedMode,null);await t.c.pay(1,'cash');assert.equal(t.requests.length,1);
b=t.c.load();await tick();t.requests[1].resolve(response([{id:1,total:1000}]));await b;assert.equal(t.c.loadedMode,'pending');
// Already-paid replies use the recorded method and offer no undo of the other payment.
t=setup();let posts=0;t.c.apiPost=async()=>{posts++;return {already_paid:true,total:1200,payment_method:'paypay'}};
t.c.load=async()=>{};await t.c.pay(1,'cash');assert.equal(posts,1);
assert.match(t.messages[0][0],/¥1200.*PayPay/);assert.equal(t.messages[0].length,1);assert.equal(t.c.busy.size,0);
// A normal success still offers undo; rapid repeated clicks send once.
t=setup();const payment=deferred();t.c.apiPost=()=>{posts++;return payment.promise};t.c.load=async()=>{};posts=0;
a=t.c.pay(1,'cash');await t.c.pay(1,'paypay');assert.equal(posts,1);
payment.resolve({ok:true});await a;assert.equal(typeof t.messages[0][1],'function');
// A missing order cannot submit a zero-value payment or an undo request.
t=setup();t.c.apiPost=async()=>{throw Error('must not submit')};await t.c.pay(999,'cash');
t.c.currentMode='history';t.c.loadedMode='history';await t.c.undoPayment(999);
// After mutation succeeds but refresh fails, finally must not resurrect stale pay buttons.
t=setup();t.c.apiPost=async()=>({ok:true});t.c.load=async()=>{t.c.loadedMode=null;t.c.app.innerHTML='offline'};
await t.c.pay(1,'cash');assert.equal(t.renders.length,1);assert.equal(t.c.app.innerHTML,'offline');
const api=fs.readFileSync(new URL('../supabase/functions/cashier-api/index.ts',import.meta.url),'utf8');
assert.ok(api.indexOf('if (data?.already_paid) return json(data)') < api.indexOf("action: 'payment_completed'"));
console.log('PASS: stale responses, failed-read lock/recovery, already-paid method/no undo, double click, missing order, failed refresh after save, replay audit guard');
