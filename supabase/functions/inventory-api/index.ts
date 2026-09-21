import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const H = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type,apikey','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Content-Type':'application/json; charset=utf-8'}
const O = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: H })
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: H })
  try {
    const authorization = request.headers.get('Authorization') || ''
    const url = Deno.env.get('SUPABASE_URL')!
    const auth = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
    const { data: { user } } = await auth.auth.getUser()
    if (!user) return O({ error: 'ログインが必要です' }, 401)
    const sb = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const parsed = new URL(request.url), storeId = Number(parsed.searchParams.get('store_id') || 1)
    if (!Number.isInteger(storeId) || storeId < 1) return O({ error: '店舗が正しくありません' }, 400)
    const { data: membership } = await sb.from('store_memberships').select('role').eq('user_id', user.id).eq('store_id', storeId).eq('active', true).maybeSingle()
    if (!membership || !['owner','admin','manager','staff'].includes(membership.role)) return O({ error: '権限がありません' }, 403)
    const { data: store } = await sb.from('stores').select('brand_id,brands(company_id)').eq('id', storeId).single()
    const companyId = (store as any)?.brands?.company_id
    if (!companyId) return O({ error: '店舗設定が見つかりません' }, 404)
    if (request.method === 'GET') {
      const [{ data: items }, { data: movements }, { data: counts }] = await Promise.all([
        sb.from('inventory_items').select('*').eq('company_id', companyId).eq('active', true).order('inventory_class').order('name'),
        sb.from('inventory_movements').select('inventory_item_id,quantity,occurred_at').eq('store_id', storeId),
        sb.from('inventory_counts').select('inventory_item_id,quantity,counted_at').eq('store_id', storeId).order('counted_at', { ascending: false }),
      ])
      const latest = new Map<number, any>()
      for (const count of counts || []) if (!latest.has(count.inventory_item_id)) latest.set(count.inventory_item_id, count)
      const output = (items || []).map((item: any) => {
        const count = latest.get(item.id); let stock: number | null = null
        if (count) { stock = Number(count.quantity); for (const move of movements || []) if (move.inventory_item_id === item.id && new Date(move.occurred_at) > new Date(count.counted_at)) stock += Number(move.quantity || 0) }
        else { const rows = (movements || []).filter((move: any) => move.inventory_item_id === item.id); if (rows.length) stock = rows.reduce((total: number, move: any) => total + Number(move.quantity || 0), 0) }
        const needsReorder = stock !== null && item.reorder_level != null && stock <= Number(item.reorder_level)
        const suggestion = stock !== null && item.par_level != null ? Math.max(0, Number(item.par_level) - stock) : 0
        return { ...item, stock_quantity: stock, stock_known: stock !== null, last_counted_at: count?.counted_at || null, needs_reorder: needsReorder, suggested_purchase_quantity: needsReorder ? suggestion : 0 }
      })
      return O({ items: output, reorder_suggestions: output.filter((item: any) => item.needs_reorder).map((item: any) => ({ inventory_item_id: item.id, name: item.name, current_stock: item.stock_quantity, reorder_level: item.reorder_level, par_level: item.par_level, suggested_quantity: item.suggested_purchase_quantity, unit: item.unit, purchase_location: item.purchase_location })) })
    }
    if (request.method !== 'POST') return O({ error: 'Method not allowed' }, 405)
    const body = await request.json().catch(() => ({})), itemId = Number(body.inventory_item_id), quantity = Number(body.quantity)
    if (!Number.isInteger(itemId) || itemId < 1 || !Number.isFinite(quantity)) return O({ error: '入力内容を確認してください' }, 400)
    const { data: item } = await sb.from('inventory_items').select('id,name,unit_cost').eq('id', itemId).eq('company_id', companyId).eq('active', true).maybeSingle()
    if (!item) return O({ error: '在庫品目が見つかりません' }, 404)
    if (body.action === 'count') {
      if (quantity < 0) return O({ error: '在庫数は0以上で入力してください' }, 400)
      const businessDate = String(body.business_date || today()), session = String(body.session || 'night').slice(0, 30)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate) || !['opening','midday','night'].includes(session)) return O({ error: '棚卸日時が正しくありません' }, 400)
      const { data: count, error } = await sb.from('inventory_counts').upsert({ store_id: storeId, inventory_item_id: itemId, business_date: businessDate, count_session: session, quantity, counted_by: user.id, counted_at: new Date().toISOString() }, { onConflict: 'store_id,inventory_item_id,business_date,count_session' }).select().single()
      if (error) throw error
      await sb.from('audit_logs').insert({ store_id: storeId, user_id: user.id, action: 'inventory_count_recorded', entity_type: 'inventory_item', entity_id: String(itemId), details: { name: item.name, business_date: businessDate, session, quantity } })
      return O({ ok: true, count })
    }
    const type = String(body.movement_type || 'adjustment')
    if (!['purchase','usage','adjustment','waste','transfer_in','transfer_out'].includes(type)) return O({ error: '在庫処理区分が正しくありません' }, 400)
    if (type !== 'adjustment' && quantity < 0) return O({ error: '数量は0以上で入力してください' }, 400)
    const signed = type === 'adjustment' ? quantity : (['usage','waste','transfer_out'].includes(type) ? -Math.abs(quantity) : Math.abs(quantity))
    const { data: movement, error } = await sb.from('inventory_movements').insert({ store_id: storeId, inventory_item_id: itemId, movement_type: type, quantity: signed, unit_cost: body.unit_cost ?? item.unit_cost ?? null, note: body.note ? String(body.note).slice(0, 500) : null }).select().single()
    if (error) throw error
    if (type === 'waste' && quantity > 0) await sb.from('inventory_waste').insert({ store_id: storeId, inventory_item_id: itemId, business_date: today(), quantity: Math.abs(quantity), reason: body.note ? String(body.note).slice(0, 500) : null, cost_amount: (body.unit_cost ?? item.unit_cost) ? Math.round(Math.abs(quantity) * Number(body.unit_cost ?? item.unit_cost)) : null, recorded_by: user.id })
    return O({ ok: true, movement })
  } catch (error) {
    console.error(error)
    return O({ error: '処理できませんでした' }, 400)
  }
})
