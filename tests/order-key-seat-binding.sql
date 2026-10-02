-- Run only after 20261003015500_bind_order_key_to_table.sql is applied.
-- Replays an existing keyed order in a read-only transaction. No order is created.
begin transaction read only;
do $$
declare
  existing_order record;
  own_token uuid;
  other_token uuid;
  result jsonb;
  rejected boolean := false;
begin
  select o.id, o.client_order_key, o.table_id, o.total
    into existing_order
    from public.orders o
    join public.dining_tables t on t.id = o.table_id and t.active = true
    where o.client_order_key is not null
    order by o.id desc limit 1;
  if not found then raise exception 'No active keyed order for replay test'; end if;

  select qr_token into own_token from public.dining_tables where id = existing_order.table_id;
  select qr_token into other_token from public.dining_tables
    where active = true and id <> existing_order.table_id order by id limit 1;
  if other_token is null then raise exception 'Second active table required'; end if;

  result := public.place_customer_order_idempotent(own_token, '[]'::jsonb, existing_order.client_order_key);
  if coalesce((result->>'duplicate')::boolean,false) <> true
     or (result->>'order_id')::bigint <> existing_order.id
     or (result->>'total')::integer <> existing_order.total then
    raise exception 'Same-seat replay did not return original order';
  end if;

  begin
    perform public.place_customer_order_idempotent(other_token, '[]'::jsonb, existing_order.client_order_key);
  exception when sqlstate 'P0001' then
    rejected := sqlerrm = '注文識別番号と席が一致しません';
  end;
  if not rejected then raise exception 'Cross-seat replay was not rejected'; end if;
end $$;
rollback;
