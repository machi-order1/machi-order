const assert = require('node:assert/strict')
const { prepare,template } = require('../settlement-csv.js')
const csv = template+'2026-10-02,PayPay,1200,abc,"手数料,差引前"\r\n'
const row = prepare(csv,'2026-10','2026-10-04')[0]
assert.equal(row.amount_yen,1200)
assert.equal(row.note,'手数料,差引前')
assert.equal(prepare(csv,'2026-10','2026-10-04',new Set(['2026-10-02:paypay:1200:abc']))[0].existing,true)
assert.throws(()=>prepare(csv,'2026-09','2026-10-04'),/入金日/)
assert.throws(()=>prepare(template+'2026-10-05,PayPay,1200,,\n','2026-10','2026-10-04'),/入金日/)
assert.throws(()=>prepare(csv+csv.slice(template.length),'2026-10','2026-10-04'),/重複/)
console.log('PASS settlement CSV date, duplicate, quoted note and existing-row checks')
