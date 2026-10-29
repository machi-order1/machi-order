import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const seed = read('supabase/migrations/20260922070354_per_bowl_toppings.sql');
const order = read('supabase/migrations/20260921034500_fix_regular_price_fallback.sql');
const api = read('supabase/functions/kitchen-api/index.ts');
const ui = read('kitchen-tablet.js');
const css = read('kitchen-tablet.css');

for (const ingredient of ['白ネギ', '青ネギ', 'キクラゲ', '高菜']) {
  assert(seed.includes(`'${ingredient}'`), `${ingredient} has an omission option`);
}
assert(seed.includes("ingredient || '抜き'"));
assert(order.includes('option_name_snapshot'));
assert(api.includes('order_item_options(option_name_snapshot,price_delta)'));
assert(ui.includes('/抜き$/'), 'Only explicit omission option names receive the warning');
assert(ui.includes('item.product_name_snapshot} ×${item.quantity}'), 'Alert includes product and quantity');
assert(ui.includes('stopImmediatePropagation()'), 'Cancelled confirmation prevents cooking transition');
assert(css.includes('.omission-banner') && css.includes('.card.has-omission'));
console.log('Kitchen omission data path and confirmation: passed');
