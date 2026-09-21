create or replace function public.place_customer_order(p_qr_token uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_table dining_tables%rowtype;
  v_store stores%rowtype;
  v_brand_id bigint;
  v_period_id bigint;
  v_order_id bigint;
  v_item jsonb;
  v_product products%rowtype;
  v_qty int;
  v_option_ids bigint[];
  v_option_id bigint;
  v_group record;
  v_selected_count int;
  v_option_delta int;
  v_base_price int;
  v_regular_price int;
  v_price_type text;
  v_rule_name text;
  v_line_total int;
  v_total int := 0;
  v_order_item_id bigint;
  v_now timestamptz := now();
  v_local_time time;
  v_dow int;
  v_sale_status text;
begin
  select * into v_table from dining_tables where qr_token=p_qr_token and active=true;
  if not found then raise exception '無効なQRコードです'; end if;
  select * into v_store from stores where id=v_table.store_id;
  select b.id into v_brand_id from brands b where b.id=v_store.brand_id;
  v_local_time := (v_now at time zone coalesce(v_store.timezone,'Asia/Tokyo'))::time;
  v_dow := extract(dow from (v_now at time zone coalesce(v_store.timezone,'Asia/Tokyo')))::int;

  select bp.id into v_period_id from business_periods bp where bp.store_id=v_store.id and
    ((bp.start_time <= bp.end_time and v_local_time >= bp.start_time and v_local_time < bp.end_time) or
     (bp.start_time > bp.end_time and (v_local_time >= bp.start_time or v_local_time < bp.end_time)))
    order by bp.sort_order limit 1;
  if v_period_id is null then raise exception '現在は営業時間外です'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then raise exception '商品を選択してください'; end if;

  insert into orders(store_id,table_id,business_period_id,status,subtotal,total)
  values(v_store.id,v_table.id,v_period_id,'new',0,0) returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(coalesce((v_item->>'quantity')::int,1),1);
    select * into v_product from products where id=(v_item->>'product_id')::bigint and brand_id=v_brand_id and active=true and customer_visible=true;
    if not found then raise exception '注文できない商品が含まれています'; end if;
    select coalesce(sp.sale_status,'available') into v_sale_status from (select 1) x left join store_products sp on sp.store_id=v_store.id and sp.product_id=v_product.id;
    if v_sale_status <> 'available' then raise exception '% は現在注文できません',v_product.name; end if;

    select coalesce(array_agg(value::bigint),array[]::bigint[]) into v_option_ids from jsonb_array_elements_text(coalesce(v_item->'option_ids','[]'::jsonb));
    for v_group in select og.* from product_option_groups pog join option_groups og on og.id=pog.option_group_id where pog.product_id=v_product.id loop
      select count(*) into v_selected_count from options o where o.option_group_id=v_group.id and o.active=true and o.id=any(v_option_ids);
      if v_selected_count < greatest(v_group.min_select,case when v_group.required then 1 else 0 end) or v_selected_count > v_group.max_select then
        raise exception '% の「%」を正しく選択してください',v_product.name,v_group.name;
      end if;
    end loop;
    if exists(select 1 from unnest(v_option_ids) oid left join options o on o.id=oid left join product_option_groups pog on pog.product_id=v_product.id and pog.option_group_id=o.option_group_id where o.id is null or o.active=false or pog.product_id is null) then
      raise exception '% に無効なオプションが含まれています',v_product.name;
    end if;

    v_regular_price:=v_product.base_price;
    v_base_price:=v_regular_price;
    v_price_type:='regular';
    v_rule_name:=null;
    select pr.price,pr.name into v_base_price,v_rule_name from price_rules pr where pr.store_id=v_store.id and pr.product_id=v_product.id and pr.active=true
      and (pr.days_of_week is null or v_dow=any(pr.days_of_week))
      and (pr.start_time is null or pr.end_time is null or (pr.start_time<=pr.end_time and v_local_time>=pr.start_time and v_local_time<pr.end_time) or (pr.start_time>pr.end_time and (v_local_time>=pr.start_time or v_local_time<pr.end_time)))
      order by pr.id desc limit 1;
    if found then
      v_price_type:='price_rule';
    else
      v_base_price:=v_regular_price;
      v_rule_name:=null;
    end if;
    select coalesce(sum(o.price_delta),0) into v_option_delta from options o where o.id=any(v_option_ids);
    v_line_total:=(v_base_price+v_option_delta)*v_qty;
    if v_base_price+v_option_delta < 0 then raise exception '価格設定が不正です'; end if;
    insert into order_items(order_id,product_id,product_name_snapshot,quantity,unit_price,price_type,regular_unit_price,line_total)
    values(v_order_id,v_product.id,v_product.name,v_qty,v_base_price+v_option_delta,v_price_type,v_regular_price,v_line_total) returning id into v_order_item_id;
    foreach v_option_id in array v_option_ids loop
      insert into order_item_options(order_item_id,option_id,option_name_snapshot,price_delta)
      select v_order_item_id,o.id,o.name,o.price_delta from options o where o.id=v_option_id;
    end loop;
    v_total:=v_total+v_line_total;
  end loop;
  update orders set subtotal=v_total,total=v_total where id=v_order_id;
  return jsonb_build_object('order_id',v_order_id,'total',v_total);
end;
$function$;

