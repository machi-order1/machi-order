(() => {
  const $ = id => document.getElementById(id)
  const params = new URLSearchParams(location.search)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const allowed = ['today','date','this_week','last_week','this_month','last_month','this_year','last_year']
  let range = allowed.includes(params.get('range')) ? params.get('range') : 'today', serial = 0
  $('store').value = String(window.MACHI_STORE_ID || params.get('store_id') || 1)
  $('date').value = params.get('date') || today
  const access = () => localStorage.machi_access_token || localStorage.mo_staff_token || localStorage.access_token || localStorage.sb_access_token || ''
  const yen = n => '¥' + Number(n || 0).toLocaleString('ja-JP')
  const node = (tag, content) => { const result = document.createElement(tag); result.textContent = content; return result }
  const sum = (rows, key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0)
  function table(parent, headings, rows) {
    parent.replaceChildren()
    const t = node('table', ''), thead = node('thead', ''), tbody = node('tbody', ''), tr = node('tr', '')
    for (const h of headings) tr.append(node('th', h))
    thead.append(tr)
    for (const values of rows) { const row = node('tr', ''); for (const value of values) row.append(node('td', value)); tbody.append(row) }
    t.append(thead, tbody); parent.append(t)
  }
  function draw(data, chosen) {
    const product = data.products.find(item => String(item.id) === String(chosen))
    $('content').hidden = false
    $('heading').textContent = product?.name || 'メニューを選んでください'
    $('period').textContent = `${data.from}〜${data.to_exclusive}の前日まで`
    $('quantity').textContent = product ? Number(product.quantity || 0).toLocaleString('ja-JP') : '—'
    $('amount').textContent = product ? yen(product.amount) : '—'
    const rows = data.daily || [], slots = [['lunch','昼'],['dinner','夜'],['other','その他']]
    table($('slots'), ['時間帯','販売数','明細金額'], slots.map(([key, label]) => { const hits = rows.filter(item => item.slot === key); return [label, `${sum(hits,'quantity').toLocaleString('ja-JP')}杯・点`, yen(sum(hits,'amount'))] }))
    const annual = ['this_year','last_year'].includes(data.range)
    $('detail-heading').textContent = annual ? '月ごとの動き' : data.range === 'today' || data.range === 'date' ? '時間帯ごとの売上' : '日ごとの動き'
    const buckets = new Map()
    for (const row of rows) {
      const key = annual ? row.date.slice(0, 7) : data.range === 'today' || data.range === 'date' ? slots.find(([slot]) => slot === row.slot)?.[1] || 'その他' : row.date
      const current = buckets.get(key) || { quantity: 0, amount: 0, lunch: { quantity: 0, amount: 0 }, dinner: { quantity: 0, amount: 0 }, other: { quantity: 0, amount: 0 } }
      const quantity = Number(row.quantity || 0), amount = Number(row.amount || 0)
      current.quantity += quantity; current.amount += amount
      current[row.slot].quantity += quantity; current[row.slot].amount += amount
      buckets.set(key, current)
    }
    const isDay = data.range === 'today' || data.range === 'date'
    const detailRows = [...buckets].sort(([a],[b]) => a.localeCompare(b)).map(([key, value]) => isDay
      ? [key, `${value.quantity.toLocaleString('ja-JP')}杯・点`, yen(value.amount)]
      : [key, `${value.lunch.quantity} / ${yen(value.lunch.amount)}`, `${value.dinner.quantity} / ${yen(value.dinner.amount)}`, `${value.other.quantity} / ${yen(value.other.amount)}`, `${value.quantity} / ${yen(value.amount)}`])
    table($('details'), isDay ? ['時間帯','販売数','明細金額'] : [annual ? '月' : '日付','昼 杯・点 / 金額','夜 杯・点 / 金額','その他 杯・点 / 金額','合計 杯・点 / 金額'], detailRows.length ? detailRows : [isDay ? ['記録なし','—','—'] : ['記録なし','—','—','—','—']])
    const alcohol = data.alcohol || []
    table($('alcohol'), ['アルコール','ハッピーアワーの杯数','それ以外の杯数','未判定'], alcohol.length
      ? alcohol.map(item => [item.name, `${Number(item.happy_quantity || 0)}杯`, `${Number(item.other_quantity || 0)}杯`, `${Number(item.unknown_quantity || 0)}杯`])
      : [['該当する商品なし','—','—','—']])
  }
  async function load() {
    const token = access()
    if (!token) { location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search)); return }
    const requestId = ++serial, selected = $('product').value || params.get('product_id') || ''
    $('date-label').hidden = range !== 'date'
    document.querySelectorAll('[data-range]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.range === range)))
    $('status').className = 'muted'; $('status').textContent = '集計中…'
    try {
      const query = new URLSearchParams({ store_id: $('store').value, mode: 'menu', range, date: $('date').value })
      if (selected) query.set('product_id', selected)
      const response = await fetch('https://tejglrlkaqolbghoagqj.supabase.co/functions/v1/financial-report-api?' + query, { headers: { Authorization: 'Bearer ' + token } })
      const data = await response.json().catch(() => ({}))
      if (requestId !== serial) return
      if (response.status === 401) { location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search)); return }
      if (!response.ok) throw Error(data.error || '取得できませんでした')
      const products = data.products || [], previous = $('product').value || params.get('product_id')
      let chosen = products.find(item => String(item.id) === String(previous))?.id
      if (!chosen) chosen = products.find(item => item.name === '博多油そば')?.id || products[0]?.id
      $('product').replaceChildren(...products.map(item => { const option = node('option', item.name); option.value = item.id; return option }))
      if (chosen) $('product').value = chosen
      if (chosen && String(chosen) !== String(selected)) { await load(); return }
      draw(data, chosen)
      $('status').textContent = `更新 ${new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`
      const url = new URL(location.href); url.searchParams.set('store_id', $('store').value); url.searchParams.set('range', range)
      if (chosen) url.searchParams.set('product_id', chosen)
      if (range === 'date') url.searchParams.set('date', $('date').value); else url.searchParams.delete('date')
      history.replaceState(null, '', url)
      $('back').href = '/manager.html?store_id=' + $('store').value
    } catch (error) { if (requestId === serial) { $('status').className = 'muted error'; $('status').textContent = error.message } }
  }
  $('store').addEventListener('change', () => { localStorage.setItem('machi_store_id', $('store').value); location.href = '/menu-sales.html?store_id=' + $('store').value + '&range=' + range })
  $('product').addEventListener('change', load)
  $('date').addEventListener('change', load)
  document.querySelectorAll('[data-range]').forEach(button => button.addEventListener('click', () => { range = button.dataset.range; load() }))
  load()
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})
})()
