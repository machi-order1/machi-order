create or replace function public.undo_order_payment(
  p_store_id bigint,
  p_order_id bigint,
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  o public.orders%rowtype;
  previous_method text;
  previous_receipt text;
begin
  select * into o
  from public.orders
  where id = p_order_id and store_id = p_store_id
  for update;

  if not found then raise exception 'order_not_found'; end if;
  if o.payment_status <> 'paid' then raise exception 'not_paid'; end if;
  if o.paid_at is null or o.paid_at < now() - interval '5 minutes' then
    raise exception 'undo_window_expired';
  end if;

  previous_method := o.payment_method;
  previous_receipt := o.receipt_number;

  update public.orders
  set payment_status = 'pending', payment_method = null, paid_at = null, receipt_number = null
  where id = o.id;

  update public.payment_transactions
  set status = 'voided'
  where id = (
    select id from public.payment_transactions
    where store_id = p_store_id and order_id = o.id and status = 'completed'
    order by paid_at desc nulls last, id desc
    limit 1
  );

  insert into public.order_events(order_id, store_id, event_type, user_id, details)
  values (
    o.id,
    p_store_id,
    'payment_reverted',
    p_user_id,
    jsonb_build_object('method', previous_method, 'amount', o.total, 'receipt_number', previous_receipt)
  );

  return jsonb_build_object(
    'ok', true,
    'order_id', o.id,
    'total', o.total,
    'previous_payment_method', previous_method,
    'external_refund_required', previous_method = 'paypay'
  );
end
$function$;

revoke all on function public.undo_order_payment(bigint, bigint, uuid) from public, anon, authenticated;
grant execute on function public.undo_order_payment(bigint, bigint, uuid) to service_role;
