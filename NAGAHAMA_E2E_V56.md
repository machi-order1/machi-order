# 長浜店 E2E 実地テスト
1. QR席1から油そばを注文
2. kitchen.html に注文が出る
3. 調理開始→提供済みに進める
4. cashier.html で未会計注文を確認
5. 現金/PayPayで会計完了
6. 二重会計できないことを確認
7. today / daily-profit の売上反映確認
8. 出勤→休憩→復帰→退勤
9. labor-dashboard の実働時間確認
10. staff-meal で賄い1件記録
11. 原価未登録なら未確定表示になること
12. hygiene の当日チェック
13. inventory の在庫確認
14. shift-builder で募集→案→確定の導線確認
15. スタッフ側 my-shifts / notifications 確認

## 合格条件
- 注文消失なし
- 二重会計なし
- 店舗権限外アクセス不可
- 原価未設定を0円の確定原価として扱わない
- 廃棄と賄いを二重計上しない
- シフト重複を拒否
- night_solo 必要枠を無資格者で確定しない
