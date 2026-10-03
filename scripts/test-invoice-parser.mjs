import assert from 'node:assert/strict'
import { parseReceipt } from '../supabase/functions/receipt-api/parser.ts'
const invoice = parseReceipt('株式会社アオイ商店\n請求日 2026年09月30日\nご請求金額 ¥12,850\nお支払期日 2026年10月31日')
assert.equal(invoice.date, '2026-09-30')
assert.equal(invoice.amount, 12850)
assert.equal(invoice.vendor, '株式会社アオイ商店')
assert.equal(invoice.tax_category, 'unknown')
console.log('PASS invoice OCR suggestion stays provisional')
