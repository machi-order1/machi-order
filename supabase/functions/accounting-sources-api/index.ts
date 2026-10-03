import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const headers = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'authorization,apikey,content-type', 'Access-Control-Allow-Methods':'GET,OPTIONS', 'Content-Type':'application/json; charset=utf-8' }
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { headers })
  if (request.method !== 'GET') return reply({ error:'Method not allowed' }, 405)
  try {
    const params = new URL(request.url).searchParams, storeId = Number(params.get('store_id')), month = params.get('month') || ''
    if (!Number.isSafeInteger(storeId) || storeId < 1 || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) return reply({ error:'店舗と月を確認してください' }, 400)
    const start = `${month}-01`, endDate = new Date(`${start}T12:00:00Z`)
    endDate.setUTCMonth(endDate.getUTCMonth() + 1)
    const end = endDate.toISOString().slice(0, 10), authorization = request.headers.get('Authorization') || ''
    const url = Deno.env.get('SUPABASE_URL')!
    const auth = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
    const { data: { user } } = await auth.auth.getUser()
    if (!user) return reply({ error:'ログインが必要です' }, 401)
    const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: member, error: memberError } = await db.from('store_memberships').select('role').eq('user_id',user.id).eq('store_id',storeId).eq('active',true).maybeSingle()
    if (memberError) throw memberError
    if (!member || !['owner','admin','manager'].includes(member.role)) return reply({ error:'店長権限が必要です' }, 403)
    async function all(query: () => any) {
      const rows: any[] = []
      for (let offset=0; offset<=5000; offset+=1000) {
        const { data, error } = await query().range(offset,offset+999)
        if (error) throw error
        rows.push(...(data || []))
        if (!data || data.length<1000) return rows
      }
      throw Error('too_many_sources')
    }
    const [closings, expenses] = await Promise.all([
      all(() => db.from('daily_closings').select('id,business_date,net_sales,order_count,closed_at,cash_sales,paypay_sales,other_sales,cash_expected,cash_actual,cash_difference').eq('store_id',storeId).gte('business_date',start).lt('business_date',end).order('id')),
      all(() => db.from('store_expenses').select('id,expense_date,amount,category,name,vendor_name,tax_category,receipt_import_id').eq('store_id',storeId).gte('expense_date',start).lt('expense_date',end).is('voided_at',null).order('id')),
    ])
    const requests: Promise<any>[] = []
    for (const [kind, rows] of [['daily_closing',closings],['store_expense',expenses]] as const) {
      for (let i=0; i<rows.length; i+=500) {
        const ids = rows.slice(i,i+500).map(row => row.id)
        requests.push(db.from('accounting_source_links').select('source_kind,source_id,source_date,entry_id,source_amount_yen')
          .eq('source_kind',kind).in('source_id',ids).then(({ data,error }) => { if (error) throw error; return data || [] }))
      }
    }
    const links = (await Promise.all(requests)).flat()
    const linked = new Map(links.map(row => [`${row.source_kind}:${row.source_id}`, row]))
    const salesRows = closings.map(row => ({ kind:'daily_closing', id:row.id, date:row.business_date, amount:Number(row.net_sales), detail:`${row.order_count}件の会計済み注文`, linked_entry_id:linked.get(`daily_closing:${row.id}`)?.entry_id || null,
      changed_after_link:linked.has(`daily_closing:${row.id}`) && (Number(linked.get(`daily_closing:${row.id}`).source_amount_yen)!==Number(row.net_sales) || linked.get(`daily_closing:${row.id}`).source_date!==row.business_date) }))
    const expenseRows = expenses.map(row => ({ kind:'store_expense', id:row.id, date:row.expense_date, amount:Number(row.amount), detail:row.name, category:row.category, vendor:row.vendor_name, tax_category:row.tax_category, has_receipt:!!row.receipt_import_id,
      linked_entry_id:linked.get(`store_expense:${row.id}`)?.entry_id || null,
      changed_after_link:linked.has(`store_expense:${row.id}`) && (Number(linked.get(`store_expense:${row.id}`).source_amount_yen)!==Number(row.amount) || linked.get(`store_expense:${row.id}`).source_date!==row.expense_date) }))
    const cashRows = closings.map(row => ({ date:row.business_date, cash_sales:Number(row.cash_sales), paypay_sales:Number(row.paypay_sales), other_sales:Number(row.other_sales), cash_expected:Number(row.cash_expected), cash_actual:row.cash_actual === null ? null : Number(row.cash_actual), cash_difference:row.cash_difference === null ? null : Number(row.cash_difference) }))
    return reply({ store_id:storeId, month, sales_rows:salesRows, expense_rows:expenseRows, cash_rows:cashRows, bank_reconciled:false, can_post:false, basis:'draft_source_review_only_no_automatic_journal' })
  } catch (error) { console.error(error); return reply({ error:'元データを正確に取得できませんでした' }, 500) }
})
