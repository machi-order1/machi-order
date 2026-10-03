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
  function renderCurrentMonth(data) {
    const decision = data.current_month_decision, section = $('current-month-section')
    section.hidden = !decision
    if (!decision) return
    const box = $('current-month-decision'); box.replaceChildren()
    $('current-month-heading').textContent = `${decision.month}月の売上を早めに見る`
    const history = decision.history
    if (decision.reference === null) {
      box.append(element('p', 'muted', '前年・前々年の同月実績がまだ揃っていません。実績が蓄積されると、今月の先回り判断に使えます。'))
    } else {
      box.append(element('p', '', `${history[0].year}年 ${yen(history[0].sales)} → ${history[1].year}年 ${yen(history[1].sales)}（${decision.historical_change_percent > 0 ? '+' : ''}${decision.historical_change_percent}%）`))
      box.append(element('p', '', `今年の目安：前年と同じなら ${yen(decision.reference)} ／ 過去の変化が続けば ${yen(decision.trend)}`))
      if (decision.risk) box.append(element('p', 'insight', '売上が下がる可能性があります。今月のうちに客数と単価を確認し、施策を決めましょう。'))
    }
    if (decision.month_to_date !== null) {
      box.append(element('p', '', `${decision.as_of}までの会計済み売上 ${yen(decision.month_to_date)} ／ 暦日換算の月末参考値 ${yen(decision.simple_run_rate)}`))
      if (decision.gap_to_reference > 0) box.append(element('p', '', `前年同月の売上まで、単純換算であと ${yen(decision.gap_to_reference)}`))
    } else box.append(element('p', 'muted', '今月の会計済み売上はまだ記録されていません。'))
    if (decision.risk) for (const action of decision.actions) box.append(element('p', '', '・' + action))
    box.append(element('p', 'muted small', decision.note))
    const action = element('a', '', '日別売上で確認する →'); action.href = link('/sales-report.html', `${data.year}-${String(decision.month).padStart(2, '0')}`); box.append(action)
  }
  function renderPatterns(data, selectedChannel = 'all') {
    const parent = $('patterns'); parent.replaceChildren()
    const rows = data.rows || [], dayLabels = ['月','火','水','木','金','土','日']
    const channels = [['all','すべて'],['dine_in','店内'],['takeout','テイクアウト'],['uber_eats','Uber Eats'],['rocket_now','ロケットナウ'],['other','その他']]
    const monthly = rows.filter(row => row.dimension === 'month')
    const channelTotal = code => monthly.filter(row => row.channel_code === code).reduce((sum, row) => sum + Number(row.sales || 0), 0)
    const channelOrders = code => monthly.filter(row => row.channel_code === code).reduce((sum, row) => sum + Number(row.order_count || 0), 0)
    const rate = (value, days) => days ? Math.round(Number(value || 0) / days) : null
    const collect = (dimension, bucket) => {
      const group = rows.filter(row => row.dimension === dimension && Number(row.bucket) === bucket && (selectedChannel === 'all' || row.channel_code === selectedChannel))
      const days = Number(group[0]?.recorded_days || 0)
      return { days, lunch: rate(group.filter(row => row.slot === 'lunch').reduce((sum, row) => sum + Number(row.visit_count || 0), 0), days), dinner: rate(group.filter(row => row.slot === 'dinner').reduce((sum, row) => sum + Number(row.visit_count || 0), 0), days),
        visits: rate(group.reduce((sum, row) => sum + Number(row.visit_count || 0), 0), days), sales: rate(group.reduce((sum, row) => sum + Number(row.sales || 0), 0), days) }
    }
    const periods = [['weekday', dayLabels], ['month_part', ['月初（1〜10日）','中旬（11〜20日）','月末（21日以降）']]]
    if (data.from >= data.to_exclusive) { parent.append(element('p', 'muted', 'この年は完了した月がまだありません。')); return }
    parent.append(element('p', 'muted', `${data.from}〜${data.to_exclusive}の前日までを集計。来店組数と売上は記録のある日あたりの平均です。`))
    const channelCards = element('div', 'stats')
    for (const [code, label] of channels.slice(1, 5)) channelCards.append(metric(label, channelOrders(code) ? yen(channelTotal(code)) : '記録なし'))
    parent.append(channelCards)
    const buttons = element('div', 'range')
    for (const [code, label] of channels) {
      const button = element('button', '', label); button.type = 'button'; button.setAttribute('aria-pressed', String(code === selectedChannel))
      button.addEventListener('click', () => renderPatterns(data, code)); buttons.append(button)
    }
    parent.append(buttons)
    parent.append(element('p', 'muted', `以下は「${channels.find(([code]) => code === selectedChannel)?.[1]}」の内訳です。`))
    if (selectedChannel !== 'all' && !channelOrders(selectedChannel)) parent.append(element('p', 'muted', 'この販売方法の注文記録はありません。外部サービスの実績は連携・入力された注文だけが対象です。'))
    parent.append(element('h3', '', '月ごとの販売方法別売上'))
    const monthWrap = element('div', 'tablewrap'), monthTable = element('table'), monthHead = element('thead'), monthBody = element('tbody'), monthHeadRow = element('tr')
    for (const label of ['月','店内','テイクアウト','Uber Eats','ロケットナウ','その他']) monthHeadRow.append(element('th', '', label))
    monthHead.append(monthHeadRow)
    for (let month = 1; month <= 12; month++) {
      const entries = monthly.filter(row => Number(row.bucket) === month)
      if (!entries.some(row => Number(row.recorded_days))) continue
      const tr = element('tr'); tr.append(element('td', '', `${month}月`))
      for (const [code] of channels.slice(1)) tr.append(element('td', '', yen(entries.find(row => row.channel_code === code)?.sales)))
      monthBody.append(tr)
    }
    monthTable.append(monthHead, monthBody); monthWrap.append(monthTable); parent.append(monthWrap)
    for (const [dimension, labels] of periods) {
      parent.append(element('h3', '', dimension === 'weekday' ? '曜日ごと' : '月初・中旬・月末'))
      const wrap = element('div', 'tablewrap'), table = element('table'), head = element('thead'), body = element('tbody'), tr = element('tr')
      for (const label of ['区分','記録日数','昼の来店','夜の来店','来店合計','売上']) tr.append(element('th', '', label))
      head.append(tr)
      const group = labels.map((label, index) => ({ label, ...collect(dimension, index + 1) }))
      for (const item of group) {
        const row = element('tr')
        for (const value of [item.label, `${item.days}日`, item.lunch === null ? '—' : `${item.lunch}組/日`, item.dinner === null ? '—' : `${item.dinner}組/日`, item.visits === null ? '—' : `${item.visits}組/日`, item.sales === null ? '—' : `${yen(item.sales)}/日`]) row.append(element('td', '', value))
        body.append(row)
      }
      table.append(head, body); wrap.append(table); parent.append(wrap)
      const reliable = group.filter(item => item.days >= 4)
      if (reliable.length >= 2) {
        const high = reliable.reduce((a, b) => a.visits > b.visits ? a : b), low = reliable.reduce((a, b) => a.visits < b.visits ? a : b)
        if (high.visits > low.visits * 1.2) parent.append(element('p', 'insight', `${high.label}は${low.label}より1日あたりの来店組数が多い傾向です。少ない区分の営業時間・客層を確認し、告知やサービス券を試す対象を絞れます。`))
        if (dimension === 'weekday') for (const [slot, label] of [['lunch','昼'],['dinner','夜']]) {
          const busiest = reliable.reduce((a, b) => a[slot] > b[slot] ? a : b), quietest = reliable.reduce((a, b) => a[slot] < b[slot] ? a : b)
          if (busiest[slot] > quietest[slot] * 1.2) parent.append(element('p', 'muted', `${label}は${busiest.label}曜日が多く、${quietest.label}曜日が少ない傾向です。施策を試すなら少ない時間帯に絞り、値引き後の粗利を確認してください。`))
        }
      }
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
    renderCurrentMonth(data); renderGuidance(data); renderInsights(data); renderYears(data); renderMonths(data)
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
      $('patterns').textContent = '曜日・月内の動きを集計中…'
      try {
        const patternResponse = await fetch(endpoint({ mode: 'patterns' }), { headers: { Authorization: 'Bearer ' + token } })
        const patternData = await patternResponse.json().catch(() => ({}))
        if (!patternResponse.ok) throw Error(patternData.error || '曜日・月内の集計に失敗しました')
        if ($('store').value === String(data.store_id) && $('year').value === String(data.year)) renderPatterns(patternData)
      } catch (patternError) { $('patterns').textContent = patternError.message }
      $('status').textContent = '更新 ' + new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
      const url = new URL(location.href); url.searchParams.set('store_id', $('store').value); url.searchParams.set('year', $('year').value); url.searchParams.set('span', span); history.replaceState(null, '', url)
    } catch (error) { $('status').className = 'muted error'; $('status').textContent = error.message }
    finally { button.disabled = false }
  }
  for (let month = 1; month <= 12; month++) {
    const option = document.createElement('option'); option.value = String(month).padStart(2, '0'); option.textContent = month + '月'; $('compare-month').append(option)
  }
  $('compare-month').value = params.get('compare_month') || today.slice(5, 7)
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
