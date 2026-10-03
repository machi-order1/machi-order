-- Platform daily figures are a separate reconciliation source. They are not
-- added to POS sales or the management P&L until the two sources are matched.
create table if not exists public.external_channel_daily_reports (
  id bigint generated always as identity primary key,
  store_id bigint not null references public.stores(id),
  channel_code text not null check (channel_code in ('uber_eats','rocket_now')),
  business_date date not null,
  gross_sales bigint not null check (gross_sales>=0 and gross_sales<=1000000000),
  order_count integer not null check (order_count>=0 and order_count<=100000),
  platform_fee bigint not null default 0 check (platform_fee>=0 and platform_fee<=1000000000),
  payout_amount bigint not null default 0 check (payout_amount>=0 and payout_amount<=1000000000),
  source_ref text,
  note text,
  version integer not null default 1,
  entry_key uuid not null unique,
  recorded_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id,channel_code,business_date)
);
create index if not exists external_channel_daily_reports_store_date_idx on public.external_channel_daily_reports(store_id,business_date);
alter table public.external_channel_daily_reports enable row level security;
revoke all on public.external_channel_daily_reports from public,anon,authenticated;
grant select,insert,update on public.external_channel_daily_reports to service_role;

create or replace function public.save_external_channel_day(
  p_store_id bigint,p_user_id uuid,p_channel text,p_date date,p_gross bigint,p_orders integer,
  p_fee bigint,p_payout bigint,p_source_ref text,p_note text,p_key uuid,p_expected_version integer
) returns jsonb language plpgsql security invoker set search_path = 'public','pg_temp' as $save$
declare v_row public.external_channel_daily_reports%rowtype; v_action text;
begin
  if p_channel not in ('uber_eats','rocket_now') or p_date is null or p_gross<0 or p_gross>1000000000
    or p_orders<0 or p_orders>100000 or p_fee<0 or p_fee>1000000000 or p_payout<0 or p_payout>1000000000
    or p_key is null or p_expected_version<0 or length(coalesce(p_source_ref,''))>120 or length(coalesce(p_note,''))>500
    then raise exception 'invalid_external_channel_report'; end if;
  insert into public.external_channel_daily_reports(store_id,channel_code,business_date,gross_sales,order_count,platform_fee,payout_amount,source_ref,note,entry_key,recorded_by)
  values(p_store_id,p_channel,p_date,p_gross,p_orders,p_fee,p_payout,nullif(trim(p_source_ref),''),nullif(trim(p_note),''),p_key,p_user_id)
  on conflict (store_id,channel_code,business_date) do nothing returning * into v_row;
  if v_row.id is not null then
    v_action := 'external_channel_day_recorded';
  else
    select * into v_row from public.external_channel_daily_reports
      where store_id=p_store_id and channel_code=p_channel and business_date=p_date for update;
    if not found then raise exception 'external_report_conflict'; end if;
    if v_row.entry_key=p_key then return jsonb_build_object('id',v_row.id,'version',v_row.version,'saved',true); end if;
    if v_row.version<>p_expected_version then raise exception 'external_report_version_conflict'; end if;
    update public.external_channel_daily_reports set gross_sales=p_gross,order_count=p_orders,platform_fee=p_fee,
      payout_amount=p_payout,source_ref=nullif(trim(p_source_ref),''),note=nullif(trim(p_note),''),
      entry_key=p_key,recorded_by=p_user_id,version=version+1,updated_at=now()
      where id=v_row.id returning * into v_row;
    v_action := 'external_channel_day_revised';
  end if;
  insert into public.audit_logs(store_id,user_id,action,entity_type,entity_id,details)
  values(p_store_id,p_user_id,v_action,'external_channel_daily_report',v_row.id::text,
    jsonb_build_object('channel',p_channel,'date',p_date,'gross',p_gross,'orders',p_orders,'fee',p_fee,'payout',p_payout,'version',v_row.version));
  return jsonb_build_object('id',v_row.id,'version',v_row.version,'saved',true);
end $save$;
revoke all on function public.save_external_channel_day(bigint,uuid,text,date,bigint,integer,bigint,bigint,text,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.save_external_channel_day(bigint,uuid,text,date,bigint,integer,bigint,bigint,text,text,uuid,integer) to service_role;

create or replace function public.external_channel_month(p_store_id bigint,p_month date)
returns jsonb language sql stable security invoker set search_path = 'public','pg_temp' as $month$
with calendar as (
  select d::date business_date from generate_series(date_trunc('month',p_month)::date,
    (date_trunc('month',p_month)+interval '1 month'-interval '1 day')::date,interval '1 day') d
), channels as (select unnest(array['uber_eats','rocket_now']) channel_code),
pos as (
  select business_date,order_channel_code channel_code,count(*)::integer orders,sum(total)::bigint sales
  from public.orders where store_id=p_store_id and business_date>=date_trunc('month',p_month)::date
    and business_date<(date_trunc('month',p_month)+interval '1 month')::date
    and payment_status='paid' and status<>'cancelled' and order_channel_code in ('uber_eats','rocket_now')
  group by 1,2
)
select coalesce(jsonb_agg(jsonb_build_object('date',c.business_date,'channel',ch.channel_code,
  'report_id',r.id,'version',r.version,'gross_sales',r.gross_sales,'order_count',r.order_count,
  'platform_fee',r.platform_fee,'payout_amount',r.payout_amount,'source_ref',r.source_ref,'note',r.note,
  'pos_sales',coalesce(p.sales,0),'pos_orders',coalesce(p.orders,0)) order by c.business_date,ch.channel_code),'[]'::jsonb)
from calendar c cross join channels ch
left join public.external_channel_daily_reports r on r.store_id=p_store_id and r.business_date=c.business_date and r.channel_code=ch.channel_code
left join pos p on p.business_date=c.business_date and p.channel_code=ch.channel_code;
$month$;
revoke all on function public.external_channel_month(bigint,date) from public,anon,authenticated;
grant execute on function public.external_channel_month(bigint,date) to service_role;
