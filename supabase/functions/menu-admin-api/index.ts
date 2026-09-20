import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors })
const allowedStatuses = new Set(['available', 'sold_out', 'stopped'])
const managerRoles = new Set(['owner', 'admin', 'manager'])
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (!['GET', 'POST'].includes(req.method)) return json({ error: 'Method not allowed' }, 405)
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'ログインしてください' }, 401)
    const auth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: userData, error: userError } = await auth.auth.getUser(token)
    if (userError || !userData.user) return json({ error: 'ログインの有効期限が切れました' }, 401)
    const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const parsed = new URL(req.url)
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    const storeId = Number(parsed.searchParams.get('store_id') || body.store_id || 1)
    if (!Number.isInteger(storeId) || storeId < 1) return json({ error: '店舗が正しくありません' }, 400)
    const { data: membership, error: membershipError } = await sb.from('store_memberships').select('role').eq('store_id', storeId).eq('user_id', userData.user.id).eq('active', true).maybeSingle()
    if (membershipError) throw membershipError
    if (!membership) return json({ error: 'この店舗を操作する権限がありません' }, 403)
    const { data: store, error: storeError } = await sb.from('stores').select('id,name,brand_id').eq('id', storeId).single()
    if (storeError || !store) return json({ error: '店舗が見つかりません' }, 404)

    if (req.method === 'GET') {
      const { data: categories, error: categoryError } = await sb.from('categories').select('id,name,sort_order').eq('brand_id', store.brand_id).order('sort_order')
      if (categoryError) throw categoryError
      const { data: products, error: productError } = await sb.from('products').select('id,name,base_price,category_id,sort_order,customer_visible,active').eq('brand_id', store.brand_id).eq('active', true).order('sort_order')
      if (productError) throw productError
      const ids = (products || []).map((p: any) => p.id)
      const { data: statuses, error: statusError } = ids.length ? await sb.from('store_products').select('product_id,sale_status,updated_at').eq('store_id', storeId).in('product_id', ids) : { data: [], error: null }
      if (statusError) throw statusError
      const { data: rules, error: rulesError } = await sb.from('price_rules').select('id,product_id,name,price,start_time,end_time,days_of_week,active').eq('store_id', storeId).order('id')
      if (rulesError) throw rulesError
      const statusMap = new Map((statuses || []).map((s: any) => [Number(s.product_id), s]))
      return json({ store: { id: store.id, name: store.name }, role: membership.role, can_edit_happy_hour: managerRoles.has(membership.role), categories: categories || [], products: (products || []).map((p: any) => ({ ...p, sale_status: statusMap.get(Number(p.id))?.sale_status || 'available' })), price_rules: rules || [] })
    }

    const action = String(body.action || '')
    if (action === 'set_sale_status') {
      const productId = Number(body.product_id), saleStatus = String(body.sale_status || '')
      if (!Number.isInteger(productId) || !allowedStatuses.has(saleStatus)) return json({ error: '販売状態が正しくありません' }, 400)
      const { data: product } = await sb.from('products').select('id').eq('id', productId).eq('brand_id', store.brand_id).eq('active', true).maybeSingle()
      if (!product) return json({ error: '商品が見つかりません' }, 404)
      const { error } = await sb.from('store_products').upsert({ store_id: storeId, product_id: productId, sale_status: saleStatus, updated_at: new Date().toISOString() })
      if (error) throw error
      return json({ ok: true, product_id: productId, sale_status: saleStatus })
    }

    if (action === 'set_happy_hour') {
      if (!managerRoles.has(membership.role)) return json({ error: 'ハッピーアワーは店長のみ変更できます' }, 403)
      const startTime = String(body.start_time || ''), endTime = String(body.end_time || ''), active = Boolean(body.active)
      const prices = Array.isArray(body.prices) ? body.prices : []
      if (!timePattern.test(startTime) || !timePattern.test(endTime)) return json({ error: '開始・終了時刻が正しくありません' }, 400)
      if (!prices.length) return json({ error: '対象商品がありません' }, 400)
      const ids = prices.map((x: any) => Number(x.id)).filter(Number.isInteger)
      if (new Set(ids).size !== prices.length) return json({ error: '対象商品が正しくありません' }, 400)
      const { data: existing, error: existingError } = await sb.from('price_rules').select('id').eq('store_id', storeId).in('id', ids)
      if (existingError) throw existingError
      if ((existing || []).length !== ids.length) return json({ error: '対象商品が正しくありません' }, 400)
      for (const item of prices) {
        const id = Number(item.id), price = Number(item.price)
        if (!Number.isInteger(price) || price < 0 || price > 100000) return json({ error: '価格が正しくありません' }, 400)
        const { error } = await sb.from('price_rules').update({ price, start_time: startTime, end_time: endTime, active }).eq('store_id', storeId).eq('id', id)
        if (error) throw error
      }
      return json({ ok: true, start_time: startTime, end_time: endTime, active })
    }
    return json({ error: '操作が正しくありません' }, 400)
  } catch (error) {
    console.error(error)
    return json({ error: '更新できませんでした。もう一度お試しください' }, 500)
  }
})
