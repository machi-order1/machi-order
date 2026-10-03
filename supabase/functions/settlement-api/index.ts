import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const headers = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'authorization,apikey,content-type', 'Access-Control-Allow-Methods':'GET,POST,OPTIONS', 'Content-Type':'application/json; charset=utf-8' }
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })
const validDate = (date: string) => /^20\d{2}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date+'T00:00:00Z')) && new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { headers })
  if (!['GET','POST'].includes(request.method)) return reply({ error:'Method not allowed' },405)
  try {
    const params = new URL(request.url).searchParams, storeId = Number(params.get('store_id'))
    if (!Number.isSafeInteger(storeId) || storeId<1) return reply({ error:'店舗を確認してください' },400)
    const url = Deno.env.get('SUPABASE_URL')!, authorization = request.headers.get('Authorization') || ''
    const auth = createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{ global:{ headers:{ Authorization:authorization } } })
    const { data:{ user } } = await auth.auth.getUser()
    if (!user) return reply({ error:'ログインが必要です' },401)
    const db = createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data:member,error:memberError } = await db.from('store_memberships').select('role').eq('user_id',user.id).eq('store_id',storeId).eq('active',true).maybeSingle()
    if (memberError) throw memberError
    if (!member || !['owner','admin','manager'].includes(member.role)) return reply({ error:'店長権限が必要です' },403)
    if (request.method==='GET') {
      const month = params.get('month') || ''
      if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) return reply({ error:'月を確認してください' },400)
      const start = month+'-01', next = new Date(start+'T12:00:00Z'); next.setUTCMonth(next.getUTCMonth()+1)
      const end = next.toISOString().slice(0,10), entries: any[] = []
      for (let offset=0;offset<=5000;offset+=1000) {
        const { data,error } = await db.from('settlement_entries').select('id,posted_on,channel_code,amount_yen,source_ref,note,voided_at,void_reason')
          .eq('store_id',storeId).gte('posted_on',start).lt('posted_on',end).order('id').range(offset,offset+999)
        if (error) throw error
        entries.push(...(data || []))
        if (!data || data.length<1000) return reply({ store_id:storeId,month,entries,basis:'statement_only_no_bank_verification_or_auto_post' })
      }
      return reply({ error:'明細が多く、この月を正確に表示できません' },422)
    }
    const body = await request.json().catch(() => ({})), action = String(body.action || 'save')
    if (action==='void') {
      const id = Number(body.id), reason = String(body.reason || '').trim()
      if (!Number.isSafeInteger(id) || id<1 || reason.length<5 || reason.length>500) return reply({ error:'対象と取消理由を確認してください' },400)
      const { data,error } = await db.from('settlement_entries').update({ voided_at:new Date().toISOString(),voided_by:user.id,void_reason:reason })
        .eq('id',id).eq('store_id',storeId).is('voided_at',null).select('id').maybeSingle()
      if (error) throw error
      if (!data) return reply({ error:'明細が見つからないか、すでに取消済みです' },409)
      return reply({ id,voided:true })
    }
    if (action!=='save') return reply({ error:'操作が見つかりません' },404)
    const date = String(body.posted_on || ''), channel = String(body.channel_code || ''), amount = Number(body.amount_yen)
    const reference = String(body.source_ref || '').trim(), note = String(body.note || '').trim(), key = String(body.entry_key || '')
    const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
    if (!validDate(date) || date>today || !['paypay','card','cash_deposit','other'].includes(channel)
      || !Number.isSafeInteger(amount) || amount<1 || amount>1000000000 || reference.length>120 || note.length>500
      || !/^[0-9a-f-]{36}$/i.test(key)) return reply({ error:'入金日・種別・金額・参照番号を確認してください' },400)
    const { data:previous,error:previousError } = await db.from('settlement_entries').select('id,posted_on,channel_code,amount_yen,source_ref,note,voided_at').eq('store_id',storeId).eq('entry_key',key).maybeSingle()
    if (previousError) throw previousError
    if (previous) {
      if (previous.posted_on!==date || previous.channel_code!==channel || Number(previous.amount_yen)!==amount || previous.source_ref!==reference || previous.note!==note) return reply({ error:'同じ登録キーで異なる明細は保存できません' },409)
      return reply({ id:previous.id,saved:true,replayed:true,voided:!!previous.voided_at })
    }
    const { data:candidates,error:candidateError } = await db.from('settlement_entries').select('id,source_ref')
      .eq('store_id',storeId).eq('posted_on',date).eq('channel_code',channel).eq('amount_yen',amount).is('voided_at',null).limit(20)
    if (candidateError) throw candidateError
    if (candidates?.length && body.allow_possible_duplicate!==true) return reply({ error:'同じ日・種別・金額の入金記録があります。明細を確認してください',kind:'possible_duplicate',candidate_ids:candidates.map(row=>row.id) },409)
    const { data:saved,error:saveError } = await db.from('settlement_entries').insert({ store_id:storeId,posted_on:date,channel_code:channel,amount_yen:amount,source_ref:reference,note,entry_key:key,created_by:user.id }).select('id').single()
    if (saveError) { if (saveError.code==='23505') return reply({ error:'同じ登録キーの明細があります。再表示して確認してください' },409); throw saveError }
    return reply({ id:saved.id,saved:true })
  } catch (error) { console.error(error); return reply({ error:'入金明細を処理できませんでした' },500) }
})
