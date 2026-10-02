export type Month = { month: string; sales: number; order_count: number; guest_count: number; estimated_cogs: number; uncosted_items: number; labor: number; expenses: number; waste: number; staff_consumption: number; channel_fees: number; expense_categories: Record<string, number>; expense_count: number; closed_days: number; unknown_tax_count: number; missing_vendor_count: number; missing_evidence_count: number }
const n = (x: unknown) => Number(x || 0)
const monthKey = (s: string) => s.slice(0, 7)
export function summarize(rows: Month[]) {
  const total = (key: keyof Month) => rows.reduce((sum, row) => sum + n(row[key]), 0)
  const categories: Record<string, number> = {}
  for (const row of rows) for (const [key, value] of Object.entries(row.expense_categories || {})) categories[key] = (categories[key] || 0) + n(value)
  const sales = total('sales'), cogs = total('estimated_cogs'), labor = total('labor'), expenses = total('expenses'), waste = total('waste'), staff = total('staff_consumption'), fees = total('channel_fees')
  const profit = sales - cogs - labor - expenses - waste - staff - fees
  return { sales, order_count: total('order_count'), guest_count: total('guest_count'), estimated_cogs: cogs, uncosted_items: total('uncosted_items'), labor, expenses, waste, staff_consumption: staff, channel_fees: fees,
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
    .map(row => ({ year: Number(row.month.slice(0, 4)), sales: n(row.sales), orders: n(row.order_count), expenses: n(row.expenses) }))
  const latest = history.find(row => row.year === year), previous = history.find(row => row.year === year - 1)
  const comparable = Boolean(latest?.orders && previous?.orders)
  return { month: key, history, next_year: year + 1, projection: comparable ? {
    flat: latest!.sales, trend: Math.max(0, 2 * latest!.sales - previous!.sales),
    change_percent: previous!.sales ? Math.round((latest!.sales / previous!.sales - 1) * 1000) / 10 : null,
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
