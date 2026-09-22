import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
for (const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
const source = html.slice(html.indexOf('    const snackNoticeKey'), html.indexOf('    let addedNoticeTimer;'));
function setup({ seen = false, items = [{ product_id: 30, quantity: 1 }], history = [], sold = false, blocked = false, storageFails = false } = {}) {
  const ctx = {seatToken:'test-seat',orderChannel:'qr', quantity:1, cart:items, refillHistory:history,
    data:{products:[{id:30,category_id:5}, {id:9,category_id:3}, {id:15,category_id:3}, {id:25,category_id:3,price:600,sale_status:sold?'sold_out':'available'}, {id:21,category_id:3,price:300,sale_status:'available'}]},
    isTopping:p=>p.id===9, orderingMessage:()=>blocked?'stopped':'',
    sessionStorage:{getItem:()=>{if(storageFails)throw Error();return seen?'1':null;}, setItem:()=>{if(storageFails)throw Error();}}
  };vm.createContext(ctx);vm.runInContext(source,ctx);return ctx;
}
const alcohol={category_id:5};
let c=setup();assert.deepEqual(Array.from(c.firstDrinkSnacks(alcohol),p=>p.id),[25,21]);assert.equal(c.firstDrinkSnacks(alcohol).length,0);
for (const config of [{seen:true},{items:[{product_id:30,quantity:1},{product_id:21,quantity:1}]},{items:[{product_id:30,quantity:2}]},{history:[{category_id:5}]},{blocked:true}])assert.equal(setup(config).firstDrinkSnacks(alcohol).length,0);
c=setup();assert.equal(c.firstDrinkSnacks({category_id:6}).length,0);assert.equal(c.firstDrinkSnacks(alcohol).length,2);
assert.deepEqual(Array.from(setup({sold:true}).firstDrinkSnacks(alcohol),p=>p.id),[21]);
c=setup({storageFails:true});assert.equal(c.firstDrinkSnacks(alcohol).length,2);assert.equal(c.firstDrinkSnacks(alcohol).length,0);
assert.equal(setup({items:[{product_id:30,quantity:1},{product_id:9,quantity:1}]}).firstDrinkSnacks(alcohol).length,2);
console.log('PASS: first alcohol only; existing snack/alcohol/history suppression; sold-out filtering; topping exclusion; storage failure fallback; syntax');
