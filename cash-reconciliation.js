(() => {
  const yen = n => '¥' + Math.abs(Number(n)).toLocaleString('ja-JP')
  function status(row) {
    if (row.cash_actual === null || row.cash_actual === undefined || row.cash_difference === null || row.cash_difference === undefined) return '実在高未入力・要確認'
    const expected = Number(row.cash_expected), actual = Number(row.cash_actual), difference = Number(row.cash_difference)
    if (![expected,actual,difference].every(Number.isSafeInteger) || actual - expected !== difference) return '現金差額の記録を確認'
    return difference === 0 ? '現金差額0円' : `現金差額 ${difference > 0 ? '+' : '−'}${yen(difference)}`
  }
  function summary(rows) {
    return { count:rows.length, difference_days:rows.filter(row => row.cash_actual != null && row.cash_difference != null && Number(row.cash_difference) !== 0).length,
      missing_days:rows.filter(row => row.cash_actual == null || row.cash_difference == null).length,
      paypay_sales:rows.reduce((sum,row) => sum + Number(row.paypay_sales || 0),0) }
  }
  const api = { status, summary }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.MACHI_CASH_RECONCILIATION = api
})()
