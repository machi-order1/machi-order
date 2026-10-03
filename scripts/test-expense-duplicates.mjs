import assert from 'node:assert/strict'
import { matches } from '../supabase/functions/expense-duplicates-api/matcher.mjs'
const expense={id:1,date:'2026-10-02',amount:1000,vendor:'ABC 商店',receipt_import_id:10}
const invoice={id:2,date:'2026-10-03',amount:1000,vendor:'ＡＢＣ商店'}
const receipt={id:10,date:'2026-10-02',amount:1000,vendor:'ABC商店'}
const found=matches([expense],[invoice],[receipt])
assert.deepEqual(found.candidates.map(row=>row.kind),['expense_invoice','invoice_receipt'])
assert.equal(found.candidates[0].days,1)
assert.equal(matches([expense],[{...invoice,amount:1001}],[]).total,0)
assert.equal(matches([expense],[{...invoice,date:'2026-12-01'}],[]).total,0)
assert.equal(matches([expense],[{...invoice,vendor:'別店'}],[]).total,0)
assert.equal(matches([{...expense,receipt_import_id:null}],[],[receipt]).candidates[0].kind,'expense_receipt')
console.log('PASS expense/invoice/receipt candidate matching and linked receipt exclusion')
