import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { matches } from './matcher.mjs'

const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'GET,OPTIONS','Content-Type':'application/json; charset=utf-8'}
const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers})
Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response(null,{headers})
  if(request.method!=='GET')return reply({error:'Method not allowed'},405)
  const params=new URL(request.url).searchParams,store=Number(params.get('store_id')),month=params.get('month')||''
  if(!Number.isSafeInteger(store)||store<1||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))return reply({error:'店舗と月を確認してください'},400)
  try{
    const url=Deno.env.get('SUPABASE_URL')!,auth=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:request.headers.get('Authorization')||''}}})
    const {data:{user}}=await auth.auth.getUser()
    if(!user)return reply({error:'ログインが必要です'},401)
    const db=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const {data:member,error:memberError}=await db.from('store_memberships').select('role').eq('store_id',store).eq('user_id',user.id).eq('active',true).maybeSingle()
    if(memberError)throw memberError
    if(!member||!['owner','admin','manager'].includes(member.role))return reply({error:'店長権限が必要です'},403)
    const start=month+'-01',next=new Date(start+'T12:00:00Z');next.setUTCMonth(next.getUTCMonth()+1)
    const end=next.toISOString().slice(0,10),earlier=new Date(start+'T12:00:00Z');earlier.setUTCDate(earlier.getUTCDate()-31)
    const from=earlier.toISOString().slice(0,10),later=new Date(end+'T12:00:00Z');later.setUTCDate(later.getUTCDate()+31)
    const through=later.toISOString().slice(0,10)
    async function all(query:()=>any){
      const rows:any[]=[]
      for(let offset=0;offset<=2000;offset+=1000){
        const {data,error}=await query().range(offset,offset+999)
        if(error)throw error
        rows.push(...(data||[]))
        if(!data||data.length<1000)return rows
      }
      throw Error('too_many_records')
    }
    // Include 31 days before the selected month for invoices issued before the purchase.
    const [expenseRows,invoiceRows,receiptRows]=await Promise.all([
      all(()=>db.from('store_expenses').select('id,expense_date,amount,vendor_name,receipt_import_id').eq('store_id',store).gte('expense_date',from).lt('expense_date',through).is('voided_at',null).order('id')),
      all(()=>db.from('supplier_invoices').select('id,invoice_date,amount,vendor_name,status').eq('store_id',store).gte('invoice_date',from).lt('invoice_date',through).neq('status','void').order('id')),
      all(()=>db.from('receipt_imports').select('id,created_at,purchased_at,total_amount,vendor_name,extraction_status,confirmed').eq('store_id',store).gte('created_at',from+'T00:00:00+09:00').lt('created_at',through+'T00:00:00+09:00').eq('confirmed',false).order('id'))
    ])
    const expenses=expenseRows.map(x=>({id:x.id,date:x.expense_date,amount:x.amount,vendor:x.vendor_name,receipt_import_id:x.receipt_import_id})),invoices=invoiceRows.map(x=>({id:x.id,date:x.invoice_date,amount:x.amount,vendor:x.vendor_name}))
    const jpDate=(date:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(date))
    const receipts=receiptRows.filter(x=>['needs_review','pending','failed'].includes(x.extraction_status)).map(x=>({id:x.id,date:x.purchased_at?jpDate(x.purchased_at):null,amount:x.total_amount,vendor:x.vendor_name}))
    const result=matches(expenses,invoices,receipts,month)
    return reply({store_id:store,month,candidates:result.candidates,limited:result.limited,total_candidates:result.total,basis:'same_store_amount_vendor_within_31_days_review_candidates_only',receipt_scope:'unconfirmed_photos_created_in_31_day_window_around_month'})
  }catch(error){console.error(error);return reply({error:'重複候補を正確に取得できませんでした'},500)}
})
