-- orders.payment_status accepts `unpaid`, not `pending`.
-- Preserve the current function body (including gift voucher restoration) and
-- update only the invalid state written by the payment undo path.
do $migration$
declare
  v_definition text;
begin
  select pg_get_functiondef(p.oid)
    into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'undo_order_payment'
    and pg_get_function_identity_arguments(p.oid) =
      'p_store_id bigint, p_order_id bigint, p_user_id uuid';

  if v_definition is null then
    raise exception 'undo_order_payment function not found';
  end if;

  v_definition := replace(
    v_definition,
    'set payment_status = ''pending'', payment_method = null, paid_at = null, receipt_number = null',
    'set payment_status = ''unpaid'', payment_method = null, paid_at = null, receipt_number = null'
  );

  execute v_definition;
end
$migration$;
