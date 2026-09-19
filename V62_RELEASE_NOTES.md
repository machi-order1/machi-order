# V62 APP MODE
- MACHI ORDERをPWA化するファイルを追加
- ホーム画面追加後は standalone 表示
- Apple mobile web app metadata
- スタッフ主要画面に共通の下部ナビ
- ホーム / 厨房 / 今日 / 会計 / その他
- service worker は画面シェルのみキャッシュ。注文APIはキャッシュしない
- API/DBはV61を継続
- 本番Netlifyは未変更
- iOSの通知・バックグラウンド挙動は実機検証前なので未保証
