# V38 SHIFT CONTROL
- workforce-api backend upgraded
- 代打応募者一覧→店長1タップ確定
- 代打確定時、元のscheduledシフトをcancelledへ
- shift_change_logへ変更履歴保存
- 他応募者へ募集終了通知データ生成
- shift_edit API追加（確定後の日付・時間・担当変更）
- revisionによる同時編集競合ガード
- shift_drafts / staff_notifications 基盤追加
- manager planningに代打回答・draftを返却
