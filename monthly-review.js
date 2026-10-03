(() => {
  const $=id=>document.getElementById(id),params=new URLSearchParams(location.search)
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
  $('store').value=String(window.MACHI_STORE_ID||params.get('store_id')||1)
  $('month').value=params.get('month')||today.slice(0,7)
  const token=()=>localStorage.machi_access_token||localStorage.mo_staff_token||localStorage.access_token||localStorage.sb_access_token||''
  let serial=0
  async function api(name,store,month){
    const query=new URLSearchParams({store_id:store,month})
    if(name==='receipt-api'||name==='invoice-api')query.set('mode','list')
    const response=await fetch('https://tejglrlkaqolbghoagqj.supabase.co/functions/v1/'+name+'?'+query,{headers:{Authorization:'Bearer '+token()}})
    const body=await response.json().catch(()=>({}))
    if(response.status===401){location.replace('/login.html?next='+encodeURIComponent(location.pathname+location.search));throw Error('ログインし直してください')}
    if(!response.ok)throw Error(body.error||'取得できませんでした')
    return body
  }
  function render(items,store,month){
    const target=$('checks');target.replaceChildren()
    if(!items.length){const p=document.createElement('p');p.textContent='取得できた範囲に要確認項目はありません。';target.append(p)}
    for(const item of items){
      const row=document.createElement('div'),head=document.createElement('b'),badge=document.createElement('span'),detail=document.createElement('div'),link=document.createElement('a')
      row.className='check';badge.className='tag '+item.level;badge.textContent=item.level==='action'?'要確認':item.level==='unknown'?'取得・記録を確認':'参考確認'
      head.append(badge,document.createTextNode(item.count===null?item.label:`${item.label} ${item.count}件`))
      detail.textContent=item.detail;link.textContent='内容を見る →';link.href=item.path+'?store_id='+encodeURIComponent(store)+(item.path.includes('journal-sources')||item.path.includes('settlement-review')?'&month='+encodeURIComponent(month):'')
      row.append(head,detail,link);target.append(row)
    }
  }
  function renderDuplicates(data,store,month){
    const target=$('duplicates');target.replaceChildren()
    if(!data){target.textContent='重複候補を取得できませんでした。レシート・請求書画面で確認してください。';return}
    if(!data.candidates.length){target.textContent='取得できた記録に重複候補はありません。請求期間や取引先の表記が異なるものは検出できません。';return}
    const labels={expense_invoice:'登録経費と請求書',expense_receipt:'登録経費と未確認レシート',invoice_receipt:'請求書と未確認レシート'}
    for(const item of data.candidates){
      const row=document.createElement('div'),head=document.createElement('b'),detail=document.createElement('div'),a=document.createElement('a'),b=document.createElement('a')
      row.className='check';head.textContent=labels[item.kind]||'重複候補'
      detail.textContent=`${item.left.vendor} ／ ¥${Number(item.left.amount).toLocaleString('ja-JP')} ／ ${item.left.date} と ${item.right.date}（${item.days}日差）`
      const left=item.kind==='invoice_receipt'?'invoice-management.html':'journal-sources.html',right=item.kind==='expense_invoice'?'invoice-management.html':'receipt-capture.html'
      a.href=`/${left}?store_id=${store}`+(left==='journal-sources.html'?`&month=${month}`:'');a.textContent='一方の記録を見る →';b.href=`/${right}?store_id=${store}`;b.textContent='もう一方を見る →';b.style.marginLeft='12px'
      row.append(head,detail,a,b);target.append(row)
    }
    if(data.limited){const note=document.createElement('p');note.className='muted error';note.textContent='候補が100組を超えたため一部のみ表示しています。個別画面でも確認してください。';target.append(note)}
  }
  async function load(){
    const current=++serial,store=$('store').value,month=$('month').value
    if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)){$('status').textContent='月を確認してください';return}
    if(!token()){location.replace('/login.html?next='+encodeURIComponent(location.pathname+location.search));return}
    $('refresh').disabled=true;$('status').className='muted';$('status').textContent='確認中…';$('checks').textContent='読み込み中…';$('duplicates').textContent='読み込み中…'
    try{
      const [sources,settlements,receipt,invoice,duplicates]=await Promise.all([
        api('accounting-sources-api',store,month),api('settlement-api',store,month),
        api('receipt-api',store,month).catch(()=>null),api('invoice-api',store,month).catch(()=>null),api('expense-duplicates-api',store,month).catch(()=>null)
      ])
      if(current!==serial)return
      const result=window.MACHI_MONTHLY_REVIEW.checks(sources,settlements,receipt,invoice),s=result.summary
      $('summary').textContent=`締め済み ${s.closed_days}日 ／ 登録経費 ${s.expenses}件 ／ 有効な入金記録 ${s.settlements}件 ／ 要確認 ${s.unverified}項目。日次締めのない日をすべて休業日とは判定しません。`
      render(result.problems,store,month);$('note').textContent=result.note
      renderDuplicates(duplicates,store,month)
      $('source-link').href=`/journal-sources.html?store_id=${store}&month=${month}`;$('settlement-link').href=`/settlement-review.html?store_id=${store}&month=${month}`
      $('back').href='/manager.html?store_id='+store
      const page=new URL(location.href);page.searchParams.set('store_id',store);page.searchParams.set('month',month);history.replaceState(null,'',page)
      $('status').textContent='更新 '+new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})
    }catch(error){if(current!==serial)return;$('status').className='muted error';$('status').textContent=error.message;$('checks').textContent='月次の確認事項を取得できませんでした。更新してください。';$('duplicates').textContent='取得できませんでした';$('summary').textContent='取得できません';$('note').textContent=''}
    finally{if(current===serial)$('refresh').disabled=false}
  }
  $('refresh').addEventListener('click',load);$('month').addEventListener('change',load);$('store').addEventListener('change',load)
  load();if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{})
})()
