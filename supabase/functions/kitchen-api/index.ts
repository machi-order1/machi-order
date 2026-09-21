import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,content-type,apikey',
  'Access-Control-Allow-Methods': 'GET,PATCH,OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers })
  try {
    const authorization = req.headers.get('Authorization') || ''
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'ログインが必要です' }, 401)

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const url = new URL(req.url), storeId = Number(url.searchParams.get('store_id') || 1)
    const { data: membership } = await sb.from('store_memberships').select('role').eq('user_id', user.id).eq('store_id', storeId).eq('active', true).maybeSingle()
    if (!membership) return json({ error: 'この店舗を操作する権限がありません' }, 403)

    if (req.method === 'GET') {
      const { data, error } = await sb.from('orders')
        .select('id,status,total,ordered_at,customer_note,entry_channel,order_channel_code,external_order_ref,dining_tables(name,table_number,seat_code,seat_type),takeout_order_details(customer_name,phone,pickup_at,pickup_status),order_items(id,product_name_snapshot,quantity,unit_price,customer_note,order_item_options(option_name_snapshot,price_delta))')
        .eq('store_id', storeId).in('status', ['new', 'cooking']).order('ordered_at', { ascending: true })
      if (error) throw error
      return json({ role: membership.role, orders: data || [] })
    }

    if (req.method === 'PATCH') {
      if (!['owner', 'admin', 'manager', 'kitchen', 'staff'].includes(membership.role)) return json({ error: '注文状態を変更する権限がありません' }, 403)
      const body = await req.json().catch(() => ({})), orderId = Number(body.order_id), next = String(body.status || ''), undo = body.undo === true
      if (!orderId || !['cooking', 'served'].includes(next)) return json({ error: '注文番号または状態が正しくありません' }, 400)
      const { data: order } = await sb.from('orders').select('status,served_at').eq('id', orderId).eq('store_id', storeId).maybeSingle()
      if (!order) return json({ error: '注文が見つかりません' }, 404)
      const servedAt = order.served_at ? new Date(order.served_at).getTime() : 0
      const forward = (order.status === 'new' && next === 'cooking') || (order.status === 'cooking' && next === 'served')
      const undoServed = undo && order.status === 'served' && next === 'cooking' && servedAt > Date.now() - 5 * 60_000
      if (!forward && !undoServed) return json({ error: `状態を ${order.status} から ${next} へ変更できません` }, 409)

      const patch: Record<string, unknown> = { status: next }
      if (next === 'served') patch.served_at = new Date().toISOString()
      if (undoServed) patch.served_at = null
      const { data, error } = await sb.from('orders').update(patch).eq('id', orderId).eq('store_id', storeId).eq('status', order.status).select('id,status,served_at').maybeSingle()
      if (error) throw error
      if (!data) return json({ error: '別端末で状態が更新されました。再読み込みしてください' }, 409)
      await sb.from('order_events').insert({
        order_id: orderId,
        store_id: storeId,
        event_type: undoServed ? 'status_reverted' : 'status_changed',
        from_status: order.status,
        to_status: next,
        user_id: user.id,
      })
      return json({ ok: true, order: data, undone: undoServed })
    }
    return json({ error: 'Method not allowed' }, 405)
  } catch (error) {
    console.error(error)
    return json({ error: 'システムエラーが発生しました' }, 500)
  }
})
