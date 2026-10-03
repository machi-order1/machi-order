export type Month = { month: string; sales: number; order_count: number; visit_count: number; guest_count: number; estimated_cogs: number; uncosted_items: number; labor: number; expenses: number; waste: number; staff_consumption: number; channel_fees: number; expense_categories: Record<string, number>; expense_count: number; closed_days: number; unknown_tax_count: number; missing_vendor_count: number; missing_evidence_count: number }
const n = (x: unknown) => Number(x || 0)
const monthKey = (s: string) => s.slice(0, 7)
export function summarize(rows: Month[]) {
  const total = (key: keyof Month) => rows.reduce((sum, row) => sum + n(row[key]), 0)
  const categories: Record<string, number> = {}
  for (const row of rows) for (const [key, value] of Object.entries(row.expense_categories || {})) categories[key] = (categories[key] || 0) + n(value)
  const sales = total('sales'), cogs = total('estimated_cogs'), labor = total('labor'), expenses = total('expenses'), waste = total('waste'), staff = total('staff_consumption'), fees = total('channel_fees')
  const profit = sales - cogs - labor - expenses - waste - staff - fees
  return { sales, order_count: total('order_count'), visit_count: total('visit_count'), guest_count: total('guest_count'), estimated_cogs: cogs, uncosted_items: total('uncosted_items'), labor, expenses, waste, staff_consumption: staff, channel_fees: fees,
    estimated_gross_profit: sales - cogs, estimated_profit: profit, margin: sales ? Math.round(profit / sales * 1000) / 10 : 0,
    labor_ratio: sales ? Math.round(labor / sales * 1000) / 10 : 0, expense_categories: categories,
    expense_count: total('expense_count'), closed_days: total('closed_days'), unknown_tax_count: total('unknown_tax_count'), missing_vendor_count: total('missing_vendor_count'), missing_evidence_count: total('missing_evidence_count') }
}
export const csvCell = (value: unknown) => {
  const raw = String(value ?? '')
  // Prevent spreadsheet formula execution when a vendor or note begins with a formula prefix.
  const safe = /^[\s]*[=+\-@\t\r]/.test(raw) && !/^-?\d+(\.\d+)?$/.test(raw) ? `'${raw}` : raw
  return `"${safe.replaceAll('"', '""')}"`
}
export function comparison(rows: Month[], year: number, month: number) {
  const key = String(month).padStart(2, '0')
  const history = rows.filter(row => monthKey(row.month).endsWith('-' + key))
    .map(row => ({ year: Number(row.month.slice(0, 4)), sales: n(row.sales), orders: n(row.order_count), visits: n(row.visit_count), guests: n(row.guest_count), expenses: n(row.expenses) }))
  const latest = history.find(row => row.year === year), previous = history.find(row => row.year === year - 1)
  const comparable = Boolean(latest?.orders && previous?.orders)
  return { month: key, history, next_year: year + 1, projection: comparable ? {
    flat: latest!.sales, trend: Math.max(0, 2 * latest!.sales - previous!.sales),
    change_percent: previous!.sales ? Math.round((latest!.sales / previous!.sales - 1) * 1000) / 10 : null,
    visit_change_percent: previous!.visits ? Math.round((latest!.visits / previous!.visits - 1) * 1000) / 10 : null,
    average_visit_current: latest!.visits ? Math.round(latest!.sales / latest!.visits) : null,
    average_visit_previous: previous!.visits ? Math.round(previous!.sales / previous!.visits) : null,
    method: '直近２回の同月実績を直線で延長した参考シナリオ',
  } : null }
}

export function yearOverYear(rows: Month[], year: number, today: string) {
  const currentYear = Number(today.slice(0, 4))
  const months = year < currentYear ? 12 : year === currentYear ? Number(today.slice(5, 7)) - 1 : 0
  const pick = (y: number) => summarize(rows.filter(row => Number(row.month.slice(0, 4)) === y && Number(row.month.slice(5, 7)) <= months))
  const latest = pick(year), previous = pick(year - 1)
  return { months, percent: latest.order_count && previous.order_count && previous.sales
    ? Math.round((latest.sales - previous.sales) / previous.sales * 1000) / 10 : null }
}
export type Guidance = { priority: 'high' | 'normal'; title: string; evidence: string; next: string; destination: 'sales' | 'cost' | 'labor' | 'closing' | 'expenses' | 'comparison' }

