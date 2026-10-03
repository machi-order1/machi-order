(function (root) {
  const header = ['入金日','種別','入金額','参照番号','メモ']
  const channels = { 'PayPay':'paypay',paypay:'paypay','カード':'card',card:'card','現金入金':'cash_deposit',cash_deposit:'cash_deposit','その他':'other',other:'other' }
  function prepare(content, month, today, existing = new Set()) {
    const parse = root.MACHI_EXTERNAL_CSV?.parse || (typeof require === 'function' ? require('./external-channel-csv.js').parse : null)
    if (!parse) throw Error('CSV読込機能が使えません')
    const lines = parse(content)
    if (!lines.length || header.some((name,index) => lines[0][index] !== name) || lines[0].length !== header.length) throw Error('CSVの見出しが雛形と違います')
    if (lines.length<2 || lines.length>101) throw Error('1〜100行の明細を入力してください')
    const seen = new Set()
    return lines.slice(1).map((values,index) => {
      const line = index+2
      if (values.length !== header.length) throw Error(`${line}行目の列数を確認してください`)
      const [date,rawChannel,rawAmount,reference,note] = values.map(value => value.trim())
      const valid = /^20\d{2}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date+'T00:00:00Z')) && new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date
      if (!valid || !date.startsWith(month) || date>today) throw Error(`${line}行目の入金日を確認してください`)
      const channel = channels[rawChannel]
      if (!channel) throw Error(`${line}行目の種別を確認してください`)
      if (!/^\d+$/.test(rawAmount) || !Number.isSafeInteger(Number(rawAmount)) || Number(rawAmount)<1 || Number(rawAmount)>1000000000) throw Error(`${line}行目の入金額を確認してください`)
      if (reference.length>120 || note.length>500) throw Error(`${line}行目の参照番号・メモが長すぎます`)
      const key = [date,channel,Number(rawAmount),reference].join(':')
      if (seen.has(key)) throw Error(`${line}行目はCSV内で重複しています`)
      seen.add(key)
      return { posted_on:date,channel_code:channel,amount_yen:Number(rawAmount),source_ref:reference,note,existing:existing.has(key) }
    })
  }
  const api = { header,prepare,template:'\ufeff'+header.join(',')+'\r\n' }
  root.MACHI_SETTLEMENT_CSV = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
