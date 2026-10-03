# Cloudflare Pages への無料枠移行手順

Netlify のクレジット上限で配信を更新できない場合の、既存システムを残したままの静的画面の移行案。Supabase のデータベース、認証、Storage、Edge Functions は移動しない。

## 配信用ファイル

`node scripts/build-cloudflare-pages.mjs` で `.cloudflare-pages-dist/` を生成する。HTML、JavaScript、CSS、画像など配信に必要なものだけをサイトのルートに置く。`supabase/`、開発資料、環境ファイルは含めない。ビルド時にファイル数・サイズ・サービスワーカーのキャッシュ参照を検査する。

本番運用には最初から **Git 連携**で `machi-order1/machi-order` の `main` を選ぶ。ビルドコマンドは `node scripts/build-cloudflare-pages.mjs`、出力先は `.cloudflare-pages-dist`、Node.js は 22 を使う。プロジェクト名を決めると `https://<project>.pages.dev` で試せる。

同梱の ZIP は手動確認用に別の Direct Upload プロジェクトへアップロードできる。ZIP の中の `index.html` は ZIP の直下に置く。**Direct Upload で作ったプロジェクトは後から Git 連携に切り替えられない**ため、同じ名前で本番を始めない。

## 切替前の確認

1. Cloudflare Pages の新しい URL でトップ、ログイン、注文、売上分析、領収書撮影、請求書管理を開く。`takeout-api` と `takeout-admin-api` は現在 `https://machi-order.pages.dev` を許可している。別名のプロジェクトや独自ドメインなら、公開前にこれらの API の許可元を追加して再配備し、持ち帰り注文と設定画面を確認する。
2. Supabase Auth の URL 設定に `https://<project>.pages.dev/reset-password.html` をリダイレクト許可先として加え、パスワード再設定を確認する。カスタムドメインにするならその URL も追加する。
3. テスト用アカウントでログインし、権限別表示、注文、写真アップロードを少量で確認する。写真は本番の Supabase Storage に入るので、テストデータを識別して整理する。
4. 既存の Netlify URL と印刷済み QR を維持したまま新 URL を現場で確認し、問題なければリンク・QR・カスタムドメインを順に切り替える。古い URL が新サイトへ自動転送されるわけではない。

## 無料枠の管理

Cloudflare Pages は静的ファイルの配信に使う。領収書と請求書の写真は引き続き Supabase Storage に保存されるため、無料枠の容量と通信量を別に監視する。証憑を無断で圧縮し直したり削除したりしない。月あたりの写真件数と実際の保存バイト数を記録し、無料枠を超える前に保管方法を決める。

Cloudflare アカウントへのアップロードと認証 URL 設定が終わるまでは、これは配備準備であり公開切替は完了していない。
