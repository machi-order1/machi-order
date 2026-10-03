(() => {
  const $ = id => document.getElementById(id), params = new URLSearchParams(location.search)
  const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
  $('store').value = String(window.MACHI_STORE_ID || params.get('store_id') || 1)
  $('month').value = params.get('month') || today.slice(0,7)
  $('form').elements.posted_on.value = today
  $('form').elements.posted_on.max = today
  const token = () => localStorage.machi_access_token || localStorage.mo_staff_token || localStorage.access_token || localStorage.sb_access_token || ''
  const base = 'https://tejglrlkaqolbghoagqj.supabase.co/functions/v1/'
  const yen = n => '¥'+Number(n||0).toLocaleString('ja-JP')
  const node = (tag,value) => { const el=document.createElement(tag); el.textContent=value; return el }
  let entries = [], prepared = [], manualKey = null
  function clearCsv() { prepared=[]; $('csv-import').disabled=true; $('csv-file').value=''; $('csv-preview').replaceChildren(); $('csv-status').textContent='店舗・月が変わったため、CSVを選び直してください。' }
  function endpoint(name) { return base+name+'?'+new URLSearchParams({ store_id:$('store').value,month:$('month').value }) }
  async function api(name, method='GET', body) {
    const response = await fetch(endpoint(name),{ method,headers:{ Authorization:'Bearer '+token(),...(body?{'Content-Type':'application/json'}:{}) },body:body?JSON.stringify(body):undefined })
    const data = await response.json().catch(()=>({}))
    if (response.status===401) { location.replace('/login.html?next='+encodeURIComponent(location.pathname+location.search)); throw Error('ログインし直してください') }
    if (!response.ok) { const error=Error(data.error||'処理できませんでした'); error.kind=data.kind; throw error }
    return data
  }
  function table(id, headers, rows, render) {
    const result=node('table',''), head=node('thead',''), body=node('tbody',''), first=node('tr','')
    for (const label of headers) first.append(node('th',label))
    head.append(first)
    for (const item of rows) body.append(render(item))
    if (!rows.length) { const tr=node('tr',''), cell=node('td','この月の記録はありません'); cell.colSpan=headers.length; tr.append(cell); body.append(tr) }
    result.append(head,body); $(id).replaceChildren(result)
  }
  function cells(values) { const tr=node('tr',''); for(const value of values) { const cell=node('td',value); if(String(value).startsWith('¥'))cell.className='amount'; tr.append(cell) } return tr }
  function render() {
    const active=entries.filter(row=>!row.voided_at), totals=new Map()
    for(const row of active) totals.set(row.channel_code,(totals.get(row.channel_code)||0)+Number(row.amount_yen))
    $('entries-summary').textContent=`有効 ${active.length}件。PayPay入金記録 ${yen(totals.get('paypay'))} ／ カード ${yen(totals.get('card'))} ／ 現金入金 ${yen(totals.get('cash_deposit'))} ／ その他 ${yen(totals.get('other'))}。`
    const labels={paypay:'PayPay',card:'カード',cash_deposit:'現金入金',other:'その他'}
    table('entries',['入金日','種別','金額','参照番号','状態'],entries,row=>{
      const tr=cells([row.posted_on,labels[row.channel_code]||row.channel_code,yen(row.amount_yen),row.source_ref||'—',row.voided_at?'取消済み：'+row.void_reason:'記録済み'])
      if(!row.voided_at) {const cell=tr.lastChild,button=node('button','取消');button.type='button';button.className='button secondary';button.style.marginLeft='8px';button.addEventListener('click',()=>voidEntry(row.id));cell.append(button)}
      return tr
    })
  }
  async function load() {
    if(!token()) { location.replace('/login.html?next='+encodeURIComponent(location.pathname+location.search)); return }
    $('status').className='muted'; $('status').textContent='読み込み中…'; $('refresh').disabled=true
    try {
      const data=await api('settlement-api'); entries=data.entries||[]; render()
      const source=await api('accounting-sources-api').catch(()=>null)
      if(source) {
        const cash=source.cash_rows||[], paypay=cash.reduce((sum,row)=>sum+Number(row.paypay_sales||0),0), paypayDeposits=entries.filter(row=>!row.voided_at&&row.channel_code==='paypay').reduce((sum,row)=>sum+Number(row.amount_yen),0)
        $('comparison').textContent=`締め済みの日のPayPay POS売上 ${yen(paypay)} ／ この月に記録したPayPay入金 ${yen(paypayDeposits)}。売上日と着金日が異なるため、差額の確定判定はしていません。銀行明細との照合は未完了です。`
      } else $('comparison').textContent='POS売上を取得できませんでした。入金記録は表示していますが、比較は未完了です。'
      $('back').href='/journal-sources.html?store_id='+$('store').value+'&month='+$('month').value
      const page=new URL(location.href);page.searchParams.set('store_id',$('store').value);page.searchParams.set('month',$('month').value);history.replaceState(null,'',page)
      $('status').textContent='更新 '+new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})
    } catch(error) { $('status').className='muted error';$('status').textContent=error.message;$('entries').textContent='取得できませんでした';$('comparison').textContent='取得できませんでした';entries=[] }
    finally { $('refresh').disabled=false }
  }
  async function voidEntry(id) {
    const reason=prompt('取消理由を5文字以上で入力してください')
    if(reason===null)return
    try {await api('settlement-api','POST',{action:'void',id,reason:reason.trim()});await load()}catch(error){$('status').className='muted error';$('status').textContent=error.message}
  }
  $('form').addEventListener('input',()=>{manualKey=null})
  $('form').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type="submit"]'),status=$('save-status')
    if(!form.elements.posted_on.value.startsWith($('month').value)) {status.textContent='表示月と入金日を揃えてください';return}
    if(!manualKey)manualKey=crypto.randomUUID()
    const body=Object.fromEntries(new FormData(form));Object.assign(body,{action:'save',entry_key:manualKey,allow_possible_duplicate:$('allow-duplicate').checked})
    button.disabled=true;status.className='muted';status.textContent='保存中…'
    try {await api('settlement-api','POST',body);manualKey=null;form.reset();form.elements.posted_on.value=today;status.textContent='記録しました。POS売上との関係を確認してください。';await load()}
    catch(error){status.className='muted error';status.textContent=error.message}
    finally{button.disabled=false}
  })
  $('template').addEventListener('click',()=>{
    const blob=new Blob([window.MACHI_SETTLEMENT_CSV.template],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=node('a','')
    link.href=url;link.download='入金明細_ひな形.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  })
  $('csv-file').addEventListener('change',async event=>{
    const file=event.target.files?.[0],status=$('csv-status');prepared=[];$('csv-import').disabled=true;$('csv-preview').replaceChildren()
    if(!file)return
    if(file.size>1048576){status.textContent='1MB以下のCSVを選んでください';return}
    try {
      const existing=new Set(entries.filter(row=>!row.voided_at).map(row=>[row.posted_on,row.channel_code,Number(row.amount_yen),row.source_ref||''].join(':')))
      prepared=window.MACHI_SETTLEMENT_CSV.prepare(await file.text(),$('month').value,today,existing)
      status.className='muted';status.textContent=`${prepared.length}行を確認。既存 ${prepared.filter(row=>row.existing).length}行は飛ばします。`
      table('csv-preview',['入金日','種別','金額','参照番号','扱い'],prepared,row=>cells([row.posted_on,row.channel_code,yen(row.amount_yen),row.source_ref||'—',row.existing?'登録済み・スキップ':'登録候補']))
      $('csv-import').disabled=prepared.every(row=>row.existing)
    }catch(error){status.className='muted error';status.textContent=error.message}
  })
  $('csv-import').addEventListener('click',async()=>{
    const button=$('csv-import'),status=$('csv-status');button.disabled=true;let count=0
    if(prepared.some(row=>!row.posted_on.startsWith($('month').value))) { clearCsv(); return }
    try {for(const [index,row] of prepared.entries()){
      if(row.existing)continue
      status.className='muted';status.textContent=`${index+1}/${prepared.length}行を登録中…`
      await api('settlement-api','POST',{...row,action:'save',entry_key:crypto.randomUUID()})
      count++
    }
      status.textContent=`${count}行を登録しました。`;prepared=[];$('csv-file').value='';$('csv-preview').replaceChildren();await load()
    }catch(error){status.className='muted error';status.textContent=`${count}行を登録後に停止：${error.message}。明細を確認し、CSVを選び直してください。`;await load()}
  })
  $('refresh').addEventListener('click',load);$('month').addEventListener('change',()=>{clearCsv();load()});$('store').addEventListener('change',()=>{clearCsv();load()})
  load()
  if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{})
})()
