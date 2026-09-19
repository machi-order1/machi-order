# V27
- kitchen-api v6: new→cooking→served の順方向遷移だけ許可
- 同時操作時は条件付きUPDATEで競合検出
- served_at を提供時だけ設定
- 厨房UI 30秒自動更新
- 注文経過分数、チャネル、オプション、メモ表示
- 厨房ボタン二重操作防止
- HTML表示値をescape
