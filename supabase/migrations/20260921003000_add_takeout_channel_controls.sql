alter table public.store_channel_settings
  add column if not exists min_lead_minutes integer not null default 10,
  add column if not exists max_advance_minutes integer not null default 1440;

alter table public.store_channel_settings
  drop constraint if exists store_channel_settings_min_lead_minutes_check,
  add constraint store_channel_settings_min_lead_minutes_check check (min_lead_minutes between 10 and 180),
  drop constraint if exists store_channel_settings_max_advance_minutes_check,
  add constraint store_channel_settings_max_advance_minutes_check check (max_advance_minutes between 60 and 2880);

create or replace function public.place_takeout_order_idempotent(p_store_id bigint,p_items jsonb,p_client_order_key uuid,p_customer_name text,p_phone text,p_pickup_at timestamptz,p_customer_note text default null,p_ip_hash text default null,p_user_agent text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_table_token uuid; v_result jsonb; v_order_id bigint; v_existing public.orders%rowtype; v_min_lead integer; v_max_advance integer;
begin
  if p_store_id is null or p_store_id<=0 then raise exception '店舗が無効です'; end if;
  if p_client_order_key is null then raise exception '注文識別番号が必要です'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception '商品が選択されていません'; end if;
  if nullif(btrim(p_customer_name),'') is null or char_length(btrim(p_customer_name))>80 then raise exception 'お名前を確認してください'; end if;
  if nullif(btrim(p_phone),'') is null or char_length(btrim(p_phone)) not between 8 and 30 then raise exception '電話番号を確認してください'; end if;
  select min_lead_minutes,max_advance_minutes into v_min_lead,v_max_advance from public.store_channel_settings where store_id=p_store_id and channel_code='takeout' and enabled=true;
  if not found then raise exception '現在テイクアウト注文を受け付けていません'; end if;
  if p_pickup_at<now()+make_interval(mins=>v_min_lead) or p_pickup_at>now()+make_interval(mins=>v_max_advance) then raise exception '受取時刻を確認してください'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_store_id::text||':'||p_client_order_key::text,0));
  select * into v_existing from public.orders where store_id=p_store_id and client_order_key=p_client_order_key limit 1;
  if found then return jsonb_build_object('order_id',v_existing.id,'total',v_existing.total,'duplicate',true,'pickup_at',(select pickup_at from public.takeout_order_details where order_id=v_existing.id)); end if;
  select qr_token into v_table_token from public.dining_tables where store_id=p_store_id and name='テイクアウト受付' and active=true limit 1;
  if v_table_token is null then raise exception 'テイクアウト受付の設定がありません'; end if;
  v_result:=public.place_customer_order_idempotent(v_table_token,p_items,p_client_order_key); v_order_id:=(v_result->>'order_id')::bigint;
  update public.orders set order_channel_code='takeout',entry_channel='website_takeout',customer_note=nullif(left(btrim(coalesce(p_customer_note,'')),500),'') where id=v_order_id and store_id=p_store_id;
  insert into public.takeout_order_details(order_id,customer_name,phone,pickup_at,ip_hash,user_agent) values(v_order_id,left(btrim(p_customer_name),80),left(btrim(p_phone),30),p_pickup_at,case when p_ip_hash is not null and char_length(p_ip_hash)=64 then p_ip_hash else null end,nullif(left(btrim(coalesce(p_user_agent,'')),500),''));
  return v_result||jsonb_build_object('duplicate',false,'pickup_at',p_pickup_at);
end $$;
revoke all on function public.place_takeout_order_idempotent(bigint,jsonb,uuid,text,text,timestamptz,text,text,text) from public,anon,authenticated;
grant execute on function public.place_takeout_order_idempotent(bigint,jsonb,uuid,text,text,timestamptz,text,text,text) to service_role;
