import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { stripTypeScriptTypes } from 'node:module'

const apiSource = readFileSync(new URL('../supabase/functions/pl-api/index.ts', import.meta.url), 'utf8')
const script = stripTypeScriptTypes(apiSource.replace(/^import .*\n/, ''), { mode: 'strip' }) + '\nglobalThis.testSales = { summarizeSales, handler: globalThis.handler };'
let handler
const requests = []
const rows = [
  { id: 1, business_date: '2026-10-05', business_period_id: 1, total: 1200, payment_status: 'paid', payment_method: 'cash', status: 'served', guest_count: 2, order_channel_code: 'dine_in', check_group_id: 8, order_items: [] },
  { id: 2, business_date: '2026-10-06', business_period_id: 2, total: 800, payment_status: 'paid', payment_method: 'paypay', status: 'served', guest_count: 1, order_channel_code: 'dine_in', check_group_id: 9, order_items: [] },
  { id: 3, business_date: '2026-10-06', business_period_id: 2, total: 900, payment_status: 'unpaid', payment_method: null, status: 'new', guest_count: 1, order_channel_code: 'dine_in', check_group_id: null, order_items: [] },
  { id: 4, business_date: '2026-10-12', business_period_id: 2, total: 500, payment_status: 'paid', payment_method: 'cash', status: 'served', guest_count: 1, order_channel_code: 'dine_in', check_group_id: null, order_items: [] },
]
const query = (table) => {
  const state = { start: '', end: '' }
  const builder = {
    select: () => builder, eq: () => builder, neq: () => builder, gt: () => builder,
    gte: (field, value) => { if (field === 'business_date') state.start = value; return builder },
    lt: (field, value) => { if (field === 'business_date') state.end = value; return builder },
    order: () => builder, in: () => builder,
    range: (from, to) => { requests.push({ table, from, to, ...state }); return Promise.resolve({ data: rows.filter(r => r.business_date >= state.start && r.business_date < state.end).slice(from, to + 1) }) },
    single: async () => ({ data: { timezone: 'Asia/Tokyo', brand_id: 1 } }),
    maybeSingle: async () => ({ data: { role: 'owner' } }),
    then: (resolve, reject) => Promise.resolve({ data: table === 'business_periods' ? [{ id: 1, name: '昼営業' }, { id: 2, name: '夜営業' }] : [], count: 0 }).then(resolve, reject),
  }
  return builder
}
const context = {
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'test-user' } } }) }, from: query }),
  Deno: { env: { get: () => 'test-value' }, serve: fn => { handler = fn } },
  Response, URL, Date, Intl, console,
}
vm.runInNewContext(script, context)
const summary = context.testSales.summarizeSales(rows.filter(r => r.payment_status === 'paid').slice(0, 2), [])
assert.equal(summary.sales, 2000)
assert.equal(summary.cash_sales, 1200)
assert.equal(summary.paypay_sales, 800)
assert.equal(summary.guest_count, 3)

async function get(path) {
  const response = await handler(new Request('https://example.com/' + path, { headers: { Authorization: 'Bearer test' } }))
  return { status: response.status, data: await response.json() }
}
let result = await get('?store_id=1&week=2026-10-07')
assert.equal(result.status, 200)
assert.equal(result.data.from, '2026-10-05')
assert.equal(result.data.to_exclusive, '2026-10-12')
assert.equal(result.data.sales, 2000)
assert.equal(result.data.slots.lunch.sales, 1200)
assert.equal(result.data.slots.dinner.sales, 800)
assert.equal(result.data.daily_sales.length, 2)
assert.deepEqual([requests[0].start, requests[0].end], ['2026-10-05', '2026-10-12'])
result = await get('?store_id=1&month=2026-10')
assert.equal(result.data.sales, 2500)
result = await get('?store_id=1&date=2026-10-06')
assert.equal(result.data.sales, 800)
result = await get('?store_id=1&date=2026-10-06&week=2026-10-07')
assert.equal(result.status, 400)

for (const file of ['cashier.html', 'sales-report.html']) {
  const html = readFileSync(new URL('../' + file, import.meta.url), 'utf8')
  const source = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
  assert.ok(source, `${file}: inline script`)
  new vm.Script(source, { filename: file })
}
console.log('Store operations sales tests passed')
