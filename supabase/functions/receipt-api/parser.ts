export type ReceiptProposal = { date: string | null; amount: number | null; vendor: string | null; category: string | null; name: string; tax_category: 'unknown'; flags: string[]; confidence: 'low' | 'medium' }

const validDate = (year: number, month: number, day: number) => {
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const parsed = Date.parse(`${date}T00:00:00Z`)
  return !Number.isNaN(parsed) && new Date(parsed).toISOString().slice(0, 10) === date ? date : null
}
const money = (line: string) => [...line.matchAll(/(?:¥|￥)?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{2,8})(?:円)?/g)]
  .map(match => Number(match[1].replaceAll(',', ''))).filter(value => Number.isInteger(value) && value > 0 && value <= 100000000)

export function parseReceipt(input: string): ReceiptProposal {
  const text = String(input || '').normalize('NFKC').slice(0, 12000)
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  let date: string | null = null
  for (const line of lines) {
    const match = line.match(/(20\d{2})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})\s*日?/)
    if (match) { date = validDate(Number(match[1]), Number(match[2]), Number(match[3])); if (date) break }
  }
  const preferred = lines.filter(line => /(?:合計|お支払|領収金額|領収額|お買上金額|現計|税込合計|ご請求金額|請求金額|請求合計)/.test(line) && !/(?:小計|お預り|お釣り|釣銭|内税|消費税額|支払期日|支払期限|振込期限)/.test(line))
  const preferredAmounts = preferred.flatMap(money)
  const amount = preferredAmounts.length ? preferredAmounts.at(-1)! : null
  const vendorCandidates = lines.filter(line => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]{2}/u.test(line) && !/(領収書|レシート|毎度|ありがとうございます|税率|登録番号|TEL|電話|合計|お買上|購入|発行|年月日|^20\d{2})/i.test(line) && line.length <= 90)
  const vendor = vendorCandidates.find(line => /(株式会社|有限会社|商店|電力|ガス|ストア|マーケット|店)/.test(line)) || vendorCandidates[0] || null
  const flags: string[] = []
  if (!date) flags.push('日付を確認してください')
  if (!amount) flags.push('税込合計を確認してください')
  if (!vendor) flags.push('取引先を確認してください')
  const inventory = /(食材|原材料|仕入|精肉|鮮魚|青果|野菜|米|小麦粉|麺|スーパー|業務用食品)/.test(text)
  if (inventory) flags.push('食材・商品の仕入れの可能性があります。在庫・売上原価との照合が必要です')
  const categoryRules: [RegExp, string][] = [
    [/(家賃|賃料|テナント)/, '家賃'],
    [/(電気料金|水道料金|ガス料金|光熱費)/, '水道光熱費'],
    [/(広告|宣伝|チラシ|プロモーション)/, '広告宣伝費'],
    [/(通信料|インターネット|携帯電話)/, '通信費'],
    [/(振込手数料|決済手数料|支払手数料)/, '支払手数料'],
    [/(修理|修繕)/, '修繕費'],
    [/(文具|コピー用紙|洗剤|消耗品)/, '消耗品費'],
  ]
  const category = inventory ? null : categoryRules.find(([pattern]) => pattern.test(text))?.[1] || null
  if (!category) flags.push('費目を選んでください')
  return { date, amount, vendor, category, name: vendor ? `${vendor}での購入` : '領収書の支出', tax_category: 'unknown', flags,
    confidence: date && amount && vendor ? 'medium' : 'low' }
}
