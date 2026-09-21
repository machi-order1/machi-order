alter table public.inventory_items
  add column if not exists inventory_group text not null default 'その他',
  add column if not exists sort_order integer not null default 7500;

create unique index if not exists inventory_items_company_name_unique
  on public.inventory_items (company_id, lower(name));

update public.inventory_items set inventory_group = case
  when inventory_class = 'prepared_food' then '冷蔵庫仕込み在庫'
  when inventory_class = 'food' then 'メイン食材在庫'
  when inventory_class in ('supplies','equipment') then '備品'
  else 'その他' end
where inventory_group = 'その他';

update public.inventory_items set
  name = case name
    when '青ねぎ（未加工）' then '青ネギ（未仕込み）'
    when '白ねぎ（未加工）' then '白ネギ（未仕込み）'
    when '青ねぎ（カット済）' then '青ネギ（カット済）'
    when '白ねぎ（カット済）' then '白ネギ（カット済）'
    when 'キクラゲ（水戻し済）' then '木耳（水戻し済）'
    when '乾燥キクラゲ' then '乾燥きくらげ'
    when 'チャーシュー（未仕込み）' then '冷凍チャーシュー'
    when 'チャーシュー（解凍・仕込み済）' then 'チャーシュー（仕込み済）'
    when '割り箸' then '割箸'
    when '紙ナプキン' then '紙ナフキン'
    else name end,
  item_type = case when inventory_class = 'prepared_food' then 'prepared' else item_type end;

with company as (select id from public.companies where name = '株式会社MACHI' order by id limit 1),
seed(name,unit,inventory_group,item_type,sort_order) as (values
  ('青ネギ（カット済）','容器','冷蔵庫仕込み在庫','prepared',1010),('白ネギ（カット済）','容器','冷蔵庫仕込み在庫','prepared',1020),
  ('半熟卵','個','冷蔵庫仕込み在庫','prepared',1030),('高菜（カット・炒め済）','容器','冷蔵庫仕込み在庫','prepared',1040),
  ('木耳（水戻し済）','容器','冷蔵庫仕込み在庫','prepared',1050),('チャーシュー（仕込み済）','容器','冷蔵庫仕込み在庫','prepared',1060),
  ('チャーシュー丼（仕込み済）','容器','冷蔵庫仕込み在庫','prepared',1070),('揚げ一味（仕込み済）','容器','冷蔵庫仕込み在庫','prepared',1080),
  ('ごはん小分け','個','冷蔵庫仕込み在庫','prepared',1090),
  ('ダシ','容器','タレ系在庫','sauce',2010),('博多油','容器','タレ系在庫','sauce',2020),('エビ油','容器','タレ系在庫','sauce',2030),
  ('ラー油','容器','タレ系在庫','sauce',2040),('チャーシュー丼タレ','容器','タレ系在庫','sauce',2050),('餃子のタレ','容器','タレ系在庫','sauce',2060),('米酢','本','タレ系在庫','sauce',2070),
  ('冷凍チャーシュー','本','冷凍食材在庫','frozen',3010),('冷凍チャーシュー丼','袋','冷凍食材在庫','frozen',3020),('冷凍餃子','袋','冷凍食材在庫','frozen',3030),
  ('壱岐牛','袋','冷凍食材在庫','frozen',3040),('枝豆','袋','冷凍食材在庫','frozen',3050),('揚げ一味（冷凍）','袋','冷凍食材在庫','frozen',3060),
  ('生卵','個','メイン食材在庫','raw',4010),('青ネギ（未仕込み）','束','メイン食材在庫','raw',4020),('白ネギ（未仕込み）','束','メイン食材在庫','raw',4030),
  ('高菜漬け（未仕込み）','袋','メイン食材在庫','raw',4040),('乾燥きくらげ','袋','メイン食材在庫','raw',4050),('米','kg','メイン食材在庫','raw',4060),
  ('酢','本','メイン食材在庫','raw',4070),('にんにく','袋','メイン食材在庫','raw',4080),('マヨネーズ','本','メイン食材在庫','raw',4090),('麺','玉','メイン食材在庫','raw',4100),
  ('糸唐辛子','袋','買い出し系食材','raw',5010),('干し海老','袋','買い出し系食材','raw',5020),('桜えび','袋','買い出し系食材','raw',5030),
  ('すりごま','袋','買い出し系食材','raw',5040),('煮干し','袋','買い出し系食材','raw',5050),('カレー粉','缶','買い出し系食材','raw',5060),
  ('ガーリックスライス','袋','買い出し系食材','raw',5070),('アジシオ','本','買い出し系食材','raw',5080),('かつおだしの素','袋','買い出し系食材','raw',5090),
  ('コーラ','本','飲み物','drink',6010),('カルピス','本','飲み物','drink',6020),('炭酸','本','飲み物','drink',6030),('黒霧島','本','飲み物','drink',6040),
  ('角','本','飲み物','drink',6050),('レモンサワーの素','本','飲み物','drink',6060),('ジンジャーエール','本','飲み物','drink',6070),('烏龍茶','本','飲み物','drink',6080),('オレンジジュース','本','飲み物','drink',6090),
  ('赤いゴミ袋','枚','備品','supply',7010),('割箸','膳','備品','supply',7020),('テイクアウト用割箸','膳','備品','supply',7030),
  ('紙ナフキン','枚','備品','supply',7040),('紙エプロン','枚','備品','supply',7050)
)
insert into public.inventory_items(company_id,name,unit,inventory_group,item_type,sort_order,inventory_class)
select company.id,seed.name,seed.unit,seed.inventory_group,seed.item_type,seed.sort_order,
  case when seed.inventory_group='備品' then 'supplies' when seed.inventory_group='飲み物' then 'beverage' else 'food' end
from company cross join seed
on conflict (company_id, (lower(name))) do update set
  unit=excluded.unit, inventory_group=excluded.inventory_group, item_type=excluded.item_type,
  sort_order=excluded.sort_order, inventory_class=excluded.inventory_class, active=true;

update public.inventory_items set sort_order = case inventory_group
  when '冷蔵庫仕込み在庫' then 1500 when 'タレ系在庫' then 2500 when '冷凍食材在庫' then 3500
  when 'メイン食材在庫' then 4500 when '買い出し系食材' then 5500 when '飲み物' then 6500
  when '備品' then 7500 else 8500 end
where sort_order = 7500 and inventory_group <> '備品';
