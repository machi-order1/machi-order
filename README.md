# MACHI ORDER V22

博多油そば151 長浜店 実店舗テスト準備版。

- QRメニュー / Supabase menu-api
- 商品オプション・数量・カート
- カテゴリ位置補正 + active tab
- 注文直前テストモード `?test=1`
- オフライン表示 / 通信エラー再試行
- Netlify設定同梱

Production frontend: Netlify / Backend: Supabase


## V23
- カートを席ごとに端末保存
- 誤操作による二重送信を防止
- 通信失敗時に注文未確定を明示
- 成功時のみカート消去
- 実店舗テストチェックリスト追加
