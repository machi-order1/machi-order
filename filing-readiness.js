(() => {
  const $ = id => document.getElementById(id)
  const params = new URLSearchParams(location.search)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Tokyo', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date())
  $('store').value = String(window.MACHI_STORE_ID || params.get('store_id') || 1)
  $('year').value = params.get('year') || today.slice(0, 4)
  const token = () => localStorage.machi_access_token || localStorage.mo_staff_token || localStorage.access_token || localStorage.sb_access_token || ''
  const base = 'https://tejglrlkaqolbghoagqj.supabase.co/functions/v1/'
  const yen = n => '¥' + Number(n || 0).toLocaleString('ja-JP')
  async function api(name, extra = {}) {
    const query = new URLSearchParams({ store_id: $('store').value, ...extra })
    const response = await fetch(base + name + '?' + query, { headers: { Authorization: 'Bearer ' + token() } })
    const body = await response.json().catch(() => ({}))
    if (response.status === 401) { location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search)); throw Error('ログインし直してください') }
    if (!response.ok) throw Error(body.error || '取得できませんでした')
    return body
  }
  function render(items) {
    const parent = $('checks'); parent.replaceChildren()
    for (const item of items) {
      const row = document.createElement('div'), heading = document.createElement('b'), badge = document.createElement('span'), detail = document.createElement('div')
      row.className = 'check'; badge.className = 'tag ' + item.level
      badge.textContent = ({ action:'要確認', blocked:'未整備', unknown:'要確認', review:'確認' })[item.level] || '確認'
      heading.append(badge, document.createTextNode(item.label)); detail.textContent = item.detail; row.append(heading, detail)
      if (item.href) { const link = document.createElement('a'); link.href = item.href; link.textContent = '内容を見る →'; row.append(link) }
      parent.append(row)
    }
  }
  async function load() {
    if (!token()) { location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search)); return }
    const year = Number($('year').value)
    if (!Number.isInteger(year) || year < 2000 || year > 2100) { $('status').textContent = '年を確認してください'; return }
    $('refresh').disabled = true; $('status').className = 'muted'; $('status').textContent = '確認中…'; $('checks').textContent = '読み込み中…'
    try {
      const report = await api('financial-report-api', { year: String(year), span:'1' })
      const [receipt, invoice] = await Promise.all([api('receipt-api', { mode:'list' }).catch(() => null), api('invoice-api', { mode:'list' }).catch(() => null)])
      const x = report.selected || {}
      $('summary-heading').textContent = `${year}年・${$('store').selectedOptions[0].textContent}の記録`
      $('summary').textContent = Number(x.order_count) || Number(x.expense_count) || Number(x.closed_days) ? `会計済み売上 ${yen(x.sales)} ／ 登録経費 ${yen(x.expenses)} ／ 参考利益 ${yen(x.estimated_profit)}。売上のある月と記録のない月を確認してください。` : 'この年の売上・経費・日次締めは記録されていません。休業か未入力か確認してください。'
      render(window.MACHI_FILING_READINESS.checks(report, receipt, invoice, $('store').value))
      $('status').textContent = '更新 ' + new Date().toLocaleTimeString('ja-JP', { hour:'2-digit', minute:'2-digit' })
      $('back').href = '/manager.html?store_id=' + $('store').value
      $('source-link').href = '/journal-sources.html?store_id=' + $('store').value + '&month=' + year + '-01'
      const page = new URL(location.href); page.searchParams.set('store_id', $('store').value); page.searchParams.set('year', String(year)); history.replaceState(null, '', page)
    } catch (error) { $('status').className = 'muted error'; $('status').textContent = error.message; $('checks').textContent = '数字を確認できませんでした。更新してください。'; $('summary').textContent = '取得できません' }
    finally { $('refresh').disabled = false }
  }
  $('refresh').addEventListener('click', load)
  $('store').addEventListener('change', load)
  load()
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})
})()
