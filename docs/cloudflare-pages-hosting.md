# Cloudflare Pages への無料枠移行手順

Netlify のクレジット上限で配信を更新できない場合の、既存システムを残したままの静的画面の移行案。Supabase のデータベース、認証、Storage、Edge Functions は移動しない。

## 配信用ファイル

`node scripts/build-cloudflare-pages.mjs` で `.cloudflare-pages-dist/` を生成する。HTML、JavaScript、CSS、画像など配信に必要なものだけをサイトのルートに置く。`supabase/`、開発資料、環境ファイルは含めない。ビルド時にファイル数・サイズ・サービスワーカーのキャッシュ参照を検査する。

Cloudflare Pages の **Direct Upload** で、出力フォルダの中身を ZIP にしたものをアップロードする。プロジェクト名を決めると `https://<project>.pages.dev` で試せる。ZIP の中の `index.html` は ZIP の直下に置く。Git 連携による自動更新は、最初の動作確認後に設定する。

## 切替前の確認

1. Cloudflare Pages の新しい URL でトップ、ログイン、注文、売上分析、領収書撮影、請求書管理を開く。
2. Supabase Auth の URL 設定に `https://<project>.pages.dev/reset-password.html` をリダイレクト許可先として加え、パスワード再設定を確認する。カスタムドメインにするならその URL も追加する。
3. テスト用アカウントでログインし、権限別表示、注文、写真アップロードを少量で確認する。写真は本番の Supabase Storage に入るので、テストデータを識別して整理する。
4. 既存の Netlify URL と印刷済み QR を維持したまま新 URL を現場で確認し、問題なければリンク・QR・カスタムドメインを順に切り替える。古い URL が新サイトへ自動転送されるわけではない。

## 無料枠の管理

Cloudflare Pages は静的ファイルの配信に使う。領収書と請求書の写真は引き続き Supabase Storage に保存されるため、無料枠の容量と通信量を別に監視する。証憑を無断で圧縮し直したり削除したりしない。月あたりの写真件数と実際の保存バイト数を記録し、無料枠を超える前に保管方法を決める。

Cloudflare アカウントへのアップロードと認証 URL 設定が終わるまでは、これは配備準備であり公開切替は完了していない。