export function guideBusiness(rows: Month[], year: number, today: string): Guidance[] {
  const selected = summarize(rows.filter(row => Number(row.month.slice(0, 4)) === year))
  const items: Guidance[] = []
  if (!selected.order_count && !selected.expense_count && !selected.closed_days && !selected.labor) {
    return [{ priority: 'normal', title: 'まず記録を始める', evidence: '売上・経費・日次締めの記録がまだありません。', next: '今日の売上を確認し、経費を1件ずつ記録してください。', destination: 'sales' }]
  }
  if (selected.uncosted_items) items.push({ priority: 'high', title: '原価の抜けを埋める', evidence: `原価未登録の商品明細が${selected.uncosted_items}件あります。`, next: '商品原価を登録してから利益を見直してください。', destination: 'cost' })
  if (selected.unknown_tax_count || selected.missing_evidence_count) items.push({ priority: 'high', title: '経費の根拠をそろえる', evidence: `税区分未確認${selected.unknown_tax_count}件、証憑未連携${selected.missing_evidence_count}件。`, next: '領収書原本と経費の内容・税区分を照合してください。', destination: 'expenses' })
  const comparable = yearOverYear(rows, year, today)
  if (comparable.percent !== null && comparable.percent < -5) {
    const current = summarize(rows.filter(row => Number(row.month.slice(0, 4)) === year && Number(row.month.slice(5, 7)) <= comparable.months))
    const previous = summarize(rows.filter(row => Number(row.month.slice(0, 4)) === year - 1 && Number(row.month.slice(5, 7)) <= comparable.months))
    const visitChange = previous.visit_count ? Math.round((current.visit_count / previous.visit_count - 1) * 1000) / 10 : null
    const ticketCurrent = current.visit_count ? current.sales / current.visit_count : 0
    const ticketPrevious = previous.visit_count ? previous.sales / previous.visit_count : 0
    const ticketChange = ticketPrevious ? Math.round((ticketCurrent / ticketPrevious - 1) * 1000) / 10 : null
    const driver = visitChange !== null && (ticketChange === null || visitChange < ticketChange) ? '来店組数' : '1組あたり売上'
    items.push({ priority: 'normal', title: '売上が落ちた月を調べる', evidence: `完了月の売上は前年同期間比${comparable.percent}%。${driver}の変化が大きい傾向です。`, next: '同じ月の比較を開き、落ち込みが始まった月を確認してください。', destination: 'comparison' })
  }
  if (selected.sales > 0 && selected.estimated_profit < 0) {
    const largest = selected.labor >= selected.expenses ? '人件費とシフト' : '費目別の経費'
    items.push({ priority: 'normal', title: '赤字の内訳を確認する', evidence: `参考利益は¥${Math.round(selected.estimated_profit).toLocaleString('ja-JP')}です。`, next: `${largest}から金額と入力漏れを確かめてください。`, destination: selected.labor >= selected.expenses ? 'labor' : 'expenses' })
  }
  if (selected.order_count && !selected.closed_days) items.push({ priority: 'normal', title: '日次締めを残す', evidence: '売上はありますが、締め済み営業日の記録がありません。', next: '日次締めと現金差額を確認してください。', destination: 'closing' })
  if (!items.length) items.push({ priority: 'normal', title: '同じ月の推移を確認する', evidence: '現在の登録データで大きな欠落は検出されていません。', next: '前年の同月と組数・単価を比べてください。', destination: 'comparison' })
  return items.slice(0, 3)
}

