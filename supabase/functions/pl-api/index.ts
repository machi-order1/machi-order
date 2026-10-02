import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,content-type,apikey',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
}
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })
type Sale = { payment_status: string; id: number; total: number; business_date: string; check_group_id: number | null; guest_count: number; payment_method: string | null; order_channel_code: string | null; order_items?: { quantity: number; product_id: number }[] }
type Fee = { channel_code: string; percent_fee: number; fixed_fee: number }

function summarizeSales(paid: Sale[], feeRules: Fee[]) {
  const days = new Map<string, { date: string; sales: number; orders: number; guests: number; visits: number; cash: number; paypay: number; other: number }>()
  const visits = new Map<string, number>()
  const feeGroups = new Map<string, { total: number; channel: string }>()
  const rules = new Map(feeRules.map(rule => [rule.channel_code, rule]))
  let sales = 0, cash = 0, paypay = 0
  for (const order of paid) {
    const value = Number(order.total || 0), date = order.business_date
    const channel = order.order_channel_code || 'dine_in'
    const visitKey = order.check_group_id ? `g:${order.check_group_id}` : `o:${order.id}`
    const dayVisitKey = `${date}:${visitKey}`
    const feeKey = `${channel}:${visitKey}`
    const daily = days.get(date) || { date, sales: 0, orders: 0, guests: 0, visits: 0, cash: 0, paypay: 0, other: 0 }
    daily.sales += value; daily.orders++
    if (order.payment_method === 'cash') { cash += value; daily.cash += value }
    else if (order.payment_method === 'paypay') { paypay += value; daily.paypay += value }
    else daily.other += value
    const guests = Math.max(1, Number(order.guest_count || 1))
    const previous = visits.get(dayVisitKey) || 0
    if (!previous) daily.visits++
    daily.guests += Math.max(previous, guests) - previous
    visits.set(dayVisitKey, Math.max(previous, guests))
    const fee = feeGroups.get(feeKey) || { total: 0, channel }
    fee.total += value; feeGroups.set(feeKey, fee)
    days.set(date, daily); sales += value
  }
  let channelFees = 0
  for (const feeGroup of feeGroups.values()) {
    const rule = rules.get(feeGroup.channel)
    if (rule) channelFees += Math.round(feeGroup.total * Number(rule.percent_fee || 0) / 100 + Number(rule.fixed_fee || 0))
  }
  const dailySales = [...days.values()].sort((a, b) => a.date.localeCompare(b.date))
  const guestCount = dailySales.reduce((sum, day) => sum + day.guests, 0)
  const visitCount = dailySales.reduce((sum, day) => sum + day.visits, 0)
  return { sales, cash_sales: cash, paypay_sales: paypay, other_sales: sales - cash - paypay,
    order_count: paid.length, guest_count: guestCount, visit_count: visitCount,
    average_ticket: guestCount ? Math.round(sales / guestCount) : 0,
    average_visit: visitCount ? Math.round(sales / visitCount) : 0,
    daily_sales: dailySales, channel_fees: channelFees }
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers })
  if (request.method !== 'GET') return response({ error: 'Method not allowed' }, 405)
  try {
    const authorization = request.headers.get('Authorization') || ''
    const url = Deno.env.get('SUPABASE_URL')!
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return response({ error: 'ログインが必要です' }, 401)
    const sb = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const params = new URL(request.url).searchParams
    const storeId = Number(params.get('store_id'))
    if (!Number.isInteger(storeId) || storeId < 1) return response({ error: '店舗を確認してください' }, 400)
    const { data: membership } = await sb.from('store_memberships').select('role')
      .eq('user_id', user.id).eq('store_id', storeId).eq('active', true).maybeSingle()
    if (!membership || !['owner', 'admin', 'manager', 'viewer'].includes(membership.role)) return response({ error: '閲覧権限がありません' }, 403)
    const { data: store, error: storeError } = await sb.from('stores').select('timezone').eq('id', storeId).single()
    if (storeError) throw storeError
    const timezone = store?.timezone || 'Asia/Tokyo'
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    const day = params.get('date')
    const month = params.get('month') || today.slice(0, 7)
    if (day && (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day)) return response({ error: '日付を確認してください' }, 400)
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return response({ error: '月を確認してください' }, 400)
    const start = day || `${month}-01`
    const next = new Date(`${start}T12:00:00Z`)
    if (day) next.setUTCDate(next.getUTCDate() + 1)
    else next.setUTCMonth(next.getUTCMonth() + 1)
    const end = next.toISOString().slice(0, 10)
    const orders: Sale[] = []
    // The API has a per-request row limit; read every page to avoid a partial month.
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await sb.from('orders')
        .select('id,total,payment_status,order_channel_code,guest_count,check_group_id,business_date,payment_method,order_items(quantity,product_id)')
        .eq('store_id', storeId).gte('business_date', start).lt('business_date', end)
        .neq('status', 'cancelled').order('id', { ascending: true }).range(offset, offset + 999)
      if (error) throw error
      orders.push(...(data || []) as Sale[])
      if (!data || data.length < 1000) break
      if (offset > 99000) throw Error('注文件数の上限を超えました')
    }
    const paid = orders.filter(order => order.payment_status === 'paid')
    const productIds = [...new Set(paid.flatMap(order => order.order_items || []).map(item => item.product_id))]
    const { data: products, error: productError } = productIds.length
      ? await sb.from('products').select('id,cost_price').in('id', productIds)
      : { data: [] as { id: number; cost_price: number }[], error: null }
    if (productError) throw productError
    const costMap = new Map((products || []).map(product => [product.id, Number(product.cost_price || 0)]))
    const cogs = paid.reduce((sum, order) => sum + (order.order_items || []).reduce((itemSum, item) => itemSum + (costMap.get(item.product_id) || 0) * Number(item.quantity || 0), 0), 0)
    const [expensesResult, shiftsResult, wasteResult, feesResult, staffResult] = await Promise.all([
      sb.from('store_expenses').select('amount').eq('store_id', storeId).gte('expense_date', start).lt('expense_date', end),
      sb.from('work_shifts').select('labor_cost').eq('store_id', storeId).gte('shift_date', start).lt('shift_date', end),
      sb.from('inventory_waste').select('cost_amount').eq('store_id', storeId).gte('business_date', start).lt('business_date', end),
      sb.from('channel_fee_rules').select('channel_code,percent_fee,fixed_fee').eq('store_id', storeId).eq('active', true),
      sb.from('staff_consumption_events').select('event_type,cost_amount').eq('store_id', storeId).gte('business_date', start).lt('business_date', end),
    ])
    for (const result of [expensesResult, shiftsResult, wasteResult, feesResult, staffResult]) if (result.error) throw result.error
    const sum = (rows: any[] | null, field: string) => (rows || []).reduce((amount, row) => amount + Number(row[field] || 0), 0)
    const expenses = sum(expensesResult.data, 'amount')
    const labor = sum(shiftsResult.data, 'labor_cost')
    const waste = sum(wasteResult.data, 'cost_amount')
    const staffConsumption = sum((staffResult.data || []).filter(row => row.event_type !== 'waste'), 'cost_amount')
    const salesSummary = summarizeSales(paid, (feesResult.data || []) as Fee[])
    const gross = salesSummary.sales - cogs
    const operating = gross - expenses - labor - waste - staffConsumption - salesSummary.channel_fees
    const [{ count: activeProducts }, { count: costedProducts }, { count: uncostedStaff }] = await Promise.all([
      sb.from('products').select('id', { count: 'exact', head: true }).eq('active', true).eq('store_id', storeId),
      sb.from('products').select('id', { count: 'exact', head: true }).eq('active', true).eq('store_id', storeId).gt('cost_price', 0),
      sb.from('staff_consumption_events').select('id', { count: 'exact', head: true }).eq('store_id', storeId).gte('business_date', start).lt('business_date', end).eq('cost_complete', false),
    ])
    const ratio = (value: number) => salesSummary.sales ? Math.round(value / salesSummary.sales * 1000) / 10 : 0
    return response({ ...salesSummary, data_quality: {
      active_products: activeProducts || 0, costed_products: costedProducts || 0,
      uncosted_products: Math.max(0, (activeProducts || 0) - (costedProducts || 0)),
      expense_rows: (expensesResult.data || []).length, waste_rows: (wasteResult.data || []).length,
      uncosted_staff_consumption: uncostedStaff || 0,
    }, period: day || month, month, date: day || null,
    cogs, gross_profit: gross, labor_cost: labor, waste_cost: waste,
    staff_consumption_cost: staffConsumption, expenses, operating_profit: operating,
    ratios: { food: ratio(cogs), labor: ratio(labor), fl: ratio(cogs + labor), operating: ratio(operating) } })
  } catch (error) {
    console.error(error)
    return response({ error: '売上情報を取得できませんでした' }, 500)
  }
})
