(() => {
  const issue = (label, detail, href, level = 'review') => ({ label, detail, href, level })
  function checks(report, receipt, invoice, storeId) {
    const x = report.selected || {}, root = `?store_id=${storeId}`
    const out = []
    if (!Number(x.order_count) && !Number(x.closed_days)) out.push(issue('売上の記録', 'この年の会計済み注文・日次締めがありません。休業か記録漏れか確認してください。', '/sales-report.html' + root, 'unknown'))
    else out.push(issue('売上と日次締め', `会計済み ${Number(x.order_count || 0)}件 ／ 締め記録 ${Number(x.closed_days || 0)}日。全営業日が揃っているかは未確認です。`, '/sales-report.html' + root))
    if (Number(x.uncosted_items) > 0) out.push(issue('商品原価', `原価未登録の商品明細 ${x.uncosted_items}件。現在単価の参考原価と棚卸額も照合してください。`, '/cost-editor.html' + root, 'action'))
    else out.push(issue('商品原価・棚卸', '商品原価の未登録は0件。期首・期末棚卸による売上原価は未確定です。', '/cost-editor.html' + root))
    const unknown = Number(x.unknown_tax_count || 0), missing = Number(x.missing_evidence_count || 0)
    out.push(issue('経費の税区分・証憑', `税区分未確認 ${unknown}件 ／ 証憑未連携 ${missing}件。${unknown || missing ? '原本と照合してください。' : '未連携0件でも原本の内容を確認してください。'}`, '/receipt-capture.html' + root, unknown || missing ? 'action' : 'review'))
    if (receipt) out.push(issue('レシート確認', `未確認 ${Number(receipt.pending_count || 0)}件 ／ 前日以前 ${Number(receipt.overdue_count || 0)}件 ／ 重複候補 ${Number(receipt.duplicate_count || 0)}件。これは全期間の件数です。`, '/receipt-capture.html' + root, Number(receipt.pending_count) ? 'action' : 'review'))
    else out.push(issue('レシート確認', '件数を取得できません。', '/receipt-capture.html' + root, 'unknown'))
    if (invoice) out.push(issue('請求書・支払', `下書き ${Number(invoice.drafts || 0)}件 ／ 未払残高 ¥${Number(invoice.unpaid || 0).toLocaleString('ja-JP')}。これは全期間の数字です。`, '/invoice-management.html' + root, Number(invoice.drafts) ? 'action' : 'review'))
    else out.push(issue('請求書・支払', '件数を取得できません。', '/invoice-management.html' + root, 'unknown'))
    out.push(issue('申告主体と仕訳帳', '申告者・開始残高は未確認です。仕訳帳へ実取引を転記していません。', null, 'blocked'))
    out.push(issue('現金・銀行・決算整理', '入出金照合、棚卸、固定資産、未払・前払、貸借対照表、年度確定は未実装です。', null, 'blocked'))
    return out
  }
  const api = { checks }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.MACHI_FILING_READINESS = api
})()
