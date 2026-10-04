import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Content-Type':'application/json; charset=utf-8'}
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers})
const dateOK=(s:string)=>/^20\d{2}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s
const keyOK=(s:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
const days=(start:string,end:string)=>(Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000
Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response(null,{headers})
  if(!['GET','POST'].includes(request.method))return reply({error:'Method not allowed'},405)
  const params=new URL(request.url).searchParams,store=Number(params.get('store_id'))
  if(!Number.isSafeInteger(store)||store<1)return reply({error:'店舗を確認してください'},400)
  try{
    const url=Deno.env.get('SUPABASE_URL')!,auth=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:request.headers.get('Authorization')||''}}})
    const {data:{user}}=await auth.auth.getUser()
    if(!user)return reply({error:'ログインが必要です'},401)
    const db=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const {data:member,error:memberError}=await db.from('store_memberships').select('role').eq('store_id',store).eq('user_id',user.id).eq('active',true).maybeSingle()
    if(memberError)throw memberError
    if(!member||!['owner','admin','manager'].includes(member.role))return reply({error:'店長権限が必要です'},403)
    if(request.method==='GET'){
      const year=Number(params.get('year'))
      if(!Number.isInteger(year)||year<2000||year>2100)return reply({error:'年を確認してください'},400)
      const {data:campaigns,error}=await db.from('management_campaigns').select('id,title,campaign_type,start_on,end_on,weekday_target,slot_target,planned_budget_yen,hypothesis,created_at')
        .eq('store_id',store).gte('start_on',`${year}-01-01`).lt('start_on',`${year+1}-01-01`).order('start_on',{ascending:false}).limit(501)
      if(error)throw error
      if((campaigns||[]).length>500)return reply({error:'この年の施策が多いため、一覧を正確に表示できません'},422)
      const ids=(campaigns||[]).map(row=>row.id)
      const results=ids.length?await db.from('management_campaign_results').select('id,campaign_id,actual_spend_yen,outcome_note,recorded_at').eq('store_id',store).in('campaign_id',ids).order('id',{ascending:false}).limit(1001):{data:[],error:null}
      if(results.error)throw results.error
      if((results.data||[]).length>1000)return reply({error:'結果の履歴が多いため、一覧を正確に表示できません'},422)
      const latest=new Map();for(const row of results.data||[])if(!latest.has(row.campaign_id))latest.set(row.campaign_id,row)
      return reply({store_id:store,year,campaigns:(campaigns||[]).map(row=>({...row,result:latest.get(row.id)||null})),basis:'manager_entered_plan_and_outcome_no_attributed_sales_lift'})
    }
    const body=await request.json().catch(()=>({})),action=String(body.action||'plan'),key=String(body.entry_key||'')
    if(!keyOK(key))return reply({error:'登録キーを確認してください'},400)
    if(action==='plan'){
      const title=String(body.title||'').trim(),type=String(body.campaign_type||''),start=String(body.start_on||''),end=String(body.end_on||''),slot=String(body.slot_target||''),weekday=Number(body.weekday_target),budget=Number(body.planned_budget_yen),hypothesis=String(body.hypothesis||'').trim()
      if(title.length<2||title.length>120||!['ad','coupon','event','other'].includes(type)||!dateOK(start)||!dateOK(end)||days(start,end)<0||days(start,end)>90
        ||!['all','lunch','dinner'].includes(slot)||!Number.isInteger(weekday)||weekday<0||weekday>7||!Number.isSafeInteger(budget)||budget<0||budget>100000000||hypothesis.length<5||hypothesis.length>500)
        return reply({error:'施策名・期間・対象・予算・狙いを確認してください'},400)
      const payload={store_id:store,entry_key:key,title,campaign_type:type,start_on:start,end_on:end,slot_target:slot,weekday_target:weekday,planned_budget_yen:budget,hypothesis,created_by:user.id}
      const {data:previous,error:previousError}=await db.from('management_campaigns').select('id,title,campaign_type,start_on,end_on,slot_target,weekday_target,planned_budget_yen,hypothesis').eq('store_id',store).eq('entry_key',key).maybeSingle()
      if(previousError)throw previousError
      if(previous){const fields=['title','campaign_type','start_on','end_on','slot_target','weekday_target','planned_budget_yen','hypothesis'];if(fields.some(field=>previous[field]!==payload[field]))return reply({error:'同じ登録キーに異なる施策は保存できません'},409);return reply({id:previous.id,saved:true,replayed:true})}
      const {data,error}=await db.from('management_campaigns').insert(payload).select('id').single()
      if(error){if(error.code==='23505')return reply({error:'同じ施策の登録を確認してください'},409);throw error}
      return reply({id:data.id,saved:true})
    }
    if(action==='outcome'){
      const id=Number(body.campaign_id),spend=Number(body.actual_spend_yen),note=String(body.outcome_note||'').trim()
      if(!Number.isSafeInteger(id)||id<1||!Number.isSafeInteger(spend)||spend<0||spend>100000000||note.length<5||note.length>1000)return reply({error:'施策・実費・結果メモを確認してください'},400)
      const {data:campaign,error:campaignError}=await db.from('management_campaigns').select('id,start_on').eq('store_id',store).eq('id',id).maybeSingle()
      if(campaignError)throw campaignError
      if(!campaign)return reply({error:'施策が見つかりません'},404)
      const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
      if(campaign.start_on>today)return reply({error:'施策開始後に結果を記録してください'},409)
      const {data:previous,error:previousError}=await db.from('management_campaign_results').select('id,campaign_id,actual_spend_yen,outcome_note').eq('store_id',store).eq('entry_key',key).maybeSingle()
      if(previousError)throw previousError
      if(previous){if(previous.campaign_id!==id||Number(previous.actual_spend_yen)!==spend||previous.outcome_note!==note)return reply({error:'同じ登録キーに異なる結果は保存できません'},409);return reply({id:previous.id,saved:true,replayed:true})}
      const {data,error}=await db.from('management_campaign_results').insert({campaign_id:id,store_id:store,entry_key:key,actual_spend_yen:spend,outcome_note:note,recorded_by:user.id}).select('id').single()
      if(error){if(error.code==='23505')return reply({error:'結果の登録を確認してください'},409);throw error}
      return reply({id:data.id,saved:true})
    }
    return reply({error:'操作が見つかりません'},404)
  }catch(error){console.error(error);return reply({error:'施策を処理できませんでした'},500)}
})
