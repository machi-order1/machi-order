-- Per-bowl toppings and ingredient preferences; existing order RPC is preserved.
begin;

alter table public.options add column if not exists source_product_id bigint
  references public.products(id);
create index if not exists options_source_product_idx on public.options(source_product_id)
  where source_product_id is not null;
create index if not exists bowl_option_lookup_idx on public.order_item_options(order_item_id,option_id);

do $seed$
declare
  brand bigint;
  category bigint;
  group_id bigint;
  ingredient text;
  source_name text;
  source_row public.products%rowtype;
begin
  select id into strict brand from public.brands where name = '博多油そば151';
  select id into strict category from public.categories where brand_id = brand and name = '油そば';
  foreach ingredient in array array['白ネギ','青ネギ','キクラゲ','高菜'] loop
    select id into group_id from public.option_groups where brand_id = brand and name = ingredient || 'の量';
    if group_id is null then
      insert into public.option_groups(brand_id,name,required,min_select,max_select)
      values(brand,ingredient || 'の量',false,0,1) returning id into group_id;
      insert into public.options(option_group_id,name,price_delta,sort_order) values
        (group_id,ingredient || '抜き',0,1),
        (group_id,ingredient || '大盛り',100,2);
    end if;
    insert into public.product_option_groups(product_id,option_group_id)
      select id,group_id from public.products where brand_id = brand and category_id = category
      on conflict do nothing;
  end loop;

  select id into group_id from public.option_groups where brand_id = brand and name = '追加トッピング';
  if group_id is null then
    insert into public.option_groups(brand_id,name,required,min_select,max_select)
      values(brand,'追加トッピング',false,0,5) returning id into group_id;
  end if;
  foreach source_name in array array['追加 炙りチャーシュー2枚','追加 自家製激辛高菜','生卵','半熟卵','壱岐牛プレミアムローストビーフ3枚'] loop
    select * into strict source_row from public.products where brand_id = brand and name = source_name;
    insert into public.options(option_group_id,name,price_delta,sort_order,source_product_id)
      select group_id,'追加トッピング：' || source_row.name,source_row.base_price,source_row.sort_order,source_row.id
      where not exists(select 1 from public.options where option_group_id = group_id and source_product_id = source_row.id);
  end loop;
  insert into public.product_option_groups(product_id,option_group_id)
    select id,group_id from public.products where brand_id = brand and category_id = category
    on conflict do nothing;
end;
$seed$;

-- The existing RPC calculates option prices and writes these rows within the
-- same transaction. Recheck source availability at insertion, not only in UI.
create or replace function public.guard_bowl_option_source()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public
as $guard$
declare
  source_id bigint;
  source_row public.products%rowtype;
  v_store_id bigint;
  parent_brand bigint;
  sale_status text;
begin
  if exists(select 1 from public.order_item_options existing
    where existing.order_item_id = new.order_item_id and existing.option_id = new.option_id) then
    raise exception '同じオプションを重複して選択することはできません';
  end if;
  select source_product_id into source_id from public.options where id = new.option_id;
  if source_id is null then return new; end if;
  select ord.store_id,prod.brand_id into v_store_id,parent_brand
    from public.order_items item join public.orders ord on ord.id = item.order_id
    join public.products prod on prod.id = item.product_id where item.id = new.order_item_id;
  select * into source_row from public.products where id = source_id;
  if not found or not source_row.active or not source_row.customer_visible or source_row.brand_id <> parent_brand then
    raise exception '追加トッピングは現在注文できません';
  end if;
  select sp.sale_status into sale_status from public.store_products sp
    where sp.store_id = v_store_id and sp.product_id = source_id;
  if coalesce(sale_status,'available') <> 'available' then
    raise exception '追加トッピング「%」は現在注文できません',source_row.name;
  end if;
  return new;
end;
$guard$;
revoke all on function public.guard_bowl_option_source() from public;
drop trigger if exists bowl_option_source_guard on public.order_item_options;
create trigger bowl_option_source_guard before insert on public.order_item_options
  for each row execute function public.guard_bowl_option_source();

-- Keep linked topping surcharges aligned with their standalone base prices.
create or replace function public.sync_bowl_topping_price()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public
as $sync$
begin
  update public.options set price_delta = new.base_price where source_product_id = new.id;
  return new;
end;
$sync$;
revoke all on function public.sync_bowl_topping_price() from public;
drop trigger if exists bowl_topping_price_sync on public.products;
create trigger bowl_topping_price_sync after update of base_price on public.products
  for each row when (old.base_price is distinct from new.base_price)
  execute function public.sync_bowl_topping_price();

commit;
