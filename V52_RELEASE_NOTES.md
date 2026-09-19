# V52 PURCHASE CONVERSION
- inventory_purchase_units
- 仕入価格 / 内容量 / 入数 / 歩留まりを保存
- 例: ケース価格→1個原価、袋価格→1g原価
- 換算結果を inventory_items.unit_cost と原価履歴へ反映
- costing-api v2
- 実価格は未投入
- 異種単位（kg→g等）は入力時に内容量を基準単位へ揃える方式。将来自動単位変換予定
