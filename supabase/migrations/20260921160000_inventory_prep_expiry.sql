-- Atomic preparation, expiry tracking and lot-level waste.

alter table public.inventory_lots
  add column if not exists prepared_at timestamptz,
  add column if not exists prepared_by uuid references auth.users(id),
  add column if not exists prep_task_id bigint references public.prep_tasks(id);

alter table public.prep_tasks
  add column if not exists input_item_id bigint references public.inventory_items(id),
  add column if not exists input_quantity numeric,
  add column if not exists output_item_id bigint references public.inventory_items(id),
  add column if not exists output_lot_id bigint references public.inventory_lots(id),
  add column if not exists expires_on date,
  add column if not exists created_by uuid references auth.users(id);

alter table public.inventory_movements
  drop constraint if exists inventory_movements_movement_type_check;
alter table public.inventory_movements
  add constraint inventory_movements_movement_type_check check (
    movement_type = any (array[
      'purchase','usage','adjustment','waste','transfer_in','transfer_out',
      'prep_input','prep_output'
    ]::text[])
  );

alter table public.inventory_lots
  add constraint inventory_lots_quantity_nonnegative check (quantity >= 0) not valid;
alter table public.inventory_lots validate constraint inventory_lots_quantity_nonnegative;

create index if not exists inventory_lots_store_expiry_active_idx
  on public.inventory_lots (store_id, expires_on, created_at)
  where status = 'active' and quantity > 0;
create index if not exists prep_tasks_store_business_date_idx
  on public.prep_tasks (store_id, business_date desc, created_at desc);

