(() => {
  const $=id=>document.getElementById(id),params=new URLSearchParams(location.search)
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
  $('store').value=String(window.MACHI_STORE_ID||params.get('store_id')||1)
  $('year').value=params.get('year')||today.slice(0,4)
  $('plan-form').elements.start_on.value=today;$('plan-form').elements.end_on.value=today
  const token=()=>localStorage.machi_access_token||localStorage.mo_staff_token||localStorage.access_token||localStorage.sb_access_token||''
  const make=(tag,value)=>{const node=document.createElement(tag);node.textContent=value;return node}
  const yen=n=>'¥'+Number(n||0).toLocaleString('ja-JP')
  let serial=0,planKey=null,resultKey=null,selectedResult=null
  const endpoint=()=>`https://tejglrlkaqolbghoagqj.supabase.co/functions/v1/campaign-api?store_id=${encodeURIComponent($('store').value)}&year=${encodeURIComponent($('year').value)}`
  async function api(method='GET',body){
    const response=await fetch(endpoint(),{method,headers:{Authorization:'Bearer '+token(),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined})
    const data=await response.json().catch(()=>({}))
    if(response.status===401){location.replace('/login.html?next='+encodeURIComponent(location.pathname+location.search));throw Error('ログインし直してください')}
    if(!response.ok)throw Error(data.error||'処理できませんでした')
    return data
  }
  function outcomeForm(row){
    const form=make('form',''),grid=make('div',''),spend=make('input',''),note=make('textarea',''),button=make('button','結果を追記する'),status=make('p','')
    grid.className='grid';status.className='muted';spend.type='number';spend.min='0';spend.max='100000000';spend.step='1';spend.required=true;spend.value=row.result?.actual_spend_yen??'0'
    note.required=true;note.minLength=5;note.maxLength=1000;note.value=row.result?.outcome_note||''
    const first=make('label','実際に使った金額（円）'),second=make('label','結果メモ（来店の変化や現場の反応）');first.append(spend);second.append(note);grid.append(first,second)
    button.type='submit';form.append(grid,button,status)
    form.addEventListener('input',()=>{resultKey=null;selectedResult=row.id})
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(selectedResult!==row.id||!resultKey){resultKey=crypto.randomUUID();selectedResult=row.id}
      button.disabled=true;status.textContent='保存中…'
      try{await api('POST',{action:'outcome',campaign_id:row.id,actual_spend_yen:Number(spend.value),outcome_note:note.value,entry_key:resultKey});resultKey=null;status.textContent='結果を追記しました';await load()}
      catch(error){status.className='muted error';status.textContent=error.message}
      finally{button.disabled=false}
    })
    return form
  }
  function render(rows){
    const target=$('entries');target.replaceChildren()
    if(!rows.length){target.textContent='この年に記録した施策はありません。';return}
    const types={ad:'広告',coupon:'サービス券',event:'イベント',other:'その他'},weekdays=['すべて','月曜','火曜','水曜','木曜','金曜','土曜','日曜'],slots={all:'昼・夜',lunch:'昼',dinner:'夜'}
    for(const row of rows){
      const item=make('article',''),heading=make('h3',row.title),detail=make('p',`${types[row.campaign_type]||row.campaign_type} ／ ${row.start_on}〜${row.end_on} ／ ${weekdays[row.weekday_target]}・${slots[row.slot_target]} ／ 予定 ${yen(row.planned_budget_yen)}`),aim=make('p','狙い：'+row.hypothesis)
      item.className='entry';item.append(heading,detail,aim)
      if(row.result){const result=make('div',''),recorded=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(row.result.recorded_at)),record=make('p',`実費 ${yen(row.result.actual_spend_yen)} ／ ${recorded}に記録`),note=make('p',row.result.outcome_note);result.className='result';result.append(record,note);item.append(result)}
      const details=make('details',''),summary=make('summary',row.result?'結果を訂正・追記する':'実施後の結果を記録する');details.append(summary,outcomeForm(row));item.append(details);target.append(item)
    }
  }
  async function load(){
    const current=++serial,year=Number($('year').value)
    if(!Number.isInteger(year)||year<2000||year>2100){$('status').textContent='年を確認してください';return}
    if(!token()){location.replace('/login.html?next='+encodeURIComponent(location.pathname+location.search));return}
    $('refresh').disabled=true;$('status').className='muted';$('status').textContent='読み込み中…';$('entries').textContent='読み込み中…'
    try{const data=await api();if(current!==serial)return;render(data.campaigns||[])
      $('analysis').href=`/financial-analysis.html?store_id=${$('store').value}&year=${year}`;$('back').href='/manager.html?store_id='+$('store').value
      const page=new URL(location.href);page.searchParams.set('store_id',$('store').value);page.searchParams.set('year',String(year));history.replaceState(null,'',page)
      $('status').textContent='更新 '+new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})
    }catch(error){if(current===serial){$('status').className='muted error';$('status').textContent=error.message;$('entries').textContent='取得できませんでした'}}
    finally{if(current===serial)$('refresh').disabled=false}
  }
  $('plan-form').addEventListener('input',()=>{planKey=null})
  $('plan-form').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget,status=$('plan-status'),button=form.querySelector('button[type="submit"]')
    if(!planKey)planKey=crypto.randomUUID()
    const body={...Object.fromEntries(new FormData(form)),action:'plan',entry_key:planKey}
    button.disabled=true;status.className='muted';status.textContent='保存中…'
    try{await api('POST',body);planKey=null;$('year').value=body.start_on.slice(0,4);form.reset();form.elements.start_on.value=today;form.elements.end_on.value=today;form.elements.planned_budget_yen.value='0';status.textContent='施策を記録しました';await load()}
    catch(error){status.className='muted error';status.textContent=error.message}
    finally{button.disabled=false}
  })
  $('refresh').addEventListener('click',load);$('store').addEventListener('change',()=>{planKey=null;resultKey=null;load()});$('year').addEventListener('change',load)
  load();if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{})
})()
