import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization, apikey',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
}
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors })
const minutes = (value: string | null) => value ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)) : null
const inPeriod = (now: number, start: number, end: number) => start <= end ? now >= start && now < end : now >= start || now < end

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  try {
    const url = new URL(req.url)
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    const token = url.searchParams.get('t') || body.token
    if (!token) return out({ error: 'QRコードが無効です' }, 400)

    const { data: table, error: tableError } = await sb.from('dining_tables')
      .select('id,name,store_id,active,stores(id,name,timezone,brand_id,brands(id,name))')
      .eq('qr_token', token).eq('active', true).single()
    if (tableError || !table) return out({ error: 'このQRコードは利用できません' }, 404)
    const store: any = (table as any).stores

    if (req.method === 'GET') {
      const [categoryResult, productResult, settingsResult, periodResult] = await Promise.all([
        sb.from('categories').select('id,name,parent_id,sort_order').eq('brand_id', store.brand_id).order('sort_order'),
        sb.from('products').select('id,name,description,base_price,category_id,unit_label,sort_order,image_url').eq('brand_id', store.brand_id).eq('active', true).eq('customer_visible', true).order('sort_order'),
        sb.from('store_settings').select('ordering_enabled').eq('store_id', store.id).maybeSingle(),
        sb.from('business_periods').select('id,name,start_time,end_time,sort_order').eq('store_id', store.id).order('sort_order'),
      ])
      if (categoryResult.error || productResult.error || settingsResult.error || periodResult.error) throw categoryResult.error || productResult.error || settingsResult.error || periodResult.error
      const categories = categoryResult.data || [], products = productResult.data || [], periods = periodResult.data || []
      const productIds = products.map((product: any) => product.id)
      const { data: statuses } = productIds.length ? await sb.from('store_products').select('product_id,sale_status').eq('store_id', store.id).in('product_id', productIds) : { data: [] as any[] }
      const { data: links } = productIds.length ? await sb.from('product_option_groups').select('product_id,option_group_id').in('product_id', productIds) : { data: [] as any[] }
      const groupIds = [...new Set((links || []).map((link: any) => link.option_group_id))]
      const { data: groups } = groupIds.length ? await sb.from('option_groups').select('id,name,required,min_select,max_select').in('id', groupIds) : { data: [] as any[] }
      const { data: options } = groupIds.length ? await sb.from('options').select('id,option_group_id,name,price_delta,sort_order').in('option_group_id', groupIds).eq('active', true).order('sort_order') : { data: [] as any[] }
      const { data: rules } = productIds.length ? await sb.from('price_rules').select('product_id,name,price,start_time,end_time,days_of_week').eq('store_id', store.id).eq('active', true).in('product_id', productIds) : { data: [] as any[] }

      const local = new Date(new Date().toLocaleString('en-US', { timeZone: store.timezone || 'Asia/Tokyo' }))
      const nowMinutes = local.getHours() * 60 + local.getMinutes(), dayOfWeek = local.getDay()
      const activePeriod = periods.find((period: any) => {
        const start = minutes(period.start_time), end = minutes(period.end_time)
        return start !== null && end !== null && inPeriod(nowMinutes, start, end)
      })
      const orderingEnabled = settingsResult.data?.ordering_enabled !== false
      const statusMap = new Map((statuses || []).map((status: any) => [status.product_id, status.sale_status]))
      const menu = products.map((product: any) => {
        const rule = (rules || []).find((candidate: any) => {
          if (Number(candidate.product_id) !== Number(product.id)) return false
          const start = minutes(candidate.start_time), end = minutes(candidate.end_time)
          const timeOkay = start === null || end === null || inPeriod(nowMinutes, start, end)
          return (!candidate.days_of_week || candidate.days_of_week.includes(dayOfWeek)) && timeOkay
        })
        return {
          ...product,
          regular_price: product.base_price,
          price: rule?.price ?? product.base_price,
          price_type: rule ? 'happy_hour' : 'regular',
          price_rule: rule?.name ?? null,
          price_rule_start_time: rule?.start_time ?? null,
          price_rule_end_time: rule?.end_time ?? null,
          sale_status: statusMap.get(product.id) || 'available',
          option_group_ids: (links || []).filter((link: any) => link.product_id === product.id).map((link: any) => link.option_group_id),
        }
      })
      return out({
        brand: store.brands?.name,
        store: store.name,
        table_id: table.id,
        table: table.name,
        ordering: {
          enabled: orderingEnabled,
          is_open: Boolean(activePeriod),
          can_order: orderingEnabled && Boolean(activePeriod),
          current_period: activePeriod?.name || null,
          periods: periods.map((period: any) => ({ name: period.name, start_time: period.start_time, end_time: period.end_time })),
        },
        categories,
        products: menu,
        price_schedules: (rules || []).map((rule: any) => ({ name: rule.name, start_time: rule.start_time, end_time: rule.end_time, days_of_week: rule.days_of_week })),
        option_groups: (groups || []).map((group: any) => ({ ...group, options: (options || []).filter((option: any) => option.option_group_id === group.id) })),
      })
    }

    if (req.method === 'POST') {
      const items = Array.isArray(body.items) ? body.items : []
      if (!items.length) return out({ error: '商品が選択されていません' }, 400)
      const normalized = items.map((item: any) => ({
        product_id: Number(item.product_id),
        quantity: Math.max(1, Math.min(99, Number(item.quantity) || 1)),
        option_ids: Array.isArray(item.option_ids) ? item.option_ids.map(Number).filter(Boolean) : [],
      }))
      const requestId = String(body.request_id || '').replace(/^customer-/, '')
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return out({ error: '注文識別番号が無効です' }, 400)
      const { data, error } = await sb.rpc('place_customer_order_idempotent', { p_qr_token: token, p_items: normalized, p_client_order_key: requestId })
      if (error) {
        const message = String(error.message || '')
        if (message.includes('営業時間外')) return out({ error: '現在は営業時間外です' }, 409)
        if (message.includes('注文受付を停止')) return out({ error: '現在、注文受付を一時停止しています' }, 409)
        if (message.includes('売り切れ') || message.includes('販売停止') || message.includes('現在注文できません')) return out({ error: '売り切れ・販売停止の商品が含まれています' }, 409)
        if (message.includes('オプション') || message.includes('選択') || message.includes('商品')) return out({ error: message }, 400)
        throw error
      }
      return out({ ok: true, order_id: data.order_id, total: data.total, duplicate: Boolean(data.duplicate), message: 'ご注文を受け付けました' }, 201)
    }
    return out({ error: 'Method not allowed' }, 405)
  } catch (error) {
    console.error(error)
    return out({ error: 'システムエラーが発生しました' }, 500)
  }
})
