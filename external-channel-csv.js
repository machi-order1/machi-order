(function (root) {
  const header = ['営業日','サービス','注文売上','注文件数','手数料','入金額','参照番号','メモ']
  function parse(text) {
    const result = [], fields = []; let field = '', quoted = false
    text = String(text || '').replace(/^\ufeff/, '')
    for (let i = 0; i < text.length; i++) {
      const char = text[i]
      if (quoted) {
        if (char === '"' && text[i + 1] === '"') { field += '"'; i++ }
        else if (char === '"') quoted = false
        else field += char
      } else if (char === '"') {
        if (field) throw Error('CSVの引用符を確認してください')
        quoted = true
      } else if (char === ',') { fields.push(field); field = '' }
      else if (char === '\n' || char === '\r') {
        if (char === '\r' && text[i + 1] === '\n') i++
        fields.push(field); field = ''
        if (fields.some(value => value.trim())) result.push(fields.splice(0))
        else fields.length = 0
      } else field += char
    }
    if (quoted) throw Error('CSVの引用符が閉じていません')
    fields.push(field)
    if (fields.some(value => value.trim())) result.push(fields)
    return result
  }
  function prepare(text, month, today, existing = new Set()) {
    const lines = parse(text)
    if (!lines.length || header.some((name, index) => lines[0][index] !== name) || lines[0].length !== header.length) throw Error('CSVの見出しが雛形と違います')
    if (lines.length < 2) throw Error('CSVに実績の行を入力してください')
    if (lines.length > 63) throw Error('一度に取り込めるのは62行までです')
    const seen = new Set()
    return lines.slice(1).map((values, index) => {
      const line = index + 2
      if (values.length !== header.length) throw Error(`${line}行目の列数を確認してください`)
      const [dateRaw, channelRaw, grossRaw, countRaw, feeRaw, payoutRaw, refRaw, noteRaw] = values.map(value => value.trim())
      const date = dateRaw
      if (!/^20\d{2}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + 'T00:00:00Z')) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date || !date.startsWith(month) || date > today) throw Error(`${line}行目の営業日を確認してください`)
      const channel = /^uber\s*eats$/i.test(channelRaw) || channelRaw === 'uber_eats' ? 'uber_eats' : channelRaw === 'ロケットナウ' || channelRaw === 'rocket_now' ? 'rocket_now' : null
      if (!channel) throw Error(`${line}行目のサービスを確認してください`)
      const key = date + ':' + channel
      if (seen.has(key)) throw Error(`${line}行目に同じ日・サービスが重複しています`)
      seen.add(key)
      const number = (raw, label, max) => {
        if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > max) throw Error(`${line}行目の${label}を確認してください`)
        return Number(raw)
      }
      if (refRaw.length > 120 || noteRaw.length > 500) throw Error(`${line}行目の参照番号・メモが長すぎます`)
      return { business_date: date, channel_code: channel, gross_sales: number(grossRaw, '注文売上', 1000000000),
        order_count: number(countRaw, '注文件数', 100000), platform_fee: number(feeRaw, '手数料', 1000000000),
        payout_amount: number(payoutRaw, '入金額', 1000000000), source_ref: refRaw, note: noteRaw,
        existing: existing.has(key) }
    })
  }
  const api = { header, parse, prepare, template: '\ufeff' + header.join(',') + '\r\n' }
  root.MACHI_EXTERNAL_CSV = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
