import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type,apikey', 'Access-Control-Allow-Methods': 'GET,OPTIONS', 'Content-Type': 'application/json; charset=utf-8' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })
const nextDay = (day: string) => {
  const d = new Date(day + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}
const firstMonth = (day: string, monthsBack: number) => {
  const d = new Date(day.slice(0, 7) + '-01T12:00:00Z')
  d.setUTCMonth(d.getUTCMonth() - monthsBack)
  return d.toISOString().slice(0, 10)
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { headers })
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405)
  try {
    const authorization = request.headers.get('Authorization') || ''
    const url = Deno.env.get('SUPABASE_URL')!
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'ログインが必要です' }, 401)
    const query = new URL(request.url).searchParams
    const storeId = Number(query.get('store_id'))
    const range = query.get('range') || 'three_months'
    if (!Number.isInteger(storeId) || storeId < 1 || !['three_months','six_months','year','all'].includes(range)) return json({ error: '店舗と期間を確認してください' }, 400)
    const sb = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: member, error: memberError } = await sb.from('store_memberships').select('role').eq('store_id', storeId).eq('user_id', user.id).eq('active', true).maybeSingle()
    if (memberError) throw memberError
    if (!member || !['owner','admin','manager','viewer'].includes(member.role)) return json({ error: '閲覧権限がありません' }, 403)
    const { data: store, error: storeError } = await sb.from('stores').select('timezone,name').eq('id', storeId).single()
    if (storeError) throw storeError
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: store.timezone || 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    const { data: first, error: firstError } = await sb.from('orders').select('business_date')
      .eq('store_id', storeId).eq('payment_status', 'paid').neq('status', 'cancelled')
      .lte('business_date', today).order('business_date', { ascending: true }).limit(1).maybeSingle()
    if (firstError) throw firstError
    const monthsBack = range === 'three_months' ? 2 : range === 'six_months' ? 5 : 11
    const start = range === 'all' ? (first?.business_date || today) : firstMonth(today, monthsBack)
    const end = nextDay(today)
    const { data, error } = await sb.rpc('management_sales_mix', { p_store_id: storeId, p_from: start, p_to: end })
    if (error) throw error
    return json({ store_id: storeId, store_name: store.name, range, from: start, to_exclusive: end,
      first_recorded_sale: first?.business_date || null, basis: 'paid_pos_orders_only', ...data })
  } catch (error) {
    console.error(error)
    return json({ error: '分析データを取得できませんでした' }, 500)
  }
})
