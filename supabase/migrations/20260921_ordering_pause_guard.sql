create or replace function public.place_customer_order_idempotent(
  p_qr_token uuid,
  p_items jsonb,
  p_client_order_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_existing public.orders%rowtype;
  v_result jsonb;
  v_order_id bigint;
begin
  if p_client_order_key is null then
    raise exception '注文識別番号が必要です';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_client_order_key::text, 0));

  select * into v_existing
  from public.orders
  where client_order_key = p_client_order_key
  limit 1;

  if found then
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

  v_result := public.place_customer_order(p_qr_token, p_items);
  v_order_id := (v_result->>'order_id')::bigint;

  update public.orders
  set client_order_key = p_client_order_key
  where id = v_order_id;

  return v_result || jsonb_build_object('duplicate', false);
end;
$function$;
