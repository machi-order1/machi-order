(() => {
  const $ = id => document.getElementById(id), params = new URLSearchParams(location.search)
  const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
  $('store').value = String(window.MACHI_STORE_ID || params.get('store_id') || 1)
  $('month').value = params.get('month') || today.slice(0,7)
  const token = () => localStorage.machi_access_token || localStorage.mo_staff_token || localStorage.access_token || localStorage.sb_access_token || ''
  const yen = n => '¥' + Number(n || 0).toLocaleString('ja-JP')
  const node = (tag, value) => { const el = document.createElement(tag); el.textContent = value; return el }
  function table(id, headers, rows, values) {
    const head = node('thead',''), body = node('tbody',''), tr = node('tr','')
    for (const h of headers) tr.append(node('th',h))
    head.append(tr)
    for (const item of rows) {
      const row = node('tr','')
      for (const value of values(item)) { const cell = node('td',value); if (String(value).startsWith('¥')) cell.className = 'amount'; row.append(cell) }
      body.append(row)
    }
    if (!rows.length) { const row = node('tr',''), cell = node('td','この月の記録はありません'); cell.colSpan = headers.length; row.append(cell); body.append(row) }
    const result = node('table',''); result.append(head,body); $(id).replaceChildren(result)
  }
  async function load() {
    if (!token()) { location.replace('/login.html?next='+encodeURIComponent(location.pathname+location.search)); return }
    const month = $('month').value
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) { $('status').textContent = '月を確認してください'; return }
    $('refresh').disabled = true; $('status').className = 'muted'; $('status').textContent = '確認中…'
    try {
      const query = new URLSearchParams({ store_id:$('store').value, month })
      const response = await fetch('https://tejglrlkaqolbghoagqj.supabase.co/functions/v1/accounting-sources-api?'+query,{headers:{Authorization:'Bearer '+token()}})
      const data = await response.json().catch(()=>({}))
      if (response.status === 401) { location.replace('/login.html?next='+encodeURIComponent(location.pathname+location.search)); return }
      if (!response.ok) throw Error(data.error || '取得できませんでした')
      const sales = data.sales_rows || [], expenses = data.expense_rows || []
      $('sales-summary').textContent = `${sales.length}日分 ／ ${yen(sales.reduce((sum,row)=>sum+Number(row.amount||0),0))}。仕訳への転記は行っていません。`
      $('expenses-summary').textContent = `${expenses.length}件 ／ ${yen(expenses.reduce((sum,row)=>sum+Number(row.amount||0),0))}。請求書・仕入との重複を確認してください。`
      table('sales',['営業日','売上','内容','確認'],sales,row=>[row.date,yen(row.amount),row.detail,row.changed_after_link?'元データ変更あり':row.linked_entry_id?'仕訳に紐付け済み':'未転記'])
      table('expenses',['日付','金額','内容・取引先','確認'],expenses,row=>[row.date,yen(row.amount),`${row.detail} ／ ${row.vendor||'取引先未入力'}`,row.changed_after_link?'元データ変更あり':row.linked_entry_id?'仕訳に紐付け済み':`${row.tax_category==='unknown'?'税区分未確認・':''}${row.has_receipt?'証憑あり':'証憑未連携'}・未転記`])
      $('status').textContent = '更新 '+new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})
      $('back').href = '/filing-readiness.html?store_id='+$('store').value+'&year='+month.slice(0,4)
      const page = new URL(location.href); page.searchParams.set('store_id',$('store').value); page.searchParams.set('month',month); history.replaceState(null,'',page)
    } catch (error) { $('status').className = 'muted error'; $('status').textContent = error.message; $('sales').textContent = $('expenses').textContent = '取得できませんでした'; $('sales-summary').textContent = $('expenses-summary').textContent = '' }
    finally { $('refresh').disabled = false }
  }
  $('refresh').addEventListener('click',load)
  $('store').addEventListener('change',load)
  $('month').addEventListener('change',load)
  load()
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{})
})()
