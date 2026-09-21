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
    const { data: store } = await sb.from('stores').select('name,brand_id,brands(company_id)').eq('id', storeId).single()
    const companyId = (store as any)?.brands?.company_id
    if (!companyId) return O({ error: '店舗設定が見つかりません' }, 404)
    if (request.method === 'GET') {
      const [{ data: items }, { data: movements }, { data: counts }, { data: lots }, { data: prepTasks }] = await Promise.all([
        sb.from('inventory_items').select('*').eq('company_id', companyId).eq('active', true).order('sort_order').order('name'),
        sb.from('inventory_movements').select('inventory_item_id,quantity,occurred_at').eq('store_id', storeId),
        sb.from('inventory_counts').select('inventory_item_id,quantity,counted_at').eq('store_id', storeId).order('counted_at', { ascending: false }),
        sb.from('inventory_lots').select('id,inventory_item_id,quantity,received_on,expires_on,lot_code,status,prepared_at,prepared_by,prep_task_id').eq('store_id', storeId).eq('status', 'active').gt('quantity', 0).order('expires_on', { ascending: true, nullsFirst: false }).order('created_at'),
        sb.from('prep_tasks').select('id,business_date,completed_quantity,completed_at,note,input_item_id,input_quantity,output_item_id,output_lot_id,expires_on,assigned_user_id').eq('store_id', storeId).eq('status', 'done').order('completed_at', { ascending: false }).limit(20),
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
      const names = new Map((items || []).map((item: any) => [item.id, { name: item.name, unit: item.unit, item_type: item.item_type }]))
      const lotOutput = (lots || []).map((lot: any) => ({ ...lot, ...(names.get(lot.inventory_item_id) || {}) }))
      const prepOutput = (prepTasks || []).map((task: any) => ({ ...task, input_name: names.get(task.input_item_id)?.name || '', input_unit: names.get(task.input_item_id)?.unit || '', output_name: names.get(task.output_item_id)?.name || '', output_unit: names.get(task.output_item_id)?.unit || '' }))
      return O({ store: { id: storeId, name: (store as any)?.name || '店舗' }, can_manage_items: ['owner','admin','manager'].includes(membership.role), items: output, lots: lotOutput, prep_history: prepOutput, reorder_suggestions: output.filter((item: any) => item.needs_reorder).map((item: any) => ({ inventory_item_id: item.id, name: item.name, current_stock: item.stock_quantity, reorder_level: item.reorder_level, par_level: item.par_level, suggested_quantity: item.suggested_purchase_quantity, unit: item.unit, purchase_location: item.purchase_location })) })
    }
    if (request.method !== 'POST') return O({ error: 'Method not allowed' }, 405)
    const body = await request.json().catch(() => ({}))
    if (body.action === 'prep_complete') {
      const inputItemId = Number(body.input_item_id), outputItemId = Number(body.output_item_id), inputQuantity = Number(body.input_quantity), outputQuantity = Number(body.output_quantity)
      if (![inputItemId, outputItemId].every((value) => Number.isInteger(value) && value > 0) || ![inputQuantity, outputQuantity].every((value) => Number.isFinite(value) && value > 0)) return O({ error: '仕込み品目と数量を確認してください' }, 400)
      const expiresOn = body.expires_on ? String(body.expires_on) : null
      if (expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return O({ error: '消費期限が正しくありません' }, 400)
      const { data, error } = await sb.rpc('complete_inventory_prep', { p_store_id: storeId, p_input_item_id: inputItemId, p_input_quantity: inputQuantity, p_output_item_id: outputItemId, p_output_quantity: outputQuantity, p_expires_on: expiresOn, p_user_id: user.id, p_note: body.note ? String(body.note).slice(0, 500) : null })
      if (error) return O({ error: error.message || '仕込みを記録できませんでした' }, 400)
      await sb.from('audit_logs').insert({ store_id: storeId, user_id: user.id, action: 'inventory_prep_completed', entity_type: 'prep_task', entity_id: String(data?.task_id || ''), details: { input_item_id: inputItemId, input_quantity: inputQuantity, output_item_id: outputItemId, output_quantity: outputQuantity, expires_on: data?.expires_on || expiresOn } })
      return O({ ok: true, prep: data })
    }
    if (body.action === 'lot_waste') {
      const lotId = Number(body.lot_id), wasteQuantity = Number(body.quantity)
      if (!Number.isInteger(lotId) || lotId < 1 || !Number.isFinite(wasteQuantity) || wasteQuantity <= 0) return O({ error: '廃棄数量を確認してください' }, 400)
      const reason = String(body.reason || '期限・品質').trim().slice(0, 500)
      const { data, error } = await sb.rpc('record_inventory_lot_waste', { p_store_id: storeId, p_lot_id: lotId, p_quantity: wasteQuantity, p_reason: reason, p_user_id: user.id })
      if (error) return O({ error: error.message || '廃棄を記録できませんでした' }, 400)
      await sb.from('audit_logs').insert({ store_id: storeId, user_id: user.id, action: 'inventory_lot_waste_recorded', entity_type: 'inventory_lot', entity_id: String(lotId), details: { quantity: wasteQuantity, reason, remaining_quantity: data?.remaining_quantity } })
      return O({ ok: true, waste: data })
    }
    if (['item_create','item_update','item_deactivate'].includes(String(body.action))) {
      if (!['owner','admin','manager'].includes(membership.role)) return O({ error: '品目設定は店長権限が必要です' }, 403)
      const groups = ['冷蔵庫仕込み在庫','タレ系在庫','冷凍食材在庫','メイン食材在庫','買い出し系食材','飲み物','備品','その他']
      if (body.action === 'item_deactivate') {
        const id = Number(body.inventory_item_id)
        if (!Number.isInteger(id) || id < 1) return O({ error: '品目が正しくありません' }, 400)
        const { data: item, error } = await sb.from('inventory_items').update({ active: false }).eq('id', id).eq('company_id', companyId).eq('active', true).select('id,name').maybeSingle()
        if (error) throw error
        if (!item) return O({ error: '品目が見つかりません' }, 404)
        await sb.from('audit_logs').insert({ store_id: storeId, user_id: user.id, action: 'inventory_item_deactivated', entity_type: 'inventory_item', entity_id: String(id), details: { name: item.name } })
        return O({ ok: true, item })
      }
      const name = String(body.name || '').trim().slice(0, 80), unit = String(body.unit || '').trim().slice(0, 20), inventoryGroup = String(body.inventory_group || '')
      if (!name || !unit || !groups.includes(inventoryGroup)) return O({ error: '品目名・単位・グループを確認してください' }, 400)
      const numberOrNull = (value: unknown) => value === '' || value == null ? null : Number(value)
      const parLevel = numberOrNull(body.par_level), reorderLevel = numberOrNull(body.reorder_level)
      if ((parLevel != null && (!Number.isFinite(parLevel) || parLevel < 0)) || (reorderLevel != null && (!Number.isFinite(reorderLevel) || reorderLevel < 0))) return O({ error: '基準在庫と発注点は0以上で入力してください' }, 400)
      const itemType = ['raw','prepared','sauce','frozen','drink','supply'].includes(String(body.item_type)) ? String(body.item_type) : 'raw'
      const payload = { name, unit, inventory_group: inventoryGroup, item_type: itemType, inventory_class: inventoryGroup === '備品' ? 'supplies' : inventoryGroup === '飲み物' ? 'beverage' : itemType === 'prepared' ? 'prepared_food' : 'food', par_level: parLevel, reorder_level: reorderLevel, purchase_location: body.purchase_location ? String(body.purchase_location).trim().slice(0, 100) : null, sort_order: groups.indexOf(inventoryGroup) * 1000 + Math.max(0, Math.min(999, Number(body.sort_order) || 500)) }
      if (body.action === 'item_create') {
        const { data: duplicate } = await sb.from('inventory_items').select('id,active').eq('company_id', companyId).ilike('name', name).maybeSingle()
        if (duplicate) return O({ error: duplicate.active ? '同じ名前の品目がすでにあります' : '停止中に同じ名前の品目があります。再開は管理者へ依頼してください' }, 409)
        const { data: item, error } = await sb.from('inventory_items').insert({ company_id: companyId, ...payload }).select().single()
        if (error) throw error
        await sb.from('audit_logs').insert({ store_id: storeId, user_id: user.id, action: 'inventory_item_created', entity_type: 'inventory_item', entity_id: String(item.id), details: payload })
        return O({ ok: true, item })
      }
      const id = Number(body.inventory_item_id)
      if (!Number.isInteger(id) || id < 1) return O({ error: '品目が正しくありません' }, 400)
      const { data: item, error } = await sb.from('inventory_items').update(payload).eq('id', id).eq('company_id', companyId).eq('active', true).select().maybeSingle()
      if (error) throw error
      if (!item) return O({ error: '品目が見つかりません' }, 404)
      await sb.from('audit_logs').insert({ store_id: storeId, user_id: user.id, action: 'inventory_item_updated', entity_type: 'inventory_item', entity_id: String(id), details: payload })
      return O({ ok: true, item })
    }
    const itemId = Number(body.inventory_item_id), quantity = Number(body.quantity)
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
