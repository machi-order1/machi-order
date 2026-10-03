-- Channel breakdown is based on paid orders, with a store-wide recorded-day
-- denominator so zero-sales days remain visible for each channel.
create or replace function public.management_sales_channel_patterns(p_store_id bigint,p_from date,p_to date)
returns table (dimension text,bucket integer,slot text,channel_code text,sales numeric,order_count bigint,visit_count bigint,recorded_days bigint)
language sql stable security invoker set search_path = 'public','pg_temp' as $channels$
with store_timezone as (
  select coalesce(nullif(s.timezone,''),'Asia/Tokyo') tz from public.stores s where s.id=p_store_id
), paid as (
  select o.id,o.business_date,o.total,o.check_group_id,
    case when coalesce(o.order_channel_code,'dine_in') in ('dine_in','takeout','uber_eats','rocket_now')
      then coalesce(o.order_channel_code,'dine_in') else 'other' end channel_code,
    case when (o.ordered_at at time zone t.tz)::time >= time '11:00' and (o.ordered_at at time zone t.tz)::time < time '15:00' then 'lunch'
         when (o.ordered_at at time zone t.tz)::time >= time '17:00' or (o.ordered_at at time zone t.tz)::time < time '03:00' then 'dinner'
         else 'other' end slot,
    case when o.check_group_id is null then 'o:' || o.id::text else 'g:' || o.check_group_id::text end visit_key
  from public.orders o cross join store_timezone t
  where p_to>p_from and p_to<=(p_from+interval '1 year 1 day')::date
    and o.store_id=p_store_id and o.business_date>=p_from and o.business_date<p_to
    and o.payment_status='paid' and o.status<>'cancelled'
), dates as (
  select business_date from paid
  union
  select c.business_date from public.daily_closings c
  where c.store_id=p_store_id and c.business_date>=p_from and c.business_date<p_to
), dimensions as (
  select 'weekday'::text dimension,extract(isodow from business_date)::integer bucket,business_date from dates
  union all
  select 'month_part',case when extract(day from business_date)<=10 then 1 when extract(day from business_date)<=20 then 2 else 3 end,business_date from dates
  union all
  select 'month',extract(month from business_date)::integer,business_date from dates
), day_counts as (
  select dimension,bucket,count(*)::bigint recorded_days from dimensions group by 1,2
), timed as (
  select d.dimension,d.bucket,p.slot,p.channel_code,sum(p.total)::numeric sales,count(*)::bigint order_count,
    count(distinct (p.business_date,p.visit_key))::bigint visit_count
  from paid p join dimensions d using(business_date)
  where d.dimension<>'month' group by 1,2,3,4
), monthly as (
  select 'month'::text dimension,extract(month from p.business_date)::integer bucket,'all'::text slot,p.channel_code,
    sum(p.total)::numeric sales,count(*)::bigint order_count,count(distinct (p.business_date,p.visit_key))::bigint visit_count
  from paid p group by 2,4
), totals as (select * from timed union all select * from monthly),
slots as (select unnest(array['lunch','dinner','other']) slot),
channels as (select unnest(array['dine_in','takeout','uber_eats','rocket_now','other']) channel_code),
buckets as (
  select 'weekday'::text dimension,generate_series(1,7) bucket
  union all select 'month_part',generate_series(1,3)
  union all select 'month',generate_series(1,12)
)
select b.dimension,b.bucket,s.slot,c.channel_code,coalesce(t.sales,0),coalesce(t.order_count,0),coalesce(t.visit_count,0),coalesce(dc.recorded_days,0)
from buckets b cross join channels c
cross join lateral (select slot from slots where b.dimension<>'month' union all select 'all' where b.dimension='month') s
left join totals t on t.dimension=b.dimension and t.bucket=b.bucket and t.slot=s.slot and t.channel_code=c.channel_code
left join day_counts dc on dc.dimension=b.dimension and dc.bucket=b.bucket
order by b.dimension,b.bucket,s.slot,c.channel_code;
$channels$;
revoke all on function public.management_sales_channel_patterns(bigint,date,date) from public,anon,authenticated;
grant execute on function public.management_sales_channel_patterns(bigint,date,date) to service_role;
