import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })
const orderSelect = 'id,status,total,ordered_at,paid_at,payment_status,payment_method,receipt_number,dining_tables(name),order_items(product_name_snapshot,quantity,line_total,order_item_options(option_name_snapshot,price_delta))'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers })
  try {
    const authorization = req.headers.get('Authorization') || ''
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'ログインが必要です' }, 401)

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const url = new URL(req.url)
    const storeId = Number(url.searchParams.get('store_id') || 1)
    if (!Number.isInteger(storeId) || storeId < 1) return json({ error: '店舗を指定してください' }, 400)
    const { data: membership } = await sb.from('store_memberships').select('role').eq('user_id', user.id).eq('store_id', storeId).eq('active', true).maybeSingle()
    if (!membership || !['owner', 'admin', 'manager', 'staff'].includes(membership.role)) return json({ error: '会計権限がありません' }, 403)

    if (req.method === 'GET') {
      const mode = url.searchParams.get('mode') === 'history' ? 'history' : 'pending'
      let query = sb.from('orders').select(orderSelect).eq('store_id', storeId).neq('status', 'cancelled')
      if (mode === 'history') {
        const todayJst = new Date(Date.now() + 9 * 60 * 60_000).toISOString().slice(0, 10)
        const startUtc = new Date(`${todayJst}T00:00:00+09:00`).toISOString()
        query = query.eq('payment_status', 'paid').gte('paid_at', startUtc).order('paid_at', { ascending: false }).limit(100)
      } else {
        query = query.neq('payment_status', 'paid').order('ordered_at', { ascending: true })
      }
      const { data, error } = await query
      if (error) throw error
      return json({ orders: data || [], mode, role: membership.role })
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}))
      const orderId = Number(body.order_id)
      const action = String(body.action || 'complete_payment')
      if (!Number.isInteger(orderId) || orderId < 1) return json({ error: '注文番号が正しくありません' }, 400)
      if (action === 'undo_payment') {
        const { data, error } = await sb.rpc('undo_order_payment', { p_store_id: storeId, p_order_id: orderId, p_user_id: user.id })
        if (error) {
          const message = String(error.message || '')
          if (message.includes('order_not_found')) return json({ error: '注文が見つかりません' }, 404)
          if (message.includes('not_paid')) return json({ error: 'この注文は会計済みではありません' }, 409)
          if (message.includes('undo_window_expired')) return json({ error: '会計完了から5分を過ぎたため、店長確認が必要です' }, 409)
          throw error
        }
        const { error: auditError } = await sb.from('audit_logs').insert({
          store_id: storeId,
          user_id: user.id,
          action: 'payment_reverted',
          entity_type: 'order',
          entity_id: String(orderId),
          details: { amount: data?.total, payment_method: data?.previous_payment_method, external_refund_required: Boolean(data?.external_refund_required) },
        })
        if (auditError) console.error('audit_log_failed', auditError)
        return json(data || { ok: true })
      }
      const method = String(body.payment_method || '')
      if (!['cash', 'paypay', 'other'].includes(method)) return json({ error: '支払方法が正しくありません' }, 400)
      const { data, error } = await sb.rpc('complete_order_payment', { p_store_id: storeId, p_order_id: orderId, p_method: method, p_user_id: user.id })
      if (error) {
        if (String(error.message).includes('order_not_found')) return json({ error: '注文が見つかりません' }, 404)
        throw error
      }
      const { error: auditError } = await sb.from('audit_logs').insert({
        store_id: storeId,
        user_id: user.id,
        action: 'payment_completed',
        entity_type: 'order',
        entity_id: String(orderId),
        details: { amount: data?.total, payment_method: method, receipt_number: data?.receipt_number },
      })
      if (auditError) console.error('audit_log_failed', auditError)
      return json(data || { ok: true })
    }
    return json({ error: 'Method not allowed' }, 405)
  } catch (error) {
    console.error(error)
    return json({ error: 'システムエラーが発生しました' }, 500)
  }
})
