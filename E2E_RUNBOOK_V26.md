# MACHI ORDER V26 E2E Runbook

## 安全テスト
1. 顧客画面 `index.html?test=1&t=<seat token>` で商品選択・オプション・カート・注文直前まで確認
2. 本番注文テスト時のみ test=1 を外す
3. kitchen: new → cooking → served
4. cashier: 現金またはPayPayで支払済み
5. closing: 支払済み注文が売上集計へ反映
6. 現金の場合、opening_cash + cash_sales と実在高との差額を確認
7. hygiene: テンプレートごとにOK/異常ありを記録
8. inventory: 実在庫数を記録
9. handoff: 引継ぎ保存
10. staff: clock_in → break_start → break_end → clock_out

## 合格条件
- 二重注文なし
- 二重決済なし
- 二重出勤なし
- 休憩中の退勤を拒否
- 他店舗データを操作できない
- 締め売上 = paid orders 合計
- 現金差額 = actual - (opening + cash sales)
