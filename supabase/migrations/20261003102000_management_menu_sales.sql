-- Aggregate menu quantities and line amounts inside Postgres; return one JSON
-- payload so annual results are not clipped by the default row limit.
create or replace function public.management_menu_sales(p_store_id bigint,p_from date,p_to date,p_product_id bigint)
returns jsonb language sql stable security invoker set search_path = 'public','pg_temp' as $menu$
with timezone as (
  select coalesce(nullif(timezone,''),'Asia/Tokyo') tz from public.stores where id=p_store_id
), sold as (
  select oi.product_id,oi.product_name_snapshot,oi.quantity,oi.line_total,o.business_date,
    case when (o.ordered_at at time zone t.tz)::time >= time '11:00' and (o.ordered_at at time zone t.tz)::time < time '15:00' then 'lunch'
         when (o.ordered_at at time zone t.tz)::time >= time '17:00' or (o.ordered_at at time zone t.tz)::time < time '03:00' then 'dinner'
         else 'other' end slot
  from public.orders o join public.order_items oi on oi.order_id=o.id cross join timezone t
  where p_to>p_from and p_to<=(p_from+interval '1 year 1 day')::date
    and o.store_id=p_store_id and o.business_date>=p_from and o.business_date<p_to
    and o.payment_status='paid' and o.status<>'cancelled'
), totals as (
  select product_id,sum(quantity)::bigint quantity,sum(line_total)::numeric amount,
    max(product_name_snapshot) snapshot_name from sold where product_id is not null group by product_id
), catalog as (
  select product_id from public.store_products where store_id=p_store_id
  union select product_id from totals
), products as (
  select c.product_id,coalesce(p.name,t.snapshot_name,'商品 #' || c.product_id::text) name,
    coalesce(t.quantity,0) quantity,coalesce(t.amount,0) amount
  from catalog c left join public.products p on p.id=c.product_id left join totals t using(product_id)
), daily as (
  select business_date,slot,sum(quantity)::bigint quantity,sum(line_total)::numeric amount
  from sold where product_id=p_product_id group by business_date,slot
)
select jsonb_build_object(
  'products',coalesce((select jsonb_agg(jsonb_build_object('id',product_id,'name',name,'quantity',quantity,'amount',amount) order by name,product_id) from products),'[]'::jsonb),
  'daily',coalesce((select jsonb_agg(jsonb_build_object('date',business_date,'slot',slot,'quantity',quantity,'amount',amount) order by business_date,slot) from daily),'[]'::jsonb)
);
$menu$;
revoke all on function public.management_menu_sales(bigint,date,date,bigint) from public,anon,authenticated;
grant execute on function public.management_menu_sales(bigint,date,date,bigint) to service_role;
