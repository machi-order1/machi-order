(() => {
  const $ = id => document.getElementById(id)
  const yen = value => '¥' + Number(value || 0).toLocaleString('ja-JP')
  const params = new URLSearchParams(location.search)
  const currentYear = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric' }).format(new Date())
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  let span = [1, 5, 10].includes(Number(params.get('span'))) ? Number(params.get('span')) : 5
  let report = null, entryKey = null
  $('store').value = String(window.MACHI_STORE_ID || 1)
  $('year').value = params.get('year') || currentYear
  $('expense-form').elements.expense_date.value = today
  const access = () => localStorage.machi_access_token || localStorage.mo_staff_token || localStorage.access_token || localStorage.sb_access_token || ''
  const endpoint = extra => 'https://tejglrlkaqolbghoagqj.supabase.co/functions/v1/financial-report-api?' + new URLSearchParams({ store_id: $('store').value, year: $('year').value, span: String(span), ...extra })
  const hasData = x => Boolean(x.order_count || x.expense_count || x.closed_days || Number(x.labor))
  const element = (tag, className, value) => { const node = document.createElement(tag); if (className) node.className = className; if (value !== undefined) node.textContent = value; return node }
  const link = (path, month) => path + '?store_id=' + $('store').value + (month ? '&month=' + month : '')
  const percentage = (a, b) => b > 0 ? Math.round((a / b - 1) * 1000) / 10 : null
  function line(parent, label, value, className = '') {
    const row = element('div', 'line ' + className), name = element('span', '', label), amount = element('b', '', value)
    row.append(name, amount); parent.append(row)
  }
  function metric(label, value) {
    const box = element('div', 'stat'), name = element('small', '', label), amount = element('b', '', value)
    box.append(name, amount); return box
  }
  function pill(label, value) {
    const box = element('div', 'pill'), name = element('span', '', label + ' '), amount = element('b', '', value)
    box.append(name, amount); return box
  }
  function renderGuidance(data) {
    const parent = $('guidance'); parent.replaceChildren()
    const destinations = { sales: '/sales-report.html?store_id=' + data.store_id, cost: '/cost-editor.html?store_id=' + data.store_id, labor: '/labor-dashboard.html?store_id=' + data.store_id, closing: '/closing.html?store_id=' + data.store_id, expenses: '#checks', comparison: '#comparison-section' }
    for (const advice of data.guidance || []) {
      const box = element('article', 'guide' + (advice.priority === 'high' ? ' high' : ''))
      box.append(element('h3', '', advice.title), element('div', 'muted', advice.evidence), element('div', '', advice.next))
      const action = element('a', '', '確認する →'); action.href = destinations[advice.destination] || '#checks'; box.append(action); parent.append(box)
    }
  }
  function renderInsights(data) {
    const parent = $('insights'), x = data.selected, notes = []
    if (!hasData(x)) notes.push('この年はまだ記録がありません。売上と経費を入力すると、変化の理由を確認できます。')
    else {
      if (data.yoy_sales_percent !== null) notes.push(`完了した${data.yoy_completed_months}か月の売上は前年同期間比 ${data.yoy_sales_percent > 0 ? '+' : ''}${data.yoy_sales_percent}% です。`)
      else notes.push('比較できる前年の売上がないため、前年比は表示していません。')
      if (x.visit_count) notes.push(`売上 ${yen(x.sales)} は来店 ${x.visit_count}組、1組あたり ${yen(Math.round(x.sales / x.visit_count))} です。組数と単価を分けて見ると変化を追いやすくなります。`)
      const expenses = Object.entries(x.expense_categories || {}).sort((a, b) => Number(b[1]) - Number(a[1]))
      if (expenses.length) notes.push(`登録済みの経費では「${expenses[0][0]}」が最大で ${yen(expenses[0][1])}。経費全体は売上の ${x.sales ? Math.round(x.expenses / x.sales * 1000) / 10 : 0}% です。`)
    }
    parent.replaceChildren(...notes.map(note => element('p', 'insight', note)))
  }
  function renderYears(data) {
    const parent = $('year-chart'), max = Math.max(1, ...data.years.map(y => Number(y.sales)))
    parent.replaceChildren()
    for (const year of data.years) {
      const row = element('div', 'chartrow'), button = element('button', '', year.year + '年'), track = element('div', 'bar'), fill = element('i'), value = element('strong', '', year.has_data ? yen(year.sales) : '記録なし')
      button.type = 'button'; button.setAttribute('aria-label', year.year + '年の内訳を表示')
      button.addEventListener('click', () => { $('year').value = String(year.year); load(); window.scrollTo({ top: 0, behavior: 'smooth' }) })
      fill.style.width = year.has_data ? Math.max(2, year.sales / max * 100) + '%' : '0%'
      track.append(fill); row.append(button, track, value)
      if (year.has_data) row.append(element('span', 'muted', '参考利益 ' + yen(year.estimated_profit)))
      parent.append(row)
    }
  }
  function renderMonths(data) {
    const parent = $('months'); parent.replaceChildren()
    for (const item of data.months) {
      const row = element('tr'), first = element('td'), button = element('button', '', Number(item.month.slice(5, 7)) + '月')
      button.type = 'button'; button.addEventListener('click', () => { location.href = link('/sales-report.html', item.month.slice(0, 7)) })
      first.append(button); row.append(first)
      const shown = hasData(item)
      for (const value of [shown ? yen(item.sales) : '記録なし', shown ? yen(item.expenses) : '—', shown ? yen(item.estimated_profit) : '—']) row.append(element('td', '', value))
      parent.append(row)
    }
    $('monthly-heading').textContent = data.year + '年の月ごとの動き'
  }
  function renderCategories(data) {
    const parent = $('categories'), values = Object.entries(data.selected.expense_categories || {}).sort((a, b) => Number(b[1]) - Number(a[1]))
    parent.replaceChildren()
    if (!values.length) { parent.append(element('p', 'muted', '経費の記録がまだありません。')); return }
    const max = Math.max(1, ...values.map(x => Number(x[1])))
    for (const [name, value] of values) {
      line(parent, name, yen(value))
      const track = element('div', 'expensebar'), fill = element('i'); fill.style.width = (Number(value) / max * 100) + '%'; track.append(fill); parent.append(track)
    }
  }
  function renderComparison() {
    const box = $('comparison'), month = $('compare-month').value, c = report?.comparisons?.find(x => x.month === month)
    box.replaceChildren()
    if (!c) return
    const list = element('div', 'comparelist')
    for (const year of c.history.filter(x => x.orders > 0)) {
      const item = element('div', 'compareitem'); item.append(element('small', '', `${year.year}年${Number(month)}月`), element('b', '', yen(year.sales)), element('span', 'muted', `${year.visits}組・${year.orders}件`)); list.append(item)
    }
    if (!list.childNodes.length) box.append(element('p', 'muted', 'この月の売上記録はまだありません。'))
    else box.append(list)
    if (!c.projection) { box.append(element('p', 'muted', '対象年と前年の同月売上が揃っていないため、次の年のシナリオは表示しません。')); return }
    const p = c.projection, result = element('div', 'forecast')
    result.append(element('h3', '', `${c.next_year}年${Number(month)}月の参考シナリオ`))
    line(result, '今年と同じ売上なら', yen(p.flat))
    line(result, '前年との差がもう一度続けば', yen(p.trend))
    if (p.visit_change_percent !== null) {
      line(result, '来店組数の前年比', `${p.visit_change_percent > 0 ? '+' : ''}${p.visit_change_percent}%`)
      line(result, '1組あたり売上', yen(p.average_visit_previous) + ' → ' + yen(p.average_visit_current))
    }
    result.append(element('p', 'muted small', '同月の2年分を単純に延長した参考シナリオです。価格変更や営業日数、販促は織り込んでいません。'))
    box.append(result)
  }
  function render(data) {
    report = data; const x = data.selected
    $('content').hidden = false
    $('export-section').hidden = !data.can_edit; $('expense-section').hidden = !data.can_edit
    $('headline').textContent = data.year + '年の売上'
    $('sales').textContent = hasData(x) ? yen(x.sales) : '記録なし'
    $('summary-pills').replaceChildren(pill('前年同期間比', data.yoy_sales_percent === null ? '比較データなし' : `${data.yoy_sales_percent > 0 ? '+' : ''}${data.yoy_sales_percent}%`), pill('参考利益', hasData(x) ? yen(x.estimated_profit) : '—'))
    $('no-data').hidden = hasData(x)
    $('metrics').replaceChildren(metric('来店組数', hasData(x) ? x.visit_count + '組' : '—'), metric('1組あたり売上', x.visit_count ? yen(Math.round(x.sales / x.visit_count)) : '—'), metric('注文数', hasData(x) ? x.order_count + '件' : '—'), metric('人件費率', x.sales ? x.labor_ratio + '%' : '—'), metric('経費', hasData(x) ? yen(x.expenses) : '—'), metric('売上のある月', data.months.filter(m => m.order_count > 0).length + 'か月'))
    renderGuidance(data); renderInsights(data); renderYears(data); renderMonths(data)
    const pl = $('pl'); pl.replaceChildren()
    for (const [label, value, bold] of [['売上（税込）', x.sales], ['商品原価の概算', -x.estimated_cogs], ['粗利益の参考値', x.estimated_gross_profit], ['人件費', -x.labor], ['販売手数料の概算', -x.channel_fees], ['経費', -x.expenses], ['廃棄', -x.waste], ['賄い・スタッフ消費', -x.staff_consumption], ['参考利益', x.estimated_profit, true]]) line(pl, label, yen(value), bold ? 'total' : '')
    renderCategories(data)
    const q = $('quality'); q.replaceChildren()
    for (const [label, number, unit] of [['原価未登録の商品明細', x.uncosted_items, '件'], ['締め済み営業日', x.closed_days, '日'], ['税区分が未確認の経費', x.unknown_tax_count, '件'], ['取引先が未記録の経費', x.missing_vendor_count, '件'], ['証憑が未連携の経費', x.missing_evidence_count, '件']]) q.append(element('span', '', `${label} ${number}${unit}`))
    const store = data.store_id
    $('back').href = '/manager.html?store_id=' + store
    $('daily').href = $('insight-daily').href = $('no-data-daily').href = '/sales-report.html?store_id=' + store
    renderComparison()
  }
  async function load() {
    const token = access()
    if (!token) { location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search)); return }
    const year = Number($('year').value)
    if (!Number.isInteger(year) || year < 2000 || year > 2100) { $('status').textContent = '年を確認してください'; return }
    const button = $('go'); button.disabled = true; $('status').className = 'muted'; $('status').textContent = '集計中…'; $('content').hidden = true
    try {
      const response = await fetch(endpoint(), { headers: { Authorization: 'Bearer ' + token } })
      const data = await response.json().catch(() => ({}))
      if (response.status === 401) { location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search)); return }
      if (!response.ok) throw Error(data.error || '集計に失敗しました')
      render(data)
      $('status').textContent = '更新 ' + new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
      const url = new URL(location.href); url.searchParams.set('store_id', $('store').value); url.searchParams.set('year', $('year').value); url.searchParams.set('span', span); history.replaceState(null, '', url)
    } catch (error) { $('status').className = 'muted error'; $('status').textContent = error.message }
    finally { button.disabled = false }
  }
  for (let month = 1; month <= 12; month++) {
    const option = document.createElement('option'); option.value = String(month).padStart(2, '0'); option.textContent = month + '月'; $('compare-month').append(option)
  }
  $('compare-month').value = params.get('compare_month') || String(Math.max(1, Number(today.slice(5, 7)) - 1)).padStart(2, '0')
  $('go').addEventListener('click', load)
  $('store').addEventListener('change', () => { localStorage.setItem('machi_store_id', $('store').value); load() })
  document.querySelectorAll('[data-span]').forEach(button => button.addEventListener('click', () => { span = Number(button.dataset.span); document.querySelectorAll('[data-span]').forEach(item => item.setAttribute('aria-pressed', String(item === button))); load() }))
  document.querySelector(`[data-span="${span}"]`).setAttribute('aria-pressed', 'true')
  $('compare-month').addEventListener('change', renderComparison)
  $('export').addEventListener('click', async () => {
    const status = $('export-status'); status.textContent = '明細を準備中…'
    try {
      const response = await fetch(endpoint({ span: '1', mode: 'export' }), { headers: { Authorization: 'Bearer ' + access() } })
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw Error(data.error || '出力できませんでした') }
      const blob = await response.blob(), url = URL.createObjectURL(blob), anchor = document.createElement('a')
      anchor.href = url; anchor.download = `financial-sources-store-${$('store').value}-${$('year').value}.csv`; anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 60000); status.textContent = 'CSVを保存しました'
    } catch (error) { status.className = 'muted error'; status.textContent = error.message }
  })
  $('expense-form').addEventListener('submit', async event => {
    event.preventDefault()
    const form = event.currentTarget, status = $('expense-status'), button = form.querySelector('button')
    if (!entryKey) entryKey = crypto.randomUUID()
    const data = Object.fromEntries(new FormData(form)); data.amount = Number(data.amount); data.entry_key = entryKey
    button.disabled = true; status.textContent = '保存中…'
    try {
      const response = await fetch(endpoint(), { method: 'POST', headers: { Authorization: 'Bearer ' + access(), 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw Error(result.error || '保存できませんでした')
      status.className = 'muted'; status.textContent = `経費を記録しました（ID ${result.id}）。領収書原本を保管してください。`
      if (data.expense_date.slice(0, 4) !== $('year').value) $('year').value = data.expense_date.slice(0, 4)
      entryKey = null; form.elements.name.value = ''; form.elements.amount.value = ''; form.elements.vendor_name.value = ''
      await load()
    } catch (error) { status.className = 'muted error'; status.textContent = error.message }
    finally { button.disabled = false }
  })
  load()
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})
})()
