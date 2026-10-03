((root, factory) => {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.MACHI_SETTLEMENT_EXPORT = factory()
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const quote = value => {
    const text = String(value ?? '')
    return '"' + (/^[\s]*[=+@-]/.test(text) ? "'" : '') + text.replace(/"/g, '""') + '"'
  }
  function csv(rows) {
    const columns = ['入金日','種別','入金額','参照番号','メモ','状態','取消理由','記録ID']
    const lines = rows.map(row => [row.posted_on,row.channel_code,row.amount_yen,row.source_ref,row.note,row.voided_at ? '取消済み' : '有効',row.void_reason,row.id].map(quote).join(','))
    return '\ufeff' + [columns.map(quote).join(','),...lines].join('\r\n') + '\r\n'
  }
  return { csv }
})
