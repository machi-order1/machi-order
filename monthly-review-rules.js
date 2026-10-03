(() => {
  function checks(sources, statements, receipt, invoice) {
    const sales=sources.sales_rows||[], cash=sources.cash_rows||[], expenses=sources.expense_rows||[], entries=(statements.entries||[]).filter(row=>!row.voided_at)
    const problems=[]
    const add=(label,count,detail,path,level='action')=>problems.push({label,count,detail,path,level})
    if(!sales.length) add('日次締め',null,'締め済みの営業日がありません。休業日か未入力か、営業記録を確認してください。','/closing.html','unknown')
    const missing=cash.filter(row=>row.cash_actual==null||row.cash_difference==null).length
    const variance=cash.filter(row=>row.cash_actual!=null&&row.cash_difference!=null&&Number(row.cash_difference)!==0).length
    if(missing) add('現金実在高の未入力',missing,'締め済み日の現金実在高を確認してください。','/journal-sources.html')
    if(variance) add('現金差額',variance,'差額のある締め済み日を確認してください。','/journal-sources.html')
    const tax=expenses.filter(row=>!row.tax_category||row.tax_category==='unknown').length
    const evidence=expenses.filter(row=>!row.has_receipt).length
    const vendor=expenses.filter(row=>!row.vendor).length
    if(tax) add('税区分が未確認の経費',tax,'領収書の内容と税区分を確認してください。','/journal-sources.html')
    if(evidence) add('証憑が未連携の経費',evidence,'領収書との対応を確認してください。','/journal-sources.html')
    if(vendor) add('取引先が未入力の経費',vendor,'取引先名を確認してください。','/journal-sources.html')
    const changed=[...sales,...expenses].filter(row=>row.changed_after_link).length
    if(changed) add('仕訳紐付け後に変わった元データ',changed,'元データと仕訳の金額・日付の差を確認してください。','/journal-sources.html')
    const paypay=cash.reduce((sum,row)=>sum+Number(row.paypay_sales||0),0)
    const deposits=entries.filter(row=>row.channel_code==='paypay').length
    if(paypay>0&&!deposits) add('PayPay入金の参考確認',null,'この月のPayPay POS売上はありますが、同月着金の記録はありません。振込月のずれも確認してください。','/settlement-review.html','review')
    if(receipt) {
      if(Number(receipt.overdue_count)>0) add('前日以前の未確認レシート',Number(receipt.overdue_count),'全期間の件数です。撮影後、翌日までに内容を確認してください。','/receipt-capture.html')
      if(Number(receipt.duplicate_count)>0) add('レシート重複候補',Number(receipt.duplicate_count),'全期間の件数です。二重計上の可能性を確認してください。','/receipt-capture.html')
    } else add('レシートの確認状況',null,'取得できませんでした。レシート画面で確認してください。','/receipt-capture.html','unknown')
    if(invoice) {
      if(Number(invoice.overdue)>0) add('期限超過の請求書',Number(invoice.overdue),'全期間の件数です。支払状況を確認してください。','/invoice-management.html')
      if(Number(invoice.drafts)>0) add('下書き請求書',Number(invoice.drafts),'全期間の件数です。内容を確定してください。','/invoice-management.html')
    } else add('請求書の確認状況',null,'取得できませんでした。請求書画面で確認してください。','/invoice-management.html','unknown')
    return {problems, summary:{closed_days:sales.length,expenses:expenses.length,settlements:entries.length,unverified:problems.filter(item=>item.level==='action').length}, note:'表示した範囲での確認項目です。未締めの営業日や銀行明細との突合は判定していません。'}
  }
  const api={checks}
  if(typeof module!=='undefined'&&module.exports)module.exports=api
  if(typeof window!=='undefined')window.MACHI_MONTHLY_REVIEW=api
})()