create or replace function public.complete_inventory_prep(
  p_store_id bigint,
  p_input_item_id bigint,
  p_input_quantity numeric,
  p_output_item_id bigint,
  p_output_quantity numeric,
  p_expires_on date,
  p_user_id uuid,
  p_note text default null
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company_id bigint;
  v_input_name text;
  v_output_name text;
  v_output_life integer;
  v_count_quantity numeric;
  v_counted_at timestamptz;
  v_stock numeric;
  v_task_id bigint;
  v_lot_id bigint;
  v_now timestamptz := now();
  v_business_date date := (v_now at time zone 'Asia/Tokyo')::date;
  v_expires_on date;
begin
  if p_input_quantity <= 0 or p_output_quantity <= 0 then
    raise exception '仕込み数量は0より大きくしてください';
  end if;
  if p_input_item_id = p_output_item_id then
    raise exception '仕込み前と仕込み後は別の品目を選んでください';
  end if;

  perform pg_advisory_xact_lock(p_store_id::integer, least(p_input_item_id, p_output_item_id)::integer);
  perform pg_advisory_xact_lock(p_store_id::integer, greatest(p_input_item_id, p_output_item_id)::integer);

  select b.company_id into v_company_id
  from public.stores s join public.brands b on b.id = s.brand_id
  where s.id = p_store_id;
  if v_company_id is null then raise exception '店舗が見つかりません'; end if;

  select name into v_input_name from public.inventory_items
  where id = p_input_item_id and company_id = v_company_id and active;
  select name, shelf_life_days into v_output_name, v_output_life from public.inventory_items
  where id = p_output_item_id and company_id = v_company_id and active and item_type = 'prepared';
  if v_input_name is null or v_output_name is null then
    raise exception '仕込み品目が見つかりません';
  end if;

  select quantity, counted_at into v_count_quantity, v_counted_at
  from public.inventory_counts
  where store_id = p_store_id and inventory_item_id = p_input_item_id
  order by counted_at desc limit 1;

  if v_counted_at is null then
    select coalesce(sum(quantity), 0) into v_stock
    from public.inventory_movements
    where store_id = p_store_id and inventory_item_id = p_input_item_id;
  else
    select v_count_quantity + coalesce(sum(quantity), 0) into v_stock
    from public.inventory_movements
    where store_id = p_store_id and inventory_item_id = p_input_item_id
      and occurred_at > v_counted_at;
  end if;
  if v_stock < p_input_quantity then
    raise exception '%の在庫が不足しています（現在 %）', v_input_name, v_stock;
  end if;

  v_expires_on := coalesce(p_expires_on, case when v_output_life is not null then v_business_date + v_output_life end);

  insert into public.prep_tasks (
    store_id, business_date, planned_quantity, completed_quantity, status,
    assigned_user_id, completed_at, note, input_item_id, input_quantity,
    output_item_id, expires_on, created_by
  ) values (
    p_store_id, v_business_date, p_output_quantity, p_output_quantity, 'done',
    p_user_id, v_now, nullif(left(trim(coalesce(p_note,'')),500),''),
    p_input_item_id, p_input_quantity, p_output_item_id, v_expires_on, p_user_id
  ) returning id into v_task_id;

  insert into public.inventory_lots (
    store_id, inventory_item_id, quantity, received_on, expires_on,
    lot_code, status, prepared_at, prepared_by, prep_task_id
  ) values (
    p_store_id, p_output_item_id, p_output_quantity, v_business_date, v_expires_on,
    'PREP-' || v_business_date || '-' || v_task_id, 'active', v_now, p_user_id, v_task_id
  ) returning id into v_lot_id;

  update public.prep_tasks set output_lot_id = v_lot_id where id = v_task_id;

  insert into public.inventory_movements
    (store_id, inventory_item_id, movement_type, quantity, note, occurred_at)
  values
    (p_store_id, p_input_item_id, 'prep_input', -p_input_quantity,
      '仕込み #' || v_task_id || ' → ' || v_output_name, v_now),
    (p_store_id, p_output_item_id, 'prep_output', p_output_quantity,
      '仕込み #' || v_task_id || ' ← ' || v_input_name, v_now);

  return jsonb_build_object('task_id',v_task_id,'lot_id',v_lot_id,'expires_on',v_expires_on);
end;
$$;

create or replace function public.record_inventory_lot_waste(
  p_store_id bigint,
  p_lot_id bigint,
  p_quantity numeric,
  p_reason text,
  p_user_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_lot public.inventory_lots%rowtype;
  v_item public.inventory_items%rowtype;
  v_waste_id bigint;
  v_remaining numeric;
  v_business_date date := (now() at time zone 'Asia/Tokyo')::date;
begin
  if p_quantity <= 0 then raise exception '廃棄数量は0より大きくしてください'; end if;
  select * into v_lot from public.inventory_lots
  where id = p_lot_id and store_id = p_store_id for update;
  if not found or v_lot.status <> 'active' then raise exception '対象ロットが見つかりません'; end if;
  if v_lot.quantity < p_quantity then raise exception 'ロット残量を超えて廃棄できません'; end if;
  select * into v_item from public.inventory_items where id = v_lot.inventory_item_id;

  v_remaining := v_lot.quantity - p_quantity;
  update public.inventory_lots
  set quantity = v_remaining, status = case when v_remaining = 0 then 'consumed' else status end
  where id = p_lot_id;

  insert into public.inventory_movements
    (store_id, inventory_item_id, movement_type, quantity, unit_cost, note)
  values (p_store_id, v_lot.inventory_item_id, 'waste', -p_quantity, v_item.unit_cost,
    'ロット ' || coalesce(v_lot.lot_code,p_lot_id::text) || ' / ' || left(trim(coalesce(p_reason,'期限・品質')),500));

  insert into public.inventory_waste
    (store_id, inventory_item_id, business_date, quantity, reason, cost_amount, recorded_by)
  values (p_store_id, v_lot.inventory_item_id, v_business_date, p_quantity,
    left(trim(coalesce(p_reason,'期限・品質')),500),
    case when v_item.unit_cost > 0 then round(p_quantity * v_item.unit_cost)::integer end, p_user_id)
  returning id into v_waste_id;

  return jsonb_build_object('waste_id',v_waste_id,'remaining_quantity',v_remaining);
end;
$$;

revoke all on function public.complete_inventory_prep(bigint,bigint,numeric,bigint,numeric,date,uuid,text) from public, anon, authenticated;
grant execute on function public.complete_inventory_prep(bigint,bigint,numeric,bigint,numeric,date,uuid,text) to service_role;
revoke all on function public.record_inventory_lot_waste(bigint,bigint,numeric,text,uuid) from public, anon, authenticated;
grant execute on function public.record_inventory_lot_waste(bigint,bigint,numeric,text,uuid) to service_role;
