import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const kitchen = read('kitchen.html');
const kitchenTablet = read('kitchen-tablet.js');
const cashier = read('cashier.html');
const kitchenApi = read('supabase/functions/kitchen-api/index.ts');
const cashierApi = read('supabase/functions/cashier-api/index.ts');
const menuApi = read('supabase/functions/menu-api/index.ts');

for (const page of [kitchen, cashier]) {
  assert(page.includes("STORE_CODE==='shirakibaru'?2:1"), 'White store ID is 2');
  assert(page.includes("LOGIN_URL='/login.html?next='+encodeURIComponent"), 'Login returns to the same store');
  assert(!page.includes("?store_id=1',AUTH="), 'API target is not fixed to Nagahama');
}
assert(kitchenTablet.includes("cashierLink.href = '/cashier.html?store=shirakibaru'"));
assert(cashier.includes("href='/kitchen.html?store=shirakibaru'"));
assert(kitchenTablet.includes("homeLink.href = '/kitchen-apps.html'"));
assert(cashier.includes("homeLink.href='/kitchen-apps.html'"));
assert(kitchenTablet.includes("link.hidden = true"));
assert(cashier.includes("link.hidden=true"));
assert(kitchenApi.includes(".eq('store_id', storeId)"));
assert(cashierApi.includes(".eq('store_id', storeId)"));
assert(cashierApi.includes("sb.rpc('complete_order_payment'"));
assert(menuApi.includes(".eq('qr_token', token)"));
assert(menuApi.includes("p_client_order_key: requestId"));
console.log('Two-store QR → kitchen → cashier routing invariants: passed');
