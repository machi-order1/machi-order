import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const H = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type,apikey','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Content-Type':'application/json; charset=utf-8'}
const O = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: H })

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: H })
  try {
    const authorization = request.headers.get('Authorization') || ''
    const url = Deno.env.get('SUPABASE_URL')!
    const auth = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
    const { data: { user } } = await auth.auth.getUser()
    if (!user) return O({ error: 'ログインが必要です' }, 401)
    const sb = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const parsed = new URL(request.url)
    const storeId = Number(parsed.searchParams.get('store_id') || 1)
    if (!Number.isInteger(storeId) || storeId < 1) return O({ error: '店舗が正しくありません' }, 400)
    const { data: membership } = await sb.from('store_memberships').select('role').eq('user_id', user.id).eq('store_id', storeId).eq('active', true).maybeSingle()
    if (!membership || !['owner','admin','manager','staff'].includes(membership.role)) return O({ error: '締め処理の権限がありません' }, 403)
    const { data: store } = await sb.from('stores').select('timezone').eq('id', storeId).single()
    const timezone = store?.timezone || 'Asia/Tokyo'
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
    const date = parsed.searchParams.get('date') || today
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return O({ error: '営業日が正しくありません' }, 400)
    const { data: orders, error: orderError } = await sb.from('orders').select('id,total,gross_total,discount_total,payment_method,payment_status,guest_count,order_channel_code').eq('store_id', storeId).eq('business_date', date).neq('status', 'cancelled')
    if (orderError) throw orderError
    const paid = (orders || []).filter((row: any) => row.payment_status === 'paid')
    const sum = (rows: any[], key = 'total') => rows.reduce((total: number, row: any) => total + Number(row[key] || 0), 0)
    const net = sum(paid), gross = paid.reduce((total: number, row: any) => total + Number(row.gross_total ?? row.total ?? 0), 0), discount = sum(paid, 'discount_total')
    const cash = sum(paid.filter((row: any) => row.payment_method === 'cash')), paypay = sum(paid.filter((row: any) => row.payment_method === 'paypay')), other = net - cash - paypay
    const guests = paid.reduce((total: number, row: any) => total + Number(row.guest_count || 1), 0)
    const channelSales: Record<string, number> = {}
    for (const row of paid) { const key = row.order_channel_code || 'dine_in'; channelSales[key] = (channelSales[key] || 0) + Number(row.total || 0) }
    const { data: drawer } = await sb.from('cash_drawer_sessions').select('*').eq('store_id', storeId).eq('business_date', date).order('opened_at', { ascending: false }).limit(1).maybeSingle()
    const openingCash = Number(drawer?.opening_cash || 0), expected = openingCash + cash
    const summary = { business_date: date, gross_sales: gross, discount_total: discount, net_sales: net, cash_sales: cash, paypay_sales: paypay, other_sales: other, order_count: paid.length, guest_count: guests, cash_expected: expected, opening_cash: openingCash, channel_sales: channelSales }
    const { data: existing } = await sb.from('daily_closings').select('*').eq('store_id', storeId).eq('business_date', date).maybeSingle()
    if (request.method === 'GET') return O({ timezone, summary, closing: existing, cash_drawer: drawer })
    if (request.method !== 'POST') return O({ error: 'Method not allowed' }, 405)
    if (existing) return O({ error: '本日はすでに締め済みです。二重締めはできません', closing: existing }, 409)
    const body = await request.json().catch(() => ({}))
    const actual = body.cash_actual == null ? null : Number(body.cash_actual)
    if (actual == null || !Number.isFinite(actual) || actual < 0 || !Number.isInteger(actual)) return O({ error: '実在高を1円単位で入力してください' }, 400)
    const note = String(body.note || '').trim().slice(0, 500)
    const difference = actual - expected
    if (difference !== 0 && !note) return O({ error: '現金差額があるため、締めメモに理由を入力してください' }, 400)
    const row = { store_id: storeId, business_date: date, gross_sales: gross, discount_total: discount, net_sales: net, cash_sales: cash, paypay_sales: paypay, other_sales: other, order_count: paid.length, guest_count: guests, cash_expected: expected, cash_actual: actual, cash_difference: difference, note, closed_at: new Date().toISOString(), closed_by: user.id }
    const { data: closing, error: closingError } = await sb.from('daily_closings').insert(row).select().single()
    if (closingError) {
      if (closingError.code === '23505') return O({ error: '本日はすでに締め済みです。二重締めはできません' }, 409)
      throw closingError
    }
    if (drawer) await sb.from('cash_drawer_sessions').update({ expected_cash: expected, actual_cash: actual, difference, closed_by: user.id, closed_at: new Date().toISOString(), note: note || drawer.note || '' }).eq('id', drawer.id).is('closed_at', null)
    await sb.from('audit_logs').insert({ store_id: storeId, user_id: user.id, action: 'daily_closing_completed', entity_type: 'daily_closing', entity_id: String(closing.id), details: { business_date: date, net_sales: net, cash_expected: expected, cash_actual: actual, cash_difference: difference } })
    return O({ ok: true, closing, summary })
  } catch (error) {
    console.error(error)
    return O({ error: 'システムエラーが発生しました' }, 500)
  }
})
