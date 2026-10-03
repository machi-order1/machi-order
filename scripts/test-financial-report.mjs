import assert from 'node:assert/strict'
import { summarize, comparison, yearOverYear, guideBusiness, csvCell } from '../supabase/functions/financial-report-api/metrics.ts'

const row = (year, month, sales, orders = 1) => ({ month: `${year}-${String(month).padStart(2, '0')}-01`, sales, order_count: orders, visit_count: orders, guest_count: orders * 2,
  estimated_cogs: 20, uncosted_items: 1, labor: 10, expenses: 5, waste: 2, staff_consumption: 1, channel_fees: 3,
  expense_categories: { 家賃: 5 }, expense_count: 1, closed_days: 1, unknown_tax_count: 1, missing_vendor_count: 0, missing_evidence_count: 1 })
const rows = [row(2025, 8, 100), row(2026, 8, 120), row(2025, 9, 200), row(2026, 9, 300), row(2025, 10, 999)]
const august = comparison(rows, 2026, 8)
assert.equal(august.projection.flat, 120)
assert.equal(august.projection.trend, 140)
assert.equal(august.projection.change_percent, 20)
assert.equal(august.projection.visit_change_percent, 0)
assert.equal(august.projection.average_visit_current, 120)
assert.equal(comparison([row(2026, 8, 120)], 2026, 8).projection, null)
assert.equal(comparison([row(2025, 8, 100), row(2026, 8, 120, 0)], 2026, 8).projection, null)
const yoy = yearOverYear(rows, 2026, '2026-10-03')
assert.equal(yoy.months, 9)
assert.equal(yoy.percent, 40) // (120+300) vs (100+200); 2025 October is excluded
assert.equal(yearOverYear(rows, 2027, '2026-10-03').percent, null)
const total = summarize([row(2025, 8, 100), row(2025, 9, 200)])
assert.equal(total.sales, 300)
assert.equal(total.estimated_profit, 218)
assert.equal(total.expense_categories['家賃'], 10)
assert.equal(total.uncosted_items, 2)
assert(csvCell('=HYPERLINK("x")').startsWith('"\'='))
assert.equal(csvCell('123'), '"123"')
const empty = guideBusiness([], 2026, '2026-10-03')
assert.equal(empty[0].destination, 'sales')
const incomplete = guideBusiness(rows, 2026, '2026-10-03')
assert.equal(incomplete[0].destination, 'cost')
assert.equal(incomplete[1].destination, 'expenses')
const falling = [row(2025, 8, 200, 4), row(2026, 8, 100, 2)].map(item => ({ ...item, uncosted_items: 0, unknown_tax_count: 0, missing_evidence_count: 0 }))
assert(guideBusiness(falling, 2026, '2026-10-03').some(item => item.destination === 'comparison'))
console.log('PASS annual totals, prior-year periods, seasonal scenarios, missing data and CSV cells')
