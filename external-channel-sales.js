(() => {
  const $ = id => document.getElementById(id)
  const params = new URLSearchParams(location.search)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  $('store').value = String(window.MACHI_STORE_ID || params.get('store_id') || 1)
  $('month').value = params.get('month') || today.slice(0, 7)
  $('month').max = today.slice(0, 7)
  const form = $('form'), access = () => localStorage.machi_access_token || localStorage.mo_staff_token || localStorage.access_token || localStorage.sb_access_token || ''
  form.elements.business_date.max = today
  const yen = value => '¥' + Number(value || 0).toLocaleString('ja-JP')
  const node = (tag, value) => { const element = document.createElement(tag); element.textContent = value; return element }
  let rows = [], version = 0, entryKey = null, prepared = []
  const url = extra => 'https://tejglrlkaqolbghoagqj.supabase.co/functions/v1/financial-report-api?' + new URLSearchParams({ store_id: $('store').value, ...extra })
  function selectedRow() { return rows.find(row => row.date === form.elements.business_date.value && row.channel === form.elements.channel_code.value) }
  function warning() { const row = selectedRow(); $('pos-warning').textContent = row?.pos_orders ? `POS側にも${row.pos_orders}件・${yen(row.pos_sales)}の会計済み注文があります。報告値との重複と差額を照合してください。` : 'POS側にこのサービスの会計済み注文はありません。' }
  function fill(row, scroll = false) {
    if (row) { form.elements.channel_code.value = row.channel; form.elements.business_date.value = row.date }
    for (const name of ['order_count','gross_sales','platform_fee','payout_amount','source_ref','note']) form.elements[name].value = row?.[name] ?? (name === 'source_ref' || name === 'note' ? '' : 0)
    version = Number(row?.version || 0); entryKey = null
    form.querySelector('button[type="submit"]').textContent = row?.report_id ? '修正を保存' : '記録する'
    warning(); if (scroll) $('entry-section').scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  function render(data) {
    rows = data.rows || []; $('entry-section').hidden = !data.can_edit; $('csv-section').hidden = !data.can_edit
    $('back').href = '/manager.html?store_id=' + data.store_id
    const reported = rows.filter(row => row.report_id), pos = rows.filter(row => Number(row.pos_orders) > 0)
    $('overview').textContent = `${data.month}：サービス報告 ${reported.length}日分・${yen(reported.reduce((sum, row) => sum + Number(row.gross_sales || 0), 0))} ／ POS会計 ${pos.length}日分・${yen(pos.reduce((sum, row) => sum + Number(row.pos_sales || 0), 0))}。別々の集計で、加算していません。`
    const table = node('table',''), head = node('thead',''), body = node('tbody',''), headers = node('tr','')
    for (const label of ['営業日','サービス','報告売上','件数','手数料','入金額','POS売上','差額']) headers.append(node('th',label))
    head.append(headers)
    const visible = rows.filter(row => row.report_id || Number(row.pos_orders))
    for (const row of visible) {
      const tr = node('tr',''), first = node('td',''), button = node('button',row.date); button.type = 'button'; button.addEventListener('click', () => fill(row, true)); first.append(button); tr.append(first)
      const gap = row.report_id && Number(row.pos_orders) ? yen(Number(row.gross_sales) - Number(row.pos_sales)) : '—'
      for (const value of [row.channel === 'uber_eats' ? 'Uber Eats' : 'ロケットナウ',row.report_id ? yen(row.gross_sales) : '未入力',row.report_id ? String(row.order_count) : '—',row.report_id ? yen(row.platform_fee) : '—',row.report_id ? yen(row.payout_amount) : '—',Number(row.pos_orders) ? yen(row.pos_sales) : '記録なし',gap]) tr.append(node('td',value))
      body.append(tr)
    }
    if (!visible.length) { const tr = node('tr',''); tr.append(node('td','この月の報告・POS注文はまだありません')); body.append(tr) }
    table.append(head,body); $('rows').replaceChildren(table)
    const day = form.elements.business_date.value
    if (!day || !day.startsWith(data.month)) form.elements.business_date.value = data.month === today.slice(0,7) ? today : `${data.month}-01`
    fill(selectedRow())
  }
  async function load() {
    const token = access()
    if (!token) { location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search)); return }
    $('status').textContent = '集計中…'; $('status').className = 'muted'
    try {
      const response = await fetch(url({ mode: 'external', month: $('month').value }), { headers: { Authorization: 'Bearer ' + token } })
      const data = await response.json().catch(() => ({}))
      if (response.status === 401) { location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search)); return }
      if (!response.ok) throw Error(data.error || '取得できませんでした')
      render(data); $('status').textContent = '更新 ' + new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
      const page = new URL(location.href); page.searchParams.set('store_id', $('store').value); page.searchParams.set('month', $('month').value); history.replaceState(null,'',page)
      return true
    } catch (error) { $('status').textContent = error.message; $('status').className = 'muted error'; return false }
  }
  $('refresh').addEventListener('click',load)
  $('month').addEventListener('change', () => { prepared = []; $('csv-preview').replaceChildren(); $('csv-import').hidden = true; $('csv-file').value = ''; load() })
  $('store').addEventListener('change', () => { localStorage.setItem('machi_store_id',$('store').value); location.href = '/external-channel-sales.html?store_id=' + $('store').value + '&month=' + $('month').value })
  form.elements.business_date.addEventListener('change', () => fill(selectedRow()))
  form.elements.channel_code.addEventListener('change', () => fill(selectedRow()))
  form.addEventListener('input', () => { entryKey = null })
  form.addEventListener('submit', async event => {
    event.preventDefault(); const status = $('save-status'), button = form.querySelector('button[type="submit"]')
    if (!entryKey) entryKey = crypto.randomUUID()
    const body = Object.fromEntries(new FormData(form)); Object.assign(body,{ action:'external_channel_day', expected_version:version, entry_key:entryKey })
    if (body.business_date.slice(0,7) !== $('month').value) { status.textContent = '表示月と営業日を揃えてください'; return }
    button.disabled = true; status.className = 'muted'; status.textContent = '保存中…'
    try {
      const response = await fetch(url({ mode:'external' }), { method:'POST', headers:{ Authorization:'Bearer ' + access(), 'Content-Type':'application/json' }, body:JSON.stringify(body) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw Error(result.error || '保存できませんでした')
      entryKey = null; if (await load()) status.textContent = '記録しました。POSとの差を確認してください。'
    } catch (error) { status.className = 'muted error'; status.textContent = error.message }
    finally { button.disabled = false }
  })
  $('template').addEventListener('click', () => {
    const blob = new Blob([window.MACHI_EXTERNAL_CSV.template], { type: 'text/csv;charset=utf-8' })
    const href = URL.createObjectURL(blob), anchor = document.createElement('a')
    anchor.href = href; anchor.download = `external-sales-${$('month').value}-template.csv`; anchor.click()
    setTimeout(() => URL.revokeObjectURL(href), 60000)
  })
  $('csv-file').addEventListener('change', async event => {
    const status = $('csv-status'), file = event.target.files?.[0]
    prepared = []; $('csv-import').hidden = true; $('csv-preview').replaceChildren()
    if (!file) return
    try {
      if (file.size > 1024 * 1024) throw Error('CSVは1MB以下にしてください')
      const existing = new Set(rows.filter(row => row.report_id).map(row => row.date + ':' + row.channel))
      prepared = window.MACHI_EXTERNAL_CSV.prepare(await file.text(), $('month').value, today, existing)
      const preview = node('table',''), head = node('thead',''), body = node('tbody',''), labels = node('tr','')
      for (const label of ['営業日','サービス','注文売上','件数','手数料','入金額','判定']) labels.append(node('th',label))
      head.append(labels)
      for (const row of prepared) {
        const tr = node('tr',''), pos = rows.find(item => item.date === row.business_date && item.channel === row.channel_code)
        for (const value of [row.business_date,row.channel_code === 'uber_eats' ? 'Uber Eats' : 'ロケットナウ',yen(row.gross_sales),String(row.order_count),yen(row.platform_fee),yen(row.payout_amount),row.existing ? '既存のため除外' : pos?.pos_orders ? '新規・POSと要照合' : '新規']) tr.append(node('td',value))
        body.append(tr)
      }
      preview.append(head,body); $('csv-preview').append(preview)
      const fresh = prepared.filter(row => !row.existing).length
      status.className = 'muted'; status.textContent = `新規 ${fresh}件、既存のため除外 ${prepared.length - fresh}件。内容を確認してください。`
      $('csv-import').hidden = !fresh
    } catch (error) { prepared = []; status.className = 'muted error'; status.textContent = error.message }
  })
  $('csv-import').addEventListener('click', async () => {
    const status = $('csv-status'), button = $('csv-import'), fresh = prepared.filter(row => !row.existing)
    button.disabled = true; let saved = 0, failure = ''
    try {
      for (const row of fresh) {
        status.textContent = `${fresh.length}件中 ${saved + 1}件目を登録中…`
        const body = { ...row, action:'external_channel_day', expected_version:0, entry_key:crypto.randomUUID() }
        delete body.existing
        const response = await fetch(url({ mode:'external' }), { method:'POST', headers:{ Authorization:'Bearer ' + access(), 'Content-Type':'application/json' }, body:JSON.stringify(body) })
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw Error(`${row.business_date} ${row.channel_code === 'uber_eats' ? 'Uber Eats' : 'ロケットナウ'}：${result.error || '登録できませんでした'}`)
        saved++
      }
    } catch (error) { failure = error.message }
    finally {
      await load(); prepared = []; $('csv-file').value = ''; $('csv-preview').replaceChildren(); button.hidden = true; button.disabled = false
      status.className = failure ? 'muted error' : 'muted'
      status.textContent = failure ? `${saved}件登録しました。残りはCSVを選び直して確認してください。${failure}` : `${saved}件登録しました。POSとの差を照合してください。`
    }
  })
  load()
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})
})()
