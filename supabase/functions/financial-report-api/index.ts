import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type,apikey', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } })
type Month = { month: string; sales: number; order_count: number; guest_count: number; estimated_cogs: number; labor: number; expenses: number; waste: number; staff_consumption: number; channel_fees: number; expense_categories: Record<string, number>; expense_count: number; unknown_tax_count: number; missing_vendor_count: number; missing_evidence_count: number }
const n = (x: unknown) => Number(x || 0)
const monthKey = (s: string) => s.slice(0, 7)
function summarize(rows: Month[]) {
  const total = (key: keyof Month) => rows.reduce((sum, row) => sum + n(row[key]), 0)
  const categories: Record<string, number> = {}
  for (const row of rows) for (const [key, value] of Object.entries(row.expense_categories || {})) categories[key] = (categories[key] || 0) + n(value)
  const sales = total('sales'), cogs = total('estimated_cogs'), labor = total('labor'), expenses = total('expenses'), waste = total('waste'), staff = total('staff_consumption'), fees = total('channel_fees')
  const profit = sales - cogs - labor - expenses - waste - staff - fees
  return { sales, order_count: total('order_count'), guest_count: total('guest_count'), estimated_cogs: cogs, labor, expenses, waste, staff_consumption: staff, channel_fees: fees,
    estimated_gross_profit: sales - cogs, estimated_profit: profit, margin: sales ? Math.round(profit / sales * 1000) / 10 : 0,
    labor_ratio: sales ? Math.round(labor / sales * 1000) / 10 : 0, expense_categories: categories,
    expense_count: total('expense_count'), unknown_tax_count: total('unknown_tax_count'), missing_vendor_count: total('missing_vendor_count'), missing_evidence_count: total('missing_evidence_count') }
}
const csvCell = (value: unknown) => {
  const raw = String(value ?? '')
  // Prevent spreadsheet formula execution when a vendor or note begins with a formula prefix.
  const safe = /^[\s]*[=+\-@\t\r]/.test(raw) && !/^-?\d+(\.\d+)?$/.test(raw) ? `'${raw}` : raw
  return `"${safe.replaceAll('"', '""')}"`
}
async function paged(sb: any, table: string, select: string, storeId: number, dateColumn: string, start: string, end: string) {
  const rows: any[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.from(table).select(select).eq('store_id', storeId).gte(dateColumn, start).lt(dateColumn, end).order('id').range(offset, offset + 999)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < 1000) break
    if (offset >= 99000) throw Error('明細が多いため期間を短くして出力してください')
  }
  return rows
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { headers })
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed' }, 405)
  try {
    const url = Deno.env.get('SUPABASE_URL')!, authorization = request.headers.get('Authorization') || ''
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'ログインが必要です' }, 401)
    const sb = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const query = new URL(request.url).searchParams, storeId = Number(query.get('store_id'))
    if (!Number.isInteger(storeId) || storeId < 1) return json({ error: '店舗を確認してください' }, 400)
    const { data: member, error: memberError } = await sb.from('store_memberships').select('role').eq('user_id', user.id).eq('store_id', storeId).eq('active', true).maybeSingle()
    if (memberError) throw memberError
    if (!member || !['owner', 'admin', 'manager', 'viewer'].includes(member.role)) return json({ error: '閲覧権限がありません' }, 403)
    if (request.method === 'POST') {
      if (!['owner', 'admin', 'manager'].includes(member.role)) return json({ error: '経費を記録する権限がありません' }, 403)
      const body = await request.json().catch(() => ({}))
      const date = String(body.expense_date || ''), amount = Number(body.amount), category = String(body.category || '').trim(), name = String(body.name || '').trim(), vendor = String(body.vendor_name || '').trim()
      const tax = String(body.tax_category || 'unknown'), key = String(body.entry_key || '')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date || !Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000000 || !category || category.length > 80 || !name || name.length > 200 || vendor.length > 200 || !['unknown','taxable_10','taxable_8','non_taxable','exempt','out_of_scope'].includes(tax) || !/^[0-9a-f-]{36}$/i.test(key)) return json({ error: '経費の入力を確認してください' }, 400)
      const { data: saved, error } = await sb.rpc('record_management_expense', { p_store_id: storeId, p_user_id: user.id, p_date: date, p_category: category, p_name: name, p_amount: amount, p_vendor: vendor || null, p_tax: tax, p_key: key })
      if (error) throw error
      return json({ id: saved, saved: true })
    }
    const year = Number(query.get('year') || new Date().getUTCFullYear()), span = Number(query.get('span') || 1)
    if (!Number.isInteger(year) || year < 2000 || year > 2100 || ![1, 5, 10].includes(span)) return json({ error: '年と期間を確認してください' }, 400)
    const startYear = year - (span === 1 ? 1 : span - 1), start = `${startYear}-01-01`, end = `${year + 1}-01-01`
    if (query.get('mode') === 'export') {
      if (span !== 1 || !['owner', 'admin', 'manager'].includes(member.role)) return json({ error: '明細出力の権限・期間を確認してください' }, 403)
      const [orders, expenses, shifts] = await Promise.all([
        paged(sb, 'orders', 'id,business_date,ordered_at,paid_at,total,gross_total,discount_total,tax_total,payment_status,status,payment_method,receipt_number,order_channel_code,guest_count', storeId, 'business_date', start, end),
        paged(sb, 'store_expenses', 'id,expense_date,category,name,amount,vendor_name,tax_category,invoice_registration_number,receipt_import_id,voided_at,note', storeId, 'expense_date', start, end),
        paged(sb, 'work_shifts', 'id,shift_date,user_id,labor_cost,status', storeId, 'shift_date', start, end),
      ])
      const cols = ['種別','店舗ID','元データID','日付','取引先/担当','摘要','税込金額','税区分','支払方法/状態','証憑ID','備考']
      const data = [cols, ...orders.filter((x: any) => x.payment_status === 'paid' && x.status !== 'cancelled').map((x: any) => ['売上',storeId,x.id,x.business_date,'',x.receipt_number || '注文',x.total,'未分類',x.payment_method,'',`注文日時:${x.ordered_at || ''} 税額:${x.tax_total ?? ''} 値引:${x.discount_total ?? ''}`]),
        ...expenses.filter((x: any) => !x.voided_at).map((x: any) => ['経費',storeId,x.id,x.expense_date,x.vendor_name,x.category+' / '+x.name,x.amount,x.tax_category,'',x.receipt_import_id,x.note]),
        ...shifts.filter((x: any) => x.labor_cost != null).map((x: any) => ['人件費参考',storeId,x.id,x.shift_date,x.user_id,'シフト人件費',x.labor_cost,'未分類',x.status,'',''])]
      return new Response('\ufeff'+data.map(line => line.map(csvCell).join(',')).join('\r\n'), { headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="financial-sources-store-${storeId}-${year}.csv"` } })
    }
    const { data, error } = await sb.rpc('management_financial_months', { p_store_id: storeId, p_from: start, p_to: end })
    if (error) throw error
    const months = (data || []) as Month[], years = []
    for (let y = year - span + 1; y <= year; y++) {
      const yearMonths = months.filter(item => monthKey(item.month).startsWith(String(y)))
      years.push({ year: y, ...summarize(yearMonths) })
    }
    const selectedMonths = months.filter(item => monthKey(item.month).startsWith(String(year)))
    const selected = summarize(selectedMonths)
    const previousMonths = months.filter(item => monthKey(item.month).startsWith(String(year - 1)))
    const previous = summarize(previousMonths)
    const yoy = previous && previous.sales ? Math.round((selected.sales - previous.sales) / previous.sales * 1000) / 10 : null
    const comparisons = Array.from({ length: 12 }, (_, index) => {
      const mm = String(index + 1).padStart(2, '0')
      const history = months.filter(row => monthKey(row.month).endsWith('-' + mm)).map(row => ({ year: Number(row.month.slice(0, 4)), sales: n(row.sales), orders: n(row.order_count), expenses: n(row.expenses) }))
      const last = history.find(row => row.year === year), prior = history.find(row => row.year === year - 1)
      const comparable = Boolean(last?.orders && prior?.orders)
      return { month: mm, history, next_year: year + 1, projection: comparable ? { flat: last!.sales, trend: Math.max(0, 2 * last!.sales - prior!.sales), change_percent: prior!.sales ? Math.round((last!.sales / prior!.sales - 1) * 1000) / 10 : null, method: '直近２回の同月実績を直線で延長した参考シナリオ' } : null }
    })
    return json({ store_id: storeId, year, span, comparisons, basis: 'tax_inclusive_management_estimate', months: selectedMonths.map(row => ({ ...row, estimated_profit: n(row.sales)-n(row.estimated_cogs)-n(row.labor)-n(row.expenses)-n(row.waste)-n(row.staff_consumption)-n(row.channel_fees) })), years, selected, yoy_sales_percent: yoy,
      notes: ['売上は会計済み注文の税込総額です。','商品原価と販売手数料は現在の登録値による概算で、購入・棚卸・過去の条件変更を反映しません。','仕入、廃棄、賄いの二重計上や未入力経費の確認が必要です。','正式な損益計算書や税務申告書ではありません。'] })
  } catch (error) { console.error(error); return json({ error: '財務データを取得できませんでした' }, 500) }
})
