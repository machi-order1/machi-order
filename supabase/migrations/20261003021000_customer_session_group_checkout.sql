-- Group only new dine-in orders; historical ungrouped orders stay individually payable.
create unique index if not exists customer_sessions_one_open_per_table
  on public.customer_sessions(table_id) where status = 'open';

create or replace function public.place_customer_order_idempotent(
  p_qr_token uuid,
  p_items jsonb,
  p_client_order_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_existing public.orders%rowtype;
  v_result jsonb;
  v_order_id bigint;
  v_table_id bigint;
  v_table public.dining_tables%rowtype;
  v_session public.customer_sessions%rowtype;
  v_group_id bigint;
begin
  if p_client_order_key is null then
    raise exception '注文識別番号が必要です';
  end if;

  select * into v_table
  from public.dining_tables
  where qr_token = p_qr_token and active = true;
  v_table_id := v_table.id;
  if not found then raise exception '無効なQRコードです'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_client_order_key::text, 0));

  select * into v_existing
  from public.orders
  where client_order_key = p_client_order_key
  limit 1;

  if found then
    if v_existing.table_id is distinct from v_table_id then
      raise exception '注文識別番号と席が一致しません';
    end if;
    return jsonb_build_object(
      'order_id', v_existing.id,
      'total', v_existing.total,
      'duplicate', true
    );
  end if;

  if exists (
    select 1
    from public.dining_tables dt
    left join public.store_settings ss on ss.store_id = dt.store_id
    where dt.qr_token = p_qr_token
      and dt.active = true
      and coalesce(ss.ordering_enabled, true) = false
  ) then
    raise exception '現在、注文受付を停止しています';
  end if;

  -- Serialize assignment with the cashier on this table. The takeout QR is internal.
  if v_table.seat_type is distinct from 'other' and v_table.name <> 'テイクアウト受付' then
    perform 1 from public.dining_tables where id = v_table_id for update;
    select * into v_session from public.customer_sessions
    where table_id = v_table_id and status = 'open'
    for update;
    if not found then
      insert into public.check_groups(store_id) values(v_table.store_id) returning id into v_group_id;
      insert into public.customer_sessions(store_id,table_id,check_group_id)
      values(v_table.store_id,v_table_id,v_group_id) returning * into v_session;
    end if;
  end if;


  v_result := public.place_customer_order(p_qr_token, p_items);
  v_order_id := (v_result->>'order_id')::bigint;


  update public.orders
  set client_order_key = p_client_order_key,
      customer_session_id = v_session.id,
      check_group_id = v_session.check_group_id
  where id = v_order_id;
  if v_session.id is not null then
    update public.customer_sessions set last_order_at = now() where id = v_session.id;
  end if;

  return v_result || jsonb_build_object('duplicate', false);
end;
$function$;

