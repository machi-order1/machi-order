(() => {
  function recentDates(today, count = 3) {
    const dates = []
    const base = new Date(`${today}T12:00:00Z`)
    for (let i = 1; i <= count; i++) {
      const date = new Date(base)
      date.setUTCDate(base.getUTCDate() - i)
      dates.push(date.toISOString().slice(0, 10))
    }
    return dates
  }
  function classify(day) {
    const date = day.summary.business_date, count = Number(day.summary.order_count || 0)
    const sales = Number(day.summary.net_sales || 0), closing = day.closing
    const href = `/sales-report.html?date=${date}`
    if (closing) {
      if (Number(closing.order_count) !== count || Number(closing.net_sales) !== sales) return { date, level: 'alert', text: '締め後に売上が変わっています。会計・取消を確認', href }
      return null
    }
    if (count > 0) return { date, level: 'alert', text: `${count}件の会計済み注文がありますが未締め`, href }
    if (day.cash_drawer) return { date, level: 'review', text: 'レジ記録あり・会計済み売上ゼロ。休業や会計漏れを確認', href }
    return null
  }
  const api = { recentDates, classify }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.MACHI_DAILY_CHECK = api
})()
