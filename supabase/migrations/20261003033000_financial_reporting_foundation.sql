-- Management reports aggregate in Postgres so a decade is only 120 rows in the API.
-- Amounts are stored gross (tax-inclusive); these are not final tax books.
alter table public.store_expenses
  add column if not exists vendor_name text,
  add column if not exists tax_category text not null default 'unknown',
  add column if not exists invoice_registration_number text,
  add column if not exists receipt_import_id bigint references public.receipt_imports(id),
  add column if not exists recorded_by uuid,
  add column if not exists voided_at timestamptz;

alter table public.store_expenses drop constraint if exists store_expenses_tax_category_check;
alter table public.store_expenses add constraint store_expenses_tax_category_check
  check (tax_category in ('unknown','taxable_10','taxable_8','non_taxable','exempt','out_of_scope'));
create index if not exists orders_store_business_date_paid_idx on public.orders(store_id,business_date)
  where payment_status='paid' and status <> 'cancelled';
create index if not exists store_expenses_store_date_idx on public.store_expenses(store_id,expense_date)
  where voided_at is null;
create index if not exists work_shifts_store_date_finance_idx on public.work_shifts(store_id,shift_date);

create or replace function public.management_financial_months(p_store_id bigint,p_from date,p_to date)
returns table (
  month date, sales numeric, order_count bigint, guest_count bigint, estimated_cogs numeric,
  labor numeric, expenses numeric, waste numeric, staff_consumption numeric, channel_fees numeric,
  expense_categories jsonb, expense_count bigint, unknown_tax_count bigint,
  missing_vendor_count bigint, missing_evidence_count bigint
)
language sql stable security invoker set search_path = 'public','pg_temp' as $report$
with months as (
  select generate_series(date_trunc('month',p_from)::date,
    date_trunc('month',(p_to-1))::date,interval '1 month')::date as month
  where p_to>p_from and p_to<=p_from+interval '10 years'
), paid as (
  select o.id,o.total,o.guest_count,o.business_date,o.check_group_id,o.order_channel_code
  from public.orders o
  where o.store_id=p_store_id and o.business_date>=p_from and o.business_date<p_to
    and o.payment_status='paid' and o.status <> 'cancelled'
), revenue as (
  select date_trunc('month',business_date)::date month,sum(total)::numeric sales,
    count(*)::bigint order_count,sum(greatest(coalesce(guest_count,1),1))::bigint guest_count
  from paid group by 1
), cost as (
  select date_trunc('month',p.business_date)::date month,
    sum(oi.quantity*coalesce(pr.cost_price,0))::numeric estimated_cogs
  from paid p join public.order_items oi on oi.order_id=p.id
  left join public.products pr on pr.id=oi.product_id group by 1
), fee_groups as (
  select date_trunc('month',business_date)::date month,
    coalesce(order_channel_code,'dine_in') channel_code,
    case when check_group_id is null then 'o:' || id::text else 'g:' || check_group_id::text end visit_key,
    sum(total)::numeric group_sales
  from paid group by 1,2,3
), fee_rules as (
  select distinct on (channel_code) channel_code,percent_fee,fixed_fee
  from public.channel_fee_rules where store_id=p_store_id and active=true
  order by channel_code,starts_on desc nulls last,id desc
), fees as (
  select f.month,sum(round(f.group_sales*coalesce(r.percent_fee,0)/100+coalesce(r.fixed_fee,0)))::numeric channel_fees
  from fee_groups f join fee_rules r using(channel_code) group by 1
), shifts as (
  select date_trunc('month',shift_date)::date month,sum(coalesce(labor_cost,0))::numeric labor
  from public.work_shifts where store_id=p_store_id and shift_date>=p_from and shift_date<p_to group by 1
), exp_by_category as (
  select date_trunc('month',expense_date)::date month,category,sum(amount)::numeric amount
  from public.store_expenses where store_id=p_store_id and expense_date>=p_from and expense_date<p_to
    and voided_at is null group by 1,2
), exp_categories as (
  select month,jsonb_object_agg(coalesce(category,'未分類'),amount) categories
  from exp_by_category group by month
), exp as (
  select date_trunc('month',expense_date)::date month,sum(amount)::numeric expenses,
    count(*)::bigint expense_count,
    count(*) filter(where tax_category='unknown')::bigint unknown_tax_count,
    count(*) filter(where nullif(trim(vendor_name),'') is null)::bigint missing_vendor_count,
    count(*) filter(where receipt_import_id is null)::bigint missing_evidence_count
  from public.store_expenses where store_id=p_store_id and expense_date>=p_from and expense_date<p_to
    and voided_at is null group by 1
), waste_rows as (
  select date_trunc('month',business_date)::date month,sum(coalesce(cost_amount,0))::numeric waste
  from public.inventory_waste where store_id=p_store_id and business_date>=p_from and business_date<p_to group by 1
), staff_rows as (
  select date_trunc('month',business_date)::date month,sum(coalesce(cost_amount,0))::numeric staff_consumption
  from public.staff_consumption_events where store_id=p_store_id and business_date>=p_from and business_date<p_to
    and event_type <> 'waste' group by 1
)
select m.month,coalesce(r.sales,0),coalesce(r.order_count,0),coalesce(r.guest_count,0),
  coalesce(c.estimated_cogs,0),coalesce(s.labor,0),coalesce(e.expenses,0),
  coalesce(w.waste,0),coalesce(sc.staff_consumption,0),coalesce(f.channel_fees,0),coalesce(ec.categories,'{}'::jsonb),
  coalesce(e.expense_count,0),coalesce(e.unknown_tax_count,0),
  coalesce(e.missing_vendor_count,0),coalesce(e.missing_evidence_count,0)
