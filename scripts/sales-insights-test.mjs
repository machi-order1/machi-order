import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { stripTypeScriptTypes } from 'node:module'

const html = readFileSync(new URL('../sales-insights.html', import.meta.url), 'utf8')
new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)?.[1] || '', { filename: 'sales-insights.html' })
assert.match(html, /セット付帯率/)
assert.match(html, /未記録/)
assert.match(html, /システム導入前の売上は含みません/)
assert.match(html, /一人あたり客単価/)
assert.match(html, /全商品ごとの販売数/)

const sql = readFileSync(new URL('../supabase/migrations/20261029071134_management_sales_mix.sql', import.meta.url), 'utf8')
assert.match(sql, /payment_status = 'paid'/)
assert.match(sql, /status <> 'cancelled'/)
assert.match(sql, /revoke all on function public.management_sales_mix.*from public, anon, authenticated/)
assert.match(sql, /grant execute on function public.management_sales_mix.*to service_role/)
assert.match(sql, /sum\(i.quantity\) cups/)
assert.match(sql, /max\(greatest\(coalesce\(guest_count,1\),1\)\) guests/)
assert.match(sql, /'all_products'/)
assert.match(sql, /'average_per_guest'/)

const source = readFileSync(new URL('../supabase/functions/sales-insights-api/index.ts', import.meta.url), 'utf8')
let handler
const calls = []
const query = table => {
  const q = {
    select: () => q, eq: () => q, neq: () => q, lte: () => q, order: () => q, limit: () => q,
    maybeSingle: async () => ({ data: table === 'orders' ? { business_date: '2026-09-15' } : { role: 'manager' } }),
    single: async () => ({ data: { timezone: 'Asia/Tokyo', name: '長浜店' } }),
  }
  return q
}
const client = { auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) },
  from: query, rpc: async (name, params) => { calls.push({ name, ...params }); return { data: { sales: { amount: 1200, orders: 1, guests: 2, average_per_guest: 600 }, slots: [] } } } }
const context = {
  createClient: () => client,
  Deno: { env: { get: () => 'test-value' }, serve: callback => { handler = callback } },
  Response, URL, Date, Intl, console,
}
vm.runInNewContext(stripTypeScriptTypes(source.replace(/^import .*\n/, ''), { mode: 'strip' }), context)
const get = async range => {
  const res = await handler(new Request('https://example.com/?store_id=1&range=' + range, { headers: { Authorization: 'Bearer test' } }))
  return { status: res.status, body: await res.json() }
}
const all = await get('all')
assert.equal(all.status, 200)
assert.equal(all.body.from, '2026-09-15')
assert.equal(all.body.first_recorded_sale, '2026-09-15')
assert.equal(all.body.sales.average_per_guest, 600)
assert.equal(calls.at(-1).name, 'management_sales_mix')
for (const range of ['today','yesterday','this_week','three_months_ago','three_months','six_months','year']) {
  const res = await get(range)
  assert.equal(res.status, 200)
  assert.match(res.body.from, /^\d{4}-\d{2}-\d{2}$/)
}
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
assert.equal((await get('today')).body.from, today)
assert.equal((await get('yesterday')).body.to_exclusive, today)
assert.equal((await get('three_months_ago')).body.from.slice(8), '01')
assert.equal((await get('month&month=2026-09')).body.from, '2026-09-01')
assert.equal((await get('date&date=2026-09-15')).body.from, '2026-09-15')
assert.equal((await get('date&date=2026-02-30')).status, 400)
assert.equal((await get('invalid')).status, 400)
console.log('Sales insights tests passed')
