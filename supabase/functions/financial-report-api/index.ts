import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type,apikey', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } })
import { annualView, csvCell, menuDateRange } from './metrics.ts'
import type { Month } from './metrics.ts'

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
    const { data: store, error: storeError } = await sb.from('stores').select('timezone').eq('id', storeId).single()
    if (storeError) throw storeError
    const localToday = new Intl.DateTimeFormat('en-CA', { timeZone: store?.timezone || 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    const { data: member, error: memberError } = await sb.from('store_memberships').select('role').eq('user_id', user.id).eq('store_id', storeId).eq('active', true).maybeSingle()
    if (memberError) throw memberError
    if (!member || !['owner', 'admin', 'manager', 'viewer'].includes(member.role)) return json({ error: '閲覧権限がありません' }, 403)
    if (request.method === 'GET' && query.get('mode') === 'menu') {
      const range = query.get('range') || 'today', requestedDate = query.get('date') || localToday
      const idText = query.get('product_id') || ''
      if (!['today','this_week','last_week','this_month','last_month','this_year','last_year','date'].includes(range)
        || (idText && (!/^[1-9]\d*$/.test(idText) || !Number.isSafeInteger(Number(idText))))
        || !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
        || Number.isNaN(Date.parse(`${requestedDate}T00:00:00Z`))
        || new Date(`${requestedDate}T00:00:00Z`).toISOString().slice(0, 10) !== requestedDate) return json({ error: '期間・商品を確認してください' }, 400)
      const { from, to } = menuDateRange(localToday, range, requestedDate)
      const { data, error } = await sb.rpc('management_menu_sales', { p_store_id: storeId, p_from: from, p_to: to, p_product_id: idText ? Number(idText) : null })
      if (error) throw error
      return json({ store_id: storeId, range, from, to_exclusive: to, ...data, basis: 'item_line_before_order_discount' })
    }
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
    const year = Number(query.get('year') || localToday.slice(0, 4)), span = Number(query.get('span') || 1)
    if (!Number.isInteger(year) || year < 2000 || year > 2100 || ![1, 5, 10].includes(span)) return json({ error: '年と期間を確認してください' }, 400)
    const startYear = Math.min(year - span + 1, year - 2), start = `${startYear}-01-01`, end = `${year + 1}-01-01`
    if (query.get('mode') === 'patterns') {
      // Complete months keep the early days of this month from distorting the pattern.
      const patternEnd = year === Number(localToday.slice(0, 4)) ? `${localToday.slice(0, 7)}-01` : end
      const { data, error } = await sb.rpc('management_sales_channel_patterns', { p_store_id: storeId, p_from: `${year}-01-01`, p_to: patternEnd })
      if (error) throw error
      return json({ store_id: storeId, year, from: `${year}-01-01`, to_exclusive: patternEnd, basis: 'recorded_days', rows: data || [] })
    }
    if (query.get('mode') === 'export') {
      const exportStart = `${year}-01-01`
      if (span !== 1 || !['owner', 'admin', 'manager'].includes(member.role)) return json({ error: '明細出力の権限・期間を確認してください' }, 403)
      const [orders, expenses, shifts] = await Promise.all([
        paged(sb, 'orders', 'id,business_date,ordered_at,paid_at,total,gross_total,discount_total,tax_total,payment_status,status,payment_method,receipt_number,order_channel_code,guest_count', storeId, 'business_date', exportStart, end),
        paged(sb, 'store_expenses', 'id,expense_date,category,name,amount,vendor_name,tax_category,invoice_registration_number,receipt_import_id,voided_at,note', storeId, 'expense_date', exportStart, end),
        paged(sb, 'work_shifts', 'id,shift_date,user_id,labor_cost,status', storeId, 'shift_date', exportStart, end),
      ])
      const cols = ['種別','店舗ID','元データID','日付','取引先/担当','摘要','税込金額','税区分','支払方法/状態','証憑ID','適格請求書登録番号','備考']
      const data = [cols, ...orders.filter((x: any) => x.payment_status === 'paid' && x.status !== 'cancelled').map((x: any) => ['売上',storeId,x.id,x.business_date,'',x.receipt_number || '注文',x.total,'未分類',x.payment_method,'','',`注文日時:${x.ordered_at || ''} 税額:${x.tax_total ?? ''} 値引:${x.discount_total ?? ''}`]),
        ...expenses.filter((x: any) => !x.voided_at).map((x: any) => ['経費',storeId,x.id,x.expense_date,x.vendor_name,x.category+' / '+x.name,x.amount,x.tax_category,'',x.receipt_import_id,x.invoice_registration_number,x.note]),
        ...shifts.filter((x: any) => x.labor_cost != null).map((x: any) => ['人件費参考',storeId,x.id,x.shift_date,x.user_id,'シフト人件費',x.labor_cost,'未分類',x.status,'','',''])]
      return new Response('\ufeff'+data.map(line => line.map(csvCell).join(',')).join('\r\n'), { headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="financial-sources-store-${storeId}-${year}.csv"` } })
    }
    const { data, error } = await sb.rpc('management_financial_months', { p_store_id: storeId, p_from: start, p_to: end })
    if (error) throw error
    const report = annualView((data || []) as Month[], year, span, localToday)
    return json({ store_id: storeId, year, span, ...report, can_edit: ['owner','admin','manager'].includes(member.role), basis: 'tax_inclusive_management_estimate',
      notes: ['売上は会計済み注文の税込総額です。','商品原価と販売手数料は現在の登録値による概算で、購入・棚卸・過去の条件変更を反映しません。','仕入、廃棄、賄いの二重計上や未入力経費の確認が必要です。','正式な損益計算書や税務申告書ではありません。'] })
  } catch (error) { console.error(error); return json({ error: '財務データを取得できませんでした' }, 500) }
})
