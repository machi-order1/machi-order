-- Prepare Shirakibaru as an isolated second store.
-- Product availability mirrors Nagahama, while ordering and channels remain disabled.
do $$
declare
  v_store_id bigint;
begin
  select id into v_store_id
  from public.stores
  where name = '白木原店'
  order by id
  limit 1;

  if v_store_id is null then
    insert into public.stores (brand_id, name, timezone)
    select brand_id, '白木原店', 'Asia/Tokyo'
    from public.stores
    where id = 1
    returning id into v_store_id;
  end if;

  insert into public.store_settings (
    store_id, service_name, logo_url, primary_color, accent_color,
    currency, tax_rate, prices_include_tax, receipt_footer, ordering_enabled
  )
  select
    v_store_id, service_name, logo_url, primary_color, accent_color,
    currency, tax_rate, prices_include_tax, receipt_footer, false
  from public.store_settings
  where store_id = 1
  on conflict (store_id) do update
  set ordering_enabled = false, updated_at = now();

  if not exists (select 1 from public.business_periods where store_id = v_store_id) then
    insert into public.business_periods (store_id, name, start_time, end_time, sort_order)
    values
      (v_store_id, '昼営業', '11:00', '15:00', 1),
      (v_store_id, '夜営業', '17:00', '22:00', 2);
  end if;

  -- Before the store starts taking orders, keep its physical seating definition exact:
  -- 7 counter seats + two 4-person tables = 15 seats.
  if not exists (select 1 from public.orders where store_id = v_store_id) then
    delete from public.dining_tables where store_id = v_store_id;

    insert into public.dining_tables (store_id, name, table_number, seat_code, capacity, seat_type)
    select
      v_store_id,
      'カウンター' || lpad(n::text, 2, '0'),
      n,
      'C' || lpad(n::text, 2, '0'),
      1,
      'counter'
    from generate_series(1, 7) as n;

    insert into public.dining_tables (
      store_id, name, table_number, seat_code, capacity, seat_type
    )
    values
      (v_store_id, '4人テーブル01', 8, 'T01', 4, 'table'),
      (v_store_id, '4人テーブル02', 9, 'T02', 4, 'table');

    insert into public.dining_tables (store_id, name, capacity, seat_type)
    values (v_store_id, 'テイクアウト受付', 1, 'other');
  end if;

  insert into public.store_memberships (user_id, store_id, role, active)
  select user_id, v_store_id, 'manager', true
  from public.store_memberships
  where store_id = 1 and role = 'manager' and active = true
  on conflict (user_id, store_id) do update
  set role = 'manager', active = true;

  insert into public.store_products (store_id, product_id, sale_status)
  select v_store_id, product_id, sale_status
  from public.store_products
  where store_id = 1
  on conflict (store_id, product_id) do update
  set sale_status = excluded.sale_status, updated_at = now();

  insert into public.store_channel_settings (
    store_id, channel_code, enabled, external_store_ref, notes,
    min_lead_minutes, max_advance_minutes
  )
  select
    v_store_id, channel_code, false, external_store_ref,
    '白木原店の本番確認完了まで停止',
    min_lead_minutes, max_advance_minutes
  from public.store_channel_settings
  where store_id = 1
  on conflict (store_id, channel_code) do update
  set enabled = false;
end $$;
