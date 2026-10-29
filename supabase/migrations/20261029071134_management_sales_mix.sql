-- Read-only management aggregates. The Edge Function authorizes store membership.
-- Do not expose this service-role-only RPC directly to browser clients.
create or replace function public.management_sales_mix(
  p_store_id bigint, p_from date, p_to date
) returns jsonb
language plpgsql stable
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if p_store_id is null or p_from is null or p_to is null or p_to <= p_from
     or p_to > p_from + interval '20 years' then
    raise exception 'invalid_sales_mix_range';
  end if;

  with paid as (
    select o.id, o.business_date, o.total, o.business_period_id,
      case when bp.name like '%昼%' then 'lunch'
           when bp.name like '%夜%' then 'dinner' else 'other' end slot
    from public.orders o
    left join public.business_periods bp on bp.id = o.business_period_id and bp.store_id = o.store_id
    where o.store_id = p_store_id and o.business_date >= p_from and o.business_date < p_to
      and o.payment_status = 'paid' and o.status <> 'cancelled'
  ), items as (
    select p.id order_id, p.slot, oi.id item_id, oi.product_id,
      oi.product_name_snapshot name, oi.quantity, oi.line_total,
      (coalesce(pr.category_id = 1, false) or oi.product_name_snapshot like '%油そば%') is_noodle,
      case when oi.product_name_snapshot ~ '^[A-EＡ-Ｅ][ 　].*セット' then
        translate(left(oi.product_name_snapshot, 1), 'ＡＢＣＤＥ', 'ABCDE')
      else null end set_code
    from paid p join public.order_items oi on oi.order_id = p.id
    left join public.products pr on pr.id = oi.product_id
  ), order_flags as (
    select p.id, p.slot, bool_or(coalesce(i.is_noodle,false)) has_noodle,
      bool_or(i.set_code is not null) has_set
    from paid p left join items i on i.order_id = p.id
    group by p.id,p.slot
  ), sales as (
    select count(*) orders, coalesce(sum(total),0) amount from paid
  ), slots as (
    select slot, count(*) orders, sum(total) amount from paid group by slot
  ), products as (
    select product_id, name, sum(quantity) cups, sum(line_total) line_sales
    from items where is_noodle group by product_id,name
  ), flavors as (
    select case when name like '%博多油そば%' then 'hakata'
                when name like '%えび塩油そば%' then 'ebi_shio' else 'other' end flavor,
      sum(quantity) cups from items where is_noodle group by 1
  ), rice_bowls as (
    select name, sum(quantity) units
    from items where name like '%チャーシュー丼%' and set_code is null
    group by name
  ), sizes as (
    select i.slot, coalesce((
      select case when opt.option_name_snapshot in ('半玉','普通','大盛','W玉','W盛り')
        then case when opt.option_name_snapshot = 'W盛り' then 'W玉' else opt.option_name_snapshot end
        else null end
      from public.order_item_options opt
      where opt.order_item_id = i.item_id and opt.option_name_snapshot in ('半玉','普通','大盛','W玉','W盛り')
      order by opt.id limit 1
    ), '未記録') size, sum(i.quantity) cups
    from items i where i.is_noodle group by i.slot, size
  ), set_counts as (
    select i.slot,i.set_code,sum(i.quantity) units,count(distinct i.order_id) order_count
    from items i where i.set_code is not null group by i.slot,i.set_code
  ), attach as (
    select slot, count(*) filter(where has_noodle) noodle_orders,
      count(*) filter(where has_noodle and has_set) with_set_orders
    from order_flags group by slot
  ), attach_by_set as (
    select i.slot,i.set_code,count(distinct i.order_id) noodle_orders_with_set
    from items i join order_flags o on o.id=i.order_id and o.has_noodle
    where i.set_code is not null group by i.slot,i.set_code
  )
  select jsonb_build_object(
    'sales', (select jsonb_build_object('amount',amount,'orders',orders) from sales),
    'slots', coalesce((select jsonb_agg(jsonb_build_object('slot',slot,'amount',amount,'orders',orders)) from slots),'[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object('product_id',product_id,'name',name,'cups',cups,'line_sales',line_sales) order by cups desc,name) from products),'[]'::jsonb),
    'flavors', coalesce((select jsonb_agg(jsonb_build_object('flavor',flavor,'cups',cups)) from flavors),'[]'::jsonb),
    'chashu_rice_bowls', coalesce((select jsonb_agg(jsonb_build_object('name',name,'units',units) order by name) from rice_bowls),'[]'::jsonb),
    'sizes', coalesce((select jsonb_agg(jsonb_build_object('slot',slot,'size',size,'cups',cups)) from sizes),'[]'::jsonb),
    'sets', coalesce((select jsonb_agg(jsonb_build_object('slot',s.slot,'code',s.set_code,'units',s.units,'order_count',s.order_count,
      'noodle_orders_with_set',coalesce(a.noodle_orders_with_set,0))) from set_counts s
      left join attach_by_set a on a.slot=s.slot and a.set_code=s.set_code),'[]'::jsonb),
    'attach', coalesce((select jsonb_agg(jsonb_build_object('slot',slot,'noodle_orders',noodle_orders,'with_set_orders',with_set_orders)) from attach),'[]'::jsonb)
  ) into result;
  return result;
end
$$;

revoke all on function public.management_sales_mix(bigint,date,date) from public, anon, authenticated;
grant execute on function public.management_sales_mix(bigint,date,date) to service_role;
