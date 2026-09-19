# MACHI ORDER V25
## Added
- 今日の店舗ホーム
- 在庫・仕込み・発注画面
- 衛生/HACCP画面
- 引継ぎ・締め画面
- 運用受入マトリクス
## Safety
- API秘密鍵をHTMLへ埋め込まない
- 未検証の衛生/締め書込は有効化しない
- 本番前ブロッカーを機能別に明示
## Next hardening
- cashier-api 決済原子性
- workforce-api 予定/実績シフト統合
- operations-api RLS/JWT
- QR→厨房→提供→会計→売上 E2E
