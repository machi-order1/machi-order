import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { parseReceipt } from '../receipt-api/parser.ts'
const H={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Content-Type':'application/json; charset=utf-8'}
const out=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:H})
const dateOK=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s
const mime=(b:Uint8Array)=>b[0]===255&&b[1]===216&&b[2]===255?'image/jpeg':b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71?'image/png':String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP'?'image/webp':null
Deno.serve(async r=>{
 if(r.method==='OPTIONS')return new Response(null,{headers:H})
 const q=new URL(r.url).searchParams,sid=Number(q.get('store_id')),mode=q.get('mode')||'list'
 if(!Number.isSafeInteger(sid)||sid<1)return out({error:'店舗を確認してください'},400)
 try{
  const url=Deno.env.get('SUPABASE_URL')!,authorization=r.headers.get('Authorization')||'',uc=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authorization}}}),{data:{user}}=await uc.auth.getUser()
  if(!user)return out({error:'ログインが必要です'},401)
  const db=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!),{data:m,error:me}=await db.from('store_memberships').select('role').eq('store_id',sid).eq('user_id',user.id).eq('active',true).maybeSingle()
  if(me)throw me
  if(!m||!['owner','admin','manager','staff','kitchen'].includes(m.role))return out({error:'店舗権限がありません'},403)
  const manager=['owner','admin','manager'].includes(m.role)
  if(r.method==='POST'&&mode==='scan'){
   const f=await r.formData(),file=f.get('image'),ocr=String(f.get('ocr_text')||'').slice(0,12000)
   if(!(file instanceof File)||file.size<100||file.size>5242880)return out({error:'5MB以下の写真を選んでください'},400)
   const bytes=new Uint8Array(await file.arrayBuffer()),type=mime(bytes);if(!type)return out({error:'JPEG、PNG、WebPの写真を選んでください'},400)
   const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('')
   const {data:duplicate,error:de}=await db.from('supplier_invoices').select('id').eq('store_id',sid).eq('image_sha256',sha).maybeSingle();if(de)throw de
   if(duplicate)return out({error:'同じ請求書の写真が登録済みです',duplicate_id:duplicate.id},409)
   const p=parseReceipt(ocr),match=ocr.normalize('NFKC').match(/(?:支払期限|お支払期限|振込期限|お支払期日|支払期日)[^\n]{0,30}?(20\d{2})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})/)
   const due=match?`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`:null
   let candidates: number[]=[]
   if(p.date&&p.amount){const {data:matches,error:matchError}=await db.from('supplier_invoices').select('id,vendor_name').eq('store_id',sid).eq('invoice_date',p.date).eq('amount',p.amount).neq('status','void').limit(20);if(matchError)throw matchError;candidates=(matches||[]).filter((x:any)=>!p.vendor||!x.vendor_name||x.vendor_name.normalize('NFKC').replace(/\s/g,'')===p.vendor.normalize('NFKC').replace(/\s/g,'')).map((x:any)=>x.id)}
   const path=`${sid}/invoices/${crypto.randomUUID()}.${type==='image/png'?'png':type==='image/webp'?'webp':'jpg'}`
   const {error:ue}=await db.storage.from('expense-receipts').upload(path,bytes,{contentType:type,upsert:false});if(ue)throw ue
   const {data,error}=await db.from('supplier_invoices').insert({store_id:sid,image_path:path,image_sha256:sha,created_by:user.id,ocr_text:ocr,vendor_name:p.vendor,invoice_date:p.date,amount:p.amount,due_date:due&&dateOK(due)?due:null}).select('id').single()
   if(error){await db.storage.from('expense-receipts').remove([path]);if(error.code==='23505')return out({error:'同じ請求書の写真が登録済みです'},409);throw error}
   return out({id:data.id,proposal:{...p,due_date:due},duplicate_candidates:candidates})
  }
  if(r.method==='GET'&&mode==='image'){
   const id=Number(q.get('id'));if(!Number.isSafeInteger(id))return out({error:'請求書を確認してください'},400)
   const {data,error}=await db.from('supplier_invoices').select('image_path,created_by').eq('store_id',sid).eq('id',id).single()
   if(error||!data||!manager&&data.created_by!==user.id)return out({error:'写真を開けません'},403)
   const {data:signed,error:se}=await db.storage.from('expense-receipts').createSignedUrl(data.image_path,60);if(se)throw se
   return out({url:signed.signedUrl})
  }
  if(r.method==='GET'&&mode==='list'){
   let query=db.from('supplier_invoices').select('id,created_by,created_at,vendor_name,invoice_number,invoice_date,due_date,amount,tax_category,status,paid_amount,note,ocr_text').eq('store_id',sid).order('created_at',{ascending:false}).limit(250)
   if(!manager)query=query.eq('created_by',user.id)
   const {data,error}=await query;if(error)throw error
   const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),rows=(data||[]).sort((a:any,b:any)=>{
    const rank=(x:any)=>x.status==='open'&&x.due_date<today?0:x.status==='draft'?1:x.status==='open'?2:3
    return rank(a)-rank(b)||b.created_at.localeCompare(a.created_at)
   })
   return out({manager,items:rows,limited:rows.length===250,overdue:rows.filter((x:any)=>x.status==='open'&&x.due_date<today).length,unpaid:rows.filter((x:any)=>x.status==='open').reduce((n:number,x:any)=>n+Number(x.amount-x.paid_amount),0),drafts:rows.filter((x:any)=>x.status==='draft').length})
  }
  if(!manager)return out({error:'店長権限が必要です'},403)
  if(r.method==='POST'&&mode==='confirm'){
   const b=await r.json(),id=Number(b.id),amount=Number(b.amount),date=String(b.invoice_date||''),due=String(b.due_date||''),vendor=String(b.vendor_name||'').trim(),tax=String(b.tax_category||'unknown')
   if(!Number.isSafeInteger(id)||!Number.isSafeInteger(amount)||amount<1||amount>100000000||!dateOK(date)||!dateOK(due)||due<date||!vendor||vendor.length>200||String(b.invoice_number||'').length>100||String(b.note||'').length>500||!['unknown','taxable_10','taxable_8','non_taxable','exempt','out_of_scope'].includes(tax))return out({error:'請求額・請求日・支払期限・取引先を確認してください'},400)
   const {data,error}=await db.rpc('confirm_supplier_invoice',{p_store_id:sid,p_id:id,p_user:user.id,p_vendor:vendor,p_number:String(b.invoice_number||''),p_invoice_date:date,p_due:due,p_amount:amount,p_tax:tax,p_note:String(b.note||''),p_allow_duplicate:b.allow_duplicate===true})
   if(error){if(String(error.message).includes('possible_duplicate'))return out({error:'同じ取引先・日付・金額の請求書があります。原本を確認してください',kind:'possible_duplicate'},409);throw error}
   return out({id:data,confirmed:true})
  }
  if(r.method==='POST'&&mode==='payment'){
   const b=await r.json(),id=Number(b.id),amount=Number(b.amount),date=String(b.paid_on||''),method=String(b.method||'').trim(),reference=String(b.reference||''),key=String(b.entry_key||'')
   if(!Number.isSafeInteger(id)||!Number.isSafeInteger(amount)||amount<1||amount>100000000||!dateOK(date)||!method||method.length>80||reference.length>200||!/^[0-9a-f-]{36}$/i.test(key))return out({error:'支払内容を確認してください'},400)
   const {data,error}=await db.rpc('record_supplier_payment',{p_store_id:sid,p_id:id,p_user:user.id,p_amount:amount,p_paid_on:date,p_method:method,p_reference:reference,p_key:key})
   if(error){if(String(error.message).includes('invalid_payment'))return out({error:'未払い残高を超えるか、既に支払済みです'},409);throw error}
   return out({id:data,recorded:true})
  }
  if(r.method==='GET'&&mode==='analysis'){
   const month=String(q.get('month')||'');if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return out({error:'月を確認してください'},400)
   const from=`${month}-01`,pd=new Date(`${from}T00:00:00Z`);pd.setUTCMonth(pd.getUTCMonth()-1);const prev=pd.toISOString().slice(0,7)+'-01',ed=new Date(`${from}T00:00:00Z`);ed.setUTCMonth(ed.getUTCMonth()+1);const end=ed.toISOString().slice(0,10)
   const [iv,orders]=await Promise.all([db.from('supplier_invoices').select('invoice_date,amount,status,vendor_name').eq('store_id',sid).gte('invoice_date',prev).lt('invoice_date',end).neq('status','void').limit(2000),db.from('orders').select('business_date,total').eq('store_id',sid).gte('business_date',prev).lt('business_date',end).eq('payment_status','paid').neq('status','cancelled').limit(10000)])
   if(iv.error||orders.error)throw iv.error||orders.error
   if((iv.data||[]).length===2000||(orders.data||[]).length===10000)return out({error:'明細が多く、この期間は正確に集計できません。期間を分けて確認してください'},422)
   const summary=(a:string,b:string)=>{const rows=(iv.data||[]).filter((x:any)=>x.status!=='draft'&&x.invoice_date>=a&&x.invoice_date<b),sales=(orders.data||[]).filter((x:any)=>x.business_date>=a&&x.business_date<b);return{invoice_total:rows.reduce((n:number,x:any)=>n+Number(x.amount||0),0),sales_total:sales.reduce((n:number,x:any)=>n+Number(x.total||0),0),invoice_count:rows.length}}
   const current=summary(from,end),previous=summary(prev,from),percent=(a:number,b:number)=>b?Math.round((a/b-1)*1000)/10:null,share=(x:any)=>x.sales_total?Math.round(x.invoice_total/x.sales_total*1000)/10:null
   const vendors=new Map<string,number>();for(const x of iv.data||[])if(x.invoice_date>=from&&x.invoice_date<end&&x.status!=='draft')vendors.set(x.vendor_name||'未確認',(vendors.get(x.vendor_name||'未確認')||0)+Number(x.amount||0))
   return out({month,current,previous,invoice_change_percent:percent(current.invoice_total,previous.invoice_total),sales_change_percent:percent(current.sales_total,previous.sales_total),invoice_to_sales_percent:share(current),previous_invoice_to_sales_percent:share(previous),top_vendors:[...vendors].sort((a,b)=>b[1]-a[1]).slice(0,5),truncated:(iv.data||[]).length===2000||(orders.data||[]).length===10000,basis:'請求日基準の請求額と会計済み税込売上の参考比較。仕入原価、消費税の控除、損益計算書には自動転記していません。'})
  }
  return out({error:'操作が見つかりません'},404)
 }catch(e){console.error(e);return out({error:'処理に失敗しました。もう一度お試しください'},500)}
})