revoke all on function public.place_customer_order_idempotent(uuid,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.place_customer_order_idempotent(uuid,jsonb,uuid) to service_role;

-- Lock the table before the group, matching the order placement lock order.
-- One completed transaction covers all orders; reporting continues to sum orders.
create or replace function public.complete_check_group_payment(
  p_store_id bigint, p_group_id bigint, p_method text, p_user_id uuid,
  p_expected_order_ids bigint[], p_expected_total integer
) returns jsonb language plpgsql security definer
set search_path to 'public', 'pg_temp' as $group$
declare
  s public.customer_sessions%rowtype;
  g public.check_groups%rowtype;
  o public.orders%rowtype;
  amount integer := 0;
  order_count integer := 0;
  paid_count integer := 0;
  actual_order_ids bigint[] := array[]::bigint[];
  ts timestamptz := now();
  receipt_prefix text;
begin
  if p_method not in ('cash','paypay') then raise exception 'invalid_payment_method'; end if;
  select * into s from public.customer_sessions
    where store_id = p_store_id and check_group_id = p_group_id limit 1;
  if not found then raise exception 'group_not_found'; end if;
  perform 1 from public.dining_tables
    where id = s.table_id and store_id = p_store_id for update;
  if not found then raise exception 'table_not_found'; end if;
  select * into g from public.check_groups
    where id = p_group_id and store_id = p_store_id for update;
  if not found then raise exception 'group_not_found'; end if;
  if g.status = 'paid' then
    return jsonb_build_object('already_paid',true,'group_id',g.id,
      'total',g.total,'payment_method',g.payment_method,'paid_at',g.closed_at);
  end if;
  if g.status <> 'open' or s.status <> 'open' then raise exception 'group_not_open'; end if;
  for o in select * from public.orders
    where store_id = p_store_id and check_group_id = p_group_id
    order by id for update loop
    if o.table_id is distinct from s.table_id
      or o.customer_session_id is distinct from s.id
      or o.order_channel_code <> 'dine_in' then
      raise exception 'group_order_mismatch';
    end if;
    if o.status <> 'cancelled' then
      order_count := order_count + 1;
      if o.payment_status <> 'unpaid' then raise exception 'group_partially_paid'; end if;
      amount := amount + o.total;
      actual_order_ids := array_append(actual_order_ids,o.id);
    end if;
  end loop;
  if order_count = 0 then raise exception 'group_empty'; end if;
  if p_expected_order_ids is null or p_expected_total is null
    or actual_order_ids <> p_expected_order_ids or amount <> p_expected_total
    then raise exception 'group_changed'; end if;
  receipt_prefix := to_char(ts at time zone 'Asia/Tokyo','YYYYMMDD')||'-G'||g.id::text||'-';
  update public.orders set payment_status = 'paid',payment_method = p_method,
    paid_at = ts,receipt_number = receipt_prefix||id::text
    where store_id = p_store_id and check_group_id = p_group_id and status <> 'cancelled';
  get diagnostics paid_count = row_count;
  if paid_count <> order_count then raise exception 'group_changed'; end if;
  update public.customer_sessions set status = 'closed', closed_at = ts where id = s.id;
  update public.check_groups set status = 'paid', total = amount,
    payment_method = p_method,closed_at = ts where id = g.id;
  insert into public.payment_transactions(store_id,check_group_id,method,amount,status,paid_at)
    values(p_store_id,g.id,p_method,amount,'completed',ts);
  insert into public.order_events(order_id,store_id,event_type,user_id,details)
    select id,p_store_id,'payment_completed',p_user_id,
      jsonb_build_object('method',p_method,'amount',total,'check_group_id',g.id)
    from public.orders where store_id=p_store_id and check_group_id=g.id and status <> 'cancelled';
  return jsonb_build_object('ok',true,'group_id',g.id,'order_count',order_count,
    'total',amount,'payment_method',p_method,'paid_at',ts);
end $group$;

revoke all on function public.complete_check_group_payment(bigint,bigint,text,uuid,bigint[],integer)
  from public,anon,authenticated;
grant execute on function public.complete_check_group_payment(bigint,bigint,text,uuid,bigint[],integer)
  to service_role;

create or replace function public.undo_check_group_payment(
  p_store_id bigint, p_group_id bigint, p_user_id uuid
) returns jsonb language plpgsql security definer
set search_path to 'public', 'pg_temp' as $undo_group$
declare
  s public.customer_sessions%rowtype;
  g public.check_groups%rowtype;
  o public.orders%rowtype;
  tx public.payment_transactions%rowtype;
  count_orders integer := 0;
  previous_method text;
begin
  select * into s from public.customer_sessions
    where store_id=p_store_id and check_group_id=p_group_id limit 1;
  if not found then raise exception 'group_not_found'; end if;
  perform 1 from public.dining_tables
    where id=s.table_id and store_id=p_store_id for update;
  if not found then raise exception 'table_not_found'; end if;
  select * into g from public.check_groups
    where id=p_group_id and store_id=p_store_id for update;
  if not found or g.status <> 'paid' or s.status <> 'closed'
    then raise exception 'group_not_paid'; end if;
  if g.closed_at is null or g.closed_at < now()-interval '5 minutes'
    then raise exception 'undo_window_expired'; end if;
  if exists(select 1 from public.customer_sessions
    where table_id=s.table_id and status='open' and id<>s.id)
    then raise exception 'new_session_exists'; end if;
  previous_method := g.payment_method;
  for o in select * from public.orders
    where store_id=p_store_id and check_group_id=p_group_id
    order by id for update loop
    if o.status <> 'cancelled' then
      if o.customer_session_id is distinct from s.id or o.payment_status <> 'paid'
        or o.payment_method is distinct from previous_method
        then raise exception 'group_order_mismatch'; end if;
      count_orders := count_orders+1;
    end if;
  end loop;
  if count_orders=0 then raise exception 'group_empty'; end if;
  select * into tx from public.payment_transactions
    where store_id=p_store_id and check_group_id=p_group_id and status='completed'
    order by id desc limit 1 for update;
  if not found or tx.amount<>g.total then raise exception 'group_transaction_mismatch'; end if;
  update public.payment_transactions set status='voided' where id=tx.id;
  update public.orders set payment_status='unpaid',payment_method=null,
    paid_at=null,receipt_number=null
    where store_id=p_store_id and check_group_id=p_group_id and status<>'cancelled';
  update public.customer_sessions set status='open',closed_at=null where id=s.id;
  update public.check_groups set status='open',closed_at=null,payment_method=null
    where id=g.id;
  insert into public.order_events(order_id,store_id,event_type,user_id,details)
    select id,p_store_id,'payment_reverted',p_user_id,
      jsonb_build_object('method',previous_method,'amount',total,'check_group_id',g.id)
    from public.orders where store_id=p_store_id and check_group_id=g.id and status<>'cancelled';
  return jsonb_build_object('ok',true,'group_id',g.id,'total',g.total,
    'previous_payment_method',previous_method,
    'external_refund_required',previous_method='paypay');
end $undo_group$;

revoke all on function public.undo_check_group_payment(bigint,bigint,uuid)
  from public,anon,authenticated;
grant execute on function public.undo_check_group_payment(bigint,bigint,uuid)
  to service_role;

-- Per-order payment and undo must not split a visit's group.
do $guard$
declare f text;
begin
  select pg_get_functiondef('public.complete_order_payment(bigint,bigint,text,uuid)'::regprocedure) into f;
  if position('if o.payment_status=' in lower(f)) = 0 then raise exception 'complete_order_payment changed; review guard'; end if;
  f := replace(f, 'if o.payment_status=',
    'if o.check_group_id is not null then raise exception ''group_payment_required''; end if;'||E'\n '||'if o.payment_status=');
  execute f;
  select pg_get_functiondef('public.undo_order_payment(bigint,bigint,uuid)'::regprocedure) into f;
  if position('if o.payment_status <>' in lower(f)) = 0 then raise exception 'undo_order_payment changed; review guard'; end if;
  f := replace(f, 'if o.payment_status <>',
    'if o.check_group_id is not null then raise exception ''group_undo_required''; end if;'||E'\n  '||'if o.payment_status <>');
  execute f;
end $guard$;
