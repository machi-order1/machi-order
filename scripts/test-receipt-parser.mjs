import assert from 'node:assert/strict'
import { parseReceipt } from '../supabase/functions/receipt-api/parser.ts'
const utilities = parseReceipt('電気料金のお知らせ\n2026年10月2日\n九州電力\n小計 2,500円\n消費税 250円\n合計 ￥2,750')
assert.equal(utilities.date, '2026-10-02')
assert.equal(utilities.amount, 2750)
assert.equal(utilities.category, '水道光熱費')
assert.equal(utilities.tax_category, 'unknown')
const food = parseReceipt('業務用食品\n2026/08/31\n食材 4,000\n合計 4,000円')
assert.equal(food.category, null)
assert(food.flags.some(flag => flag.includes('在庫')))
const missing = parseReceipt('手書きの領収書\n領収金額 不鮮明')
assert.equal(missing.amount, null)
assert(missing.flags.some(flag => flag.includes('税込合計')))
console.log('PASS receipt date, total, category, inventory caution and missing fields')
