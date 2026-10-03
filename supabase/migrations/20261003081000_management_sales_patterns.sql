-- One selected year of store-local sales, grouped by weekday and month segment.
-- A recorded day is one with paid orders or a daily closing; missing closing records
-- can make the per-day average look higher than the actual operating-day average.
create or replace function public.management_sales_patterns(p_store_id bigint, p_from date, p_to date)
returns table (dimension text, bucket integer, slot text, sales numeric, order_count bigint, visit_count bigint, recorded_days bigint)
language sql stable security invoker set search_path = 'public','pg_temp' as $patterns$
with timezone as (
  select coalesce(nullif(s.timezone,''),'Asia/Tokyo') tz from public.stores s where s.id=p_store_id
), paid as (
  select o.id,o.business_date,o.total,o.check_group_id,
    case when (o.ordered_at at time zone t.tz)::time >= time '11:00' and (o.ordered_at at time zone t.tz)::time < time '15:00' then 'lunch'
         when (o.ordered_at at time zone t.tz)::time >= time '17:00' or (o.ordered_at at time zone t.tz)::time < time '03:00' then 'dinner'
         else 'other' end slot
  from public.orders o cross join timezone t
  where p_to > p_from and p_to <= (p_from + interval '1 year 1 day')::date
    and o.store_id=p_store_id and o.business_date>=p_from and o.business_date<p_to
    and o.payment_status='paid' and o.status <> 'cancelled'
), dates as (
  select business_date from paid
  union
  select c.business_date from public.daily_closings c
  where c.store_id=p_store_id and c.business_date>=p_from and c.business_date<p_to
), per_visit as (
  select business_date,slot,
    case when check_group_id is null then 'o:' || id::text else 'g:' || check_group_id::text end visit_key,
    sum(total)::numeric sales,count(*)::bigint order_count
  from paid group by 1,2,3
), by_day as (
  select business_date,slot,sum(sales)::numeric sales,sum(order_count)::bigint order_count,count(*)::bigint visit_count
  from per_visit group by 1,2
), dimensions as (
  select 'weekday'::text dimension,extract(isodow from business_date)::integer bucket,business_date from dates
  union all
  select 'month_part',case when extract(day from business_date)<=10 then 1 when extract(day from business_date)<=20 then 2 else 3 end,business_date from dates
), day_counts as (
  select dimension,bucket,count(*)::bigint recorded_days from dimensions group by 1,2
), totals as (
  select d.dimension,d.bucket,b.slot,sum(b.sales)::numeric sales,sum(b.order_count)::bigint order_count,sum(b.visit_count)::bigint visit_count
  from dimensions d join by_day b using(business_date) group by 1,2,3
), buckets as (
  select 'weekday'::text dimension,generate_series(1,7) bucket
  union all select 'month_part',generate_series(1,3)
), slots as (select unnest(array['lunch','dinner','other']) slot)
select x.dimension,x.bucket,s.slot,coalesce(t.sales,0),coalesce(t.order_count,0),coalesce(t.visit_count,0),coalesce(dc.recorded_days,0)
from buckets x cross join slots s left join totals t on t.dimension=x.dimension and t.bucket=x.bucket and t.slot=s.slot
left join day_counts dc on dc.dimension=x.dimension and dc.bucket=x.bucket
order by x.dimension,x.bucket,s.slot;
$patterns$;
revoke all on function public.management_sales_patterns(bigint,date,date) from public,anon,authenticated;
grant execute on function public.management_sales_patterns(bigint,date,date) to service_role;
