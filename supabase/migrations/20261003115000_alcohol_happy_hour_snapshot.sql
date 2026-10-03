-- Snapshot the applicable happy-hour window when the item is inserted.
-- Existing items remain NULL (unknown); current rule settings must not be
-- applied retroactively to historical orders.
alter table public.order_items add column if not exists happy_hour_window boolean;

create or replace function public.snapshot_order_item_happy_hour()
returns trigger language plpgsql security invoker
set search_path = 'public','pg_temp' as $snapshot$
declare v_is_alcohol boolean;
begin
  select exists(select 1 from public.products p join public.categories c on c.id=p.category_id
    where p.id=new.product_id and c.name='アルコール') into v_is_alcohol;
  if not v_is_alcohol then return new; end if;
  select exists(
    select 1 from public.orders o join public.stores s on s.id=o.store_id
    join public.price_rules pr on pr.store_id=o.store_id and pr.product_id=new.product_id
    where o.id=new.order_id and pr.active=true and pr.name like '%ハッピーアワー%'
      and (pr.days_of_week is null or extract(dow from (o.ordered_at at time zone coalesce(s.timezone,'Asia/Tokyo')))::integer=any(pr.days_of_week))
      and (pr.start_time is null or pr.end_time is null
        or (pr.start_time<=pr.end_time and (o.ordered_at at time zone coalesce(s.timezone,'Asia/Tokyo'))::time>=pr.start_time and (o.ordered_at at time zone coalesce(s.timezone,'Asia/Tokyo'))::time<pr.end_time)
        or (pr.start_time>pr.end_time and ((o.ordered_at at time zone coalesce(s.timezone,'Asia/Tokyo'))::time>=pr.start_time or (o.ordered_at at time zone coalesce(s.timezone,'Asia/Tokyo'))::time<pr.end_time)))
  ) into new.happy_hour_window;
  return new;
end $snapshot$;
drop trigger if exists order_items_happy_hour_snapshot on public.order_items;
create trigger order_items_happy_hour_snapshot before insert on public.order_items
for each row execute function public.snapshot_order_item_happy_hour();
revoke all on function public.snapshot_order_item_happy_hour() from public,anon,authenticated;
grant execute on function public.snapshot_order_item_happy_hour() to service_role;

create or replace function public.management_alcohol_sales(p_store_id bigint,p_from date,p_to date)
returns jsonb language sql stable security invoker set search_path = 'public','pg_temp' as $alcohol$
with catalog as (
  select p.id,p.name from public.products p join public.categories c on c.id=p.category_id
  join public.store_products sp on sp.product_id=p.id and sp.store_id=p_store_id
  where c.name='アルコール'
), sold as (
  select oi.product_id,oi.quantity,oi.line_total,oi.happy_hour_window
  from public.orders o join public.order_items oi on oi.order_id=o.id
  where p_to>p_from and p_to<=(p_from+interval '1 year 1 day')::date
    and o.store_id=p_store_id and o.business_date>=p_from and o.business_date<p_to
    and o.payment_status='paid' and o.status<>'cancelled'
), totals as (
  select product_id,
    coalesce(sum(quantity) filter(where happy_hour_window is true),0)::bigint happy_quantity,
    coalesce(sum(quantity) filter(where happy_hour_window is false),0)::bigint other_quantity,
    coalesce(sum(quantity) filter(where happy_hour_window is null),0)::bigint unknown_quantity,
    coalesce(sum(line_total) filter(where happy_hour_window is true),0)::numeric happy_amount,
    coalesce(sum(line_total) filter(where happy_hour_window is false),0)::numeric other_amount
  from sold group by product_id
)
select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,
  'happy_quantity',coalesce(t.happy_quantity,0),'other_quantity',coalesce(t.other_quantity,0),
  'unknown_quantity',coalesce(t.unknown_quantity,0),'happy_amount',coalesce(t.happy_amount,0),
  'other_amount',coalesce(t.other_amount,0)) order by c.id),'[]'::jsonb)
from catalog c left join totals t on t.product_id=c.id;
$alcohol$;
revoke all on function public.management_alcohol_sales(bigint,date,date) from public,anon,authenticated;
grant execute on function public.management_alcohol_sales(bigint,date,date) to service_role;
