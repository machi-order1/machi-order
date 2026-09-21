import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors })
const allowedRoles = new Set(['owner', 'admin', 'manager', 'staff', 'kitchen'])

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (!['GET', 'POST'].includes(req.method)) return json({ error: 'method_not_allowed' }, 405)

  try {
    const url = Deno.env.get('SUPABASE_URL') || ''
    const anon = Deno.env.get('SUPABASE_ANON_KEY') || ''
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'ログインが必要です' }, 401)

    const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
    const sb = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: userData, error: userError } = await auth.auth.getUser(token)
    if (userError || !userData.user) return json({ error: 'ログインの有効期限が切れました' }, 401)

    const parsed = new URL(req.url)
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    const storeId = Number(parsed.searchParams.get('store_id') || body.store_id || 1)
    if (!Number.isInteger(storeId) || storeId < 1) return json({ error: '店舗が正しくありません' }, 400)

    const { data: membership } = await sb.from('store_memberships')
      .select('role').eq('store_id', storeId).eq('user_id', userData.user.id).eq('active', true).maybeSingle()
    if (!membership || !allowedRoles.has(membership.role)) return json({ error: 'この店舗の口頭注文を入力する権限がありません' }, 403)

    if (req.method === 'GET') {
      const [{ data: store, error: storeError }, { data: tables, error: tableError }] = await Promise.all([
        sb.from('stores').select('id,name').eq('id', storeId).single(),
        sb.from('dining_tables').select('id,name,qr_token,table_number,seat_code,capacity,seat_type')
          .eq('store_id', storeId).eq('active', true).neq('seat_type', 'other').order('table_number'),
      ])
      if (storeError || tableError) throw storeError || tableError
      return json({ store, tables: tables || [] })
    }

    const tableId = Number(body.table_id)
    const items = Array.isArray(body.items) ? body.items : []
    const requestId = String(body.request_id || '').replace(/^customer-/, '')
    if (!Number.isInteger(tableId) || tableId < 1) return json({ error: '席を選んでください' }, 400)
    if (!items.length) return json({ error: '商品が選択されていません' }, 400)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      return json({ error: '注文識別番号が無効です' }, 400)
    }

    const { data: table } = await sb.from('dining_tables').select('id,qr_token,name')
      .eq('id', tableId).eq('store_id', storeId).eq('active', true).neq('seat_type', 'other').maybeSingle()
    if (!table) return json({ error: 'この店舗の席ではありません' }, 404)

    const normalized = items.map((item: any) => ({
      product_id: Number(item.product_id),
      quantity: Math.max(1, Math.min(99, Number(item.quantity) || 1)),
      option_ids: Array.isArray(item.option_ids) ? item.option_ids.map(Number).filter(Boolean) : [],
    }))
    const { data, error } = await sb.rpc('place_customer_order_idempotent', {
      p_qr_token: table.qr_token,
      p_items: normalized,
      p_client_order_key: requestId,
    })
    if (error) {
      const message = String(error.message || '')
      if (message.includes('営業時間外')) return json({ error: '現在は営業時間外です' }, 409)
      if (message.includes('注文受付を停止')) return json({ error: '現在、注文受付を一時停止しています' }, 409)
      if (message.includes('売り切れ') || message.includes('販売停止') || message.includes('現在注文できません')) return json({ error: '売り切れ・販売停止の商品が含まれています' }, 409)
      if (message.includes('オプション') || message.includes('選択') || message.includes('商品')) return json({ error: message }, 400)
      throw error
    }

    const orderId = Number(data.order_id)
    const { error: updateError } = await sb.from('orders')
      .update({ order_channel_code: 'dine_in', entry_channel: 'staff_order' })
      .eq('id', orderId).eq('store_id', storeId).eq('table_id', tableId)
    if (updateError) throw updateError

    if (!data.duplicate) {
      await sb.from('audit_logs').insert({
        store_id: storeId,
        user_id: userData.user.id,
        action: 'staff_order_created',
        entity_type: 'order',
        entity_id: String(orderId),
        details: { table_id: tableId, table_name: table.name, total: data.total },
      })
    }
    return json({ ok: true, order_id: orderId, total: data.total, duplicate: Boolean(data.duplicate) }, 201)
  } catch (error) {
    console.error(error)
    return json({ error: '口頭注文を登録できませんでした' }, 500)
  }
})