export function annualView(rows: Month[], year: number, span: number, today: string) {
  const years = Array.from({ length: span }, (_, index) => {
    const y = year - span + 1 + index
    const summary = summarize(rows.filter(row => Number(row.month.slice(0, 4)) === y))
    return { year: y, ...summary, has_data: Boolean(summary.order_count || summary.expense_count || summary.closed_days || summary.labor) }
  })
  const months = rows.filter(row => Number(row.month.slice(0, 4)) === year).map(row => ({
    ...row,
    estimated_profit: n(row.sales) - n(row.estimated_cogs) - n(row.labor) - n(row.expenses) - n(row.waste) - n(row.staff_consumption) - n(row.channel_fees),
  }))
  const yoy = yearOverYear(rows, year, today)
  return { months, years, selected: summarize(months), comparisons: Array.from({ length: 12 }, (_, index) => comparison(rows, year, index + 1)),
    guidance: guideBusiness(rows, year, today), current_month_decision: currentMonthDecision(rows, year, today), yoy_sales_percent: yoy.percent, yoy_completed_months: yoy.months }
}

export function currentMonthDecision(rows: Month[], year: number, today: string) {
  if (year !== Number(today.slice(0, 4))) return null
  const month = Number(today.slice(5, 7)), day = Number(today.slice(8, 10))
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const get = (y: number) => rows.find(row => Number(row.month.slice(0, 4)) === y && Number(row.month.slice(5, 7)) === month)
  const earlier = get(year - 2), previous = get(year - 1), current = get(year)
  const valid = (row: Month | undefined) => Boolean(row && n(row.order_count) > 0)
  const history = [earlier, previous].map((row, index) => ({ year: year - 2 + index, sales: valid(row) ? n(row!.sales) : null,
    visits: valid(row) ? n(row!.visit_count) : null, average_visit: valid(row) && n(row!.visit_count) ? Math.round(n(row!.sales) / n(row!.visit_count)) : null }))
  const complete = valid(earlier) && valid(previous)
  const reference = complete ? n(previous!.sales) : null
  const trend = complete ? Math.max(0, 2 * n(previous!.sales) - n(earlier!.sales)) : null
  const historical_change_percent = complete && n(earlier!.sales) ? Math.round((n(previous!.sales) / n(earlier!.sales) - 1) * 1000) / 10 : null
  const month_to_date = valid(current) ? n(current!.sales) : null
  const simple_run_rate = month_to_date === null ? null : Math.round(month_to_date / day * days)
  const gap_to_reference = simple_run_rate === null || reference === null ? null : Math.max(0, reference - simple_run_rate)
  const visitsFell = complete && n(earlier!.visit_count) && n(previous!.visit_count) < n(earlier!.visit_count)
  const actions = visitsFell
    ? ['来店組数が減った可能性を確認。曜日・時間帯別の客数を見て、対象を絞った告知や再来店券を検討。', '販促費と値引きを決め、追加売上だけでなく粗利で効果を測る。']
    : ['曜日・時間帯別の来店組数と客単価を確認し、落ちている方に合わせて施策を選ぶ。', '告知・サービス券を試す場合は、費用と値引き後の粗利で効果を測る。']
  return { month, as_of: today, elapsed_days: day, days_in_month: days, history, month_to_date, simple_run_rate,
    reference, trend, historical_change_percent, gap_to_reference, risk: complete && (historical_change_percent! < -5 || (day >= 7 && simple_run_rate !== null && simple_run_rate < reference! * 0.9)),
    actions, note: '今月の見通しは暦日で単純換算した参考値です。曜日・営業日・イベント・予約・値上げを反映せず、月初は特に変動します。' }
}

export function menuDateRange(today: string, range: string, requestedDate: string) {
  const addDays = (date: string, count: number) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + count); return d.toISOString().slice(0, 10) }
  const firstMonth = today.slice(0, 7) + '-01'
  const weekStart = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7))
  let from = today, to = addDays(today, 1)
  if (range === 'date') { from = requestedDate; to = addDays(from, 1) }
  if (range === 'this_week') { from = weekStart; to = addDays(today, 1) }
  if (range === 'last_week') { from = addDays(weekStart, -7); to = weekStart }
  if (range === 'this_month') { from = firstMonth; to = addDays(today, 1) }
  if (range === 'last_month') { to = firstMonth; from = addDays(firstMonth, -1).slice(0, 7) + '-01' }
  if (range === 'this_year') { from = today.slice(0, 4) + '-01-01'; to = addDays(today, 1) }
  if (range === 'last_year') { const year = Number(today.slice(0, 4)); from = `${year - 1}-01-01`; to = `${year}-01-01` }
  return { from, to }
}