from months m left join revenue r using(month) left join cost c using(month)
left join shifts s using(month) left join exp e using(month)
left join waste_rows w using(month) left join staff_rows sc using(month) left join fees f using(month)
left join exp_categories ec using(month) order by m.month;
$report$;
-- The Edge Function checks store membership and uses the service role. No direct client RPC.
revoke all on function public.management_financial_months(bigint,date,date) from public,anon,authenticated;
grant execute on function public.management_financial_months(bigint,date,date) to service_role;

-- Idempotent expense entry with an audit row in the same transaction.
alter table public.store_expenses add column if not exists entry_key uuid;
create unique index if not exists store_expenses_store_entry_key_idx on public.store_expenses(store_id,entry_key);
create or replace function public.record_management_expense(
  p_store_id bigint,p_user_id uuid,p_date date,p_category text,p_name text,
  p_amount integer,p_vendor text,p_tax text,p_key uuid
) returns bigint language plpgsql security invoker
set search_path = 'public','pg_temp' as $expense$
declare v_id bigint;
begin
  if p_amount<=0 or length(p_category)>80 or length(p_name)>200 or length(coalesce(p_vendor,''))>200
    or p_tax not in ('unknown','taxable_10','taxable_8','non_taxable','exempt','out_of_scope')
    then raise exception 'invalid_expense'; end if;
  insert into public.store_expenses(store_id,expense_date,category,name,amount,expense_type,vendor_name,tax_category,recorded_by,entry_key)
  values(p_store_id,p_date,p_category,p_name,p_amount,'variable',p_vendor,p_tax,p_user_id,p_key)
  on conflict (store_id,entry_key) do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.store_expenses where store_id=p_store_id and entry_key=p_key;
    return v_id;
  end if;
  insert into public.audit_logs(store_id,user_id,action,entity_type,entity_id,details)
  values(p_store_id,p_user_id,'management_expense_recorded','store_expense',v_id::text,
    jsonb_build_object('expense_date',p_date,'amount',p_amount,'category',p_category));
  return v_id;
end $expense$;
revoke all on function public.record_management_expense(bigint,uuid,date,text,text,integer,text,text,uuid) from public,anon,authenticated;
grant execute on function public.record_management_expense(bigint,uuid,date,text,text,integer,text,text,uuid) to service_role;
