-- Day and month reports select by orders.business_date. Record it at insertion.
-- An overnight business period belongs to the date on which it opened.
create or replace function public.set_order_business_date()
returns trigger language plpgsql security invoker
set search_path to 'public', 'pg_temp' as $business_date$
declare
  local_time timestamp;
  store_timezone text;
  period_start time;
  period_end time;
begin
  if new.business_date is not null then return new; end if;
  select timezone into store_timezone from public.stores where id=new.store_id;
  if not found then raise exception 'store_not_found'; end if;
  local_time := coalesce(new.ordered_at,now()) at time zone coalesce(store_timezone,'Asia/Tokyo');
  if new.business_period_id is not null then
    select start_time,end_time into period_start,period_end
      from public.business_periods
      where id=new.business_period_id and store_id=new.store_id;
  end if;
  new.business_date := local_time::date - case
    when period_start > period_end and local_time::time < period_end then 1
    else 0 end;
  return new;
end $business_date$;

drop trigger if exists orders_set_business_date on public.orders;
create trigger orders_set_business_date before insert on public.orders
  for each row execute function public.set_order_business_date();

-- Keep any previously assigned date. Existing undated rows receive a date.
update public.orders o
set business_date = (o.ordered_at at time zone coalesce(s.timezone,'Asia/Tokyo'))::date
  - case when exists(select 1 from public.business_periods bp
      where bp.id=o.business_period_id and bp.store_id=o.store_id
        and bp.start_time>bp.end_time
        and (o.ordered_at at time zone coalesce(s.timezone,'Asia/Tokyo'))::time<bp.end_time)
    then 1 else 0 end
from public.stores s
where o.store_id=s.id and o.business_date is null;
