-- Run in a test database after 20261003021000_customer_session_group_checkout.sql.
-- All temporary orders, transactions, and events roll back.
begin;
do $$
declare
  t record;
  gid bigint;
  sid uuid;
  first_id bigint;
  second_id bigint;
  next_gid bigint;
  result jsonb;
  rejected boolean;
begin
  select id,store_id into t from public.dining_tables
    where active=true and seat_type is distinct from 'other' order by id limit 1;
  if t.id is null then raise exception 'No active dine-in table'; end if;
  insert into public.check_groups(store_id) values(t.store_id) returning id into gid;
  insert into public.customer_sessions(store_id,table_id,check_group_id)
    values(t.store_id,t.id,gid) returning id into sid;
  insert into public.orders(store_id,table_id,customer_session_id,check_group_id,total,subtotal)
    values(t.store_id,t.id,sid,gid,1000,1000) returning id into first_id;
  insert into public.orders(store_id,table_id,customer_session_id,check_group_id,total,subtotal)
    values(t.store_id,t.id,sid,gid,400,400) returning id into second_id;

  rejected:=false;
  begin
    perform public.complete_check_group_payment(t.store_id,gid,'cash',null,
      array[first_id,second_id],1000);
  exception when sqlstate 'P0001' then rejected:=sqlerrm='group_changed'; end;
  if not rejected then raise exception 'Changed total was accepted'; end if;
  if exists(select 1 from public.orders where id in (first_id,second_id) and payment_status='paid')
    then raise exception 'Partial payment was saved'; end if;

  result:=public.complete_check_group_payment(t.store_id,gid,'cash',null,
    array[first_id,second_id],1400);
  if (result->>'total')::integer<>1400 or (result->>'order_count')::integer<>2
    then raise exception 'Group total or count incorrect'; end if;
  result:=public.complete_check_group_payment(t.store_id,gid,'cash',null,
    array[first_id,second_id],1400);
  if (result->>'already_paid')::boolean is distinct from true
    then raise exception 'Replay charged again'; end if;
  if (select count(*) from public.payment_transactions
      where check_group_id=gid and status='completed')<>1
    then raise exception 'Expected one completed group transaction'; end if;
  if (select count(distinct receipt_number) from public.orders
      where id in (first_id,second_id) and payment_status='paid')<>2
    then raise exception 'Paid orders or receipt numbers incorrect'; end if;

  rejected:=false;
  begin
    perform public.undo_order_payment(t.store_id,first_id,null);
  exception when sqlstate 'P0001' then rejected:=sqlerrm='group_undo_required'; end;
  if not rejected then raise exception 'Per-order undo split the group'; end if;

  result:=public.undo_check_group_payment(t.store_id,gid,null);
  if (result->>'total')::integer<>1400 then raise exception 'Undo total incorrect'; end if;
  if exists(select 1 from public.orders where id in (first_id,second_id)
    and (payment_status<>'unpaid' or receipt_number is not null))
    then raise exception 'Group undo did not restore orders'; end if;
  if (select count(*) from public.payment_transactions
      where check_group_id=gid and status='completed')<>0
    then raise exception 'Group transaction still completed after undo'; end if;

  perform public.complete_check_group_payment(t.store_id,gid,'paypay',null,
    array[first_id,second_id],1400);
  insert into public.check_groups(store_id) values(t.store_id) returning id into next_gid;
  insert into public.customer_sessions(store_id,table_id,check_group_id)
    values(t.store_id,t.id,next_gid);
  rejected:=false;
  begin
    perform public.undo_check_group_payment(t.store_id,gid,null);
  exception when sqlstate 'P0001' then rejected:=sqlerrm='new_session_exists'; end;
  if not rejected then raise exception 'Undo reopened an old visit over the next visit'; end if;
end $$;
rollback;
