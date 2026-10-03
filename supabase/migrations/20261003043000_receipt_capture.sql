-- Private original photographs and a review-first receipt workflow.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('expense-receipts','expense-receipts',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;

alter table public.receipt_imports
  add column if not exists image_sha256 text,
  add column if not exists mime_type text,
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmed_by uuid,
  add column if not exists review_note text;
create unique index if not exists receipt_imports_store_image_sha256_idx
  on public.receipt_imports(store_id,image_sha256) where image_sha256 is not null;
create index if not exists receipt_imports_store_created_idx
  on public.receipt_imports(store_id,created_at desc);
create unique index if not exists store_expenses_receipt_import_id_unique_idx
  on public.store_expenses(receipt_import_id) where receipt_import_id is not null;

create or replace function public.confirm_receipt_expense(
  p_store_id bigint,p_receipt_id bigint,p_user_id uuid,p_date date,p_vendor text,
  p_name text,p_category text,p_amount integer,p_tax text,p_allow_possible_duplicate boolean default false
) returns bigint language plpgsql security invoker
set search_path = 'public','pg_temp' as $confirm$
declare v_receipt public.receipt_imports%rowtype; v_expense_id bigint;
begin
  select * into v_receipt from public.receipt_imports
  where id=p_receipt_id and store_id=p_store_id for update;
  if not found then raise exception 'receipt_not_found'; end if;
  if v_receipt.confirmed then
    select id into v_expense_id from public.store_expenses where receipt_import_id=p_receipt_id and store_id=p_store_id;
    if v_expense_id is null then raise exception 'receipt_confirmation_incomplete'; end if;
    return v_expense_id;
  end if;
  if v_receipt.extraction_status not in ('needs_review','pending','failed') then raise exception 'receipt_already_resolved'; end if;
  if v_receipt.image_path is null then raise exception 'receipt_image_missing'; end if;
  if coalesce(v_receipt.extracted_data->>'inventory_warning','false')='true' then
    raise exception 'inventory_purchase_requires_review';
  end if;
  if p_date is null or p_amount is null or p_amount<=0 or p_amount>100000000
    or nullif(trim(p_vendor),'') is null or length(p_vendor)>200
    or nullif(trim(p_name),'') is null or length(p_name)>200
    or p_category is null or p_category not in ('家賃','水道光熱費','消耗品費','広告宣伝費','支払手数料','通信費','修繕費','その他')
    or p_tax is null or p_tax not in ('unknown','taxable_10','taxable_8','non_taxable','exempt','out_of_scope')
    then raise exception 'invalid_receipt_expense'; end if;
  if not p_allow_possible_duplicate and exists (
    select 1 from public.store_expenses e
    where e.store_id=p_store_id and e.expense_date=p_date and e.amount=p_amount
      and lower(trim(e.vendor_name))=lower(trim(p_vendor)) and e.voided_at is null
  ) then raise exception 'possible_duplicate'; end if;
  insert into public.store_expenses(store_id,expense_date,category,name,amount,expense_type,
    vendor_name,tax_category,receipt_import_id,recorded_by)
  values(p_store_id,p_date,p_category,p_name,p_amount,'variable',trim(p_vendor),p_tax,p_receipt_id,p_user_id)
  returning id into v_expense_id;
  update public.receipt_imports set purchased_at=(p_date::timestamp at time zone 'Asia/Tokyo'),
    vendor_name=trim(p_vendor),total_amount=p_amount,confirmed=true,extraction_status='confirmed',
    confirmed_at=now(),confirmed_by=p_user_id
  where id=p_receipt_id;
  insert into public.audit_logs(store_id,user_id,action,entity_type,entity_id,details)
  values(p_store_id,p_user_id,'receipt_expense_confirmed','store_expense',v_expense_id::text,
    jsonb_build_object('receipt_import_id',p_receipt_id,'expense_date',p_date,'amount',p_amount,'category',p_category,'duplicate_override',p_allow_possible_duplicate));
  return v_expense_id;
end $confirm$;
revoke all on function public.confirm_receipt_expense(bigint,bigint,uuid,date,text,text,text,integer,text,boolean) from public,anon,authenticated;
grant execute on function public.confirm_receipt_expense(bigint,bigint,uuid,date,text,text,text,integer,text,boolean) to service_role;

-- The monthly expense close freezes expense edits and keeps an auditable snapshot.
create table if not exists public.expense_month_closings (
  id bigint generated always as identity primary key,
  store_id bigint not null references public.stores(id),
  month date not null,
  expense_total numeric not null,
  expense_count integer not null,
  receipt_count integer not null,
  closed_at timestamptz not null default now(),
  closed_by uuid not null,
  reopened_at timestamptz,
  reopened_by uuid,
  reopen_reason text,
  check (extract(day from month)=1)
);
create unique index if not exists expense_month_closings_active_idx
  on public.expense_month_closings(store_id,month) where reopened_at is null;
alter table public.expense_month_closings enable row level security;
revoke all on public.expense_month_closings from anon,authenticated;

create or replace function public.guard_closed_expense_month() returns trigger
language plpgsql security invoker set search_path='public','pg_temp' as $guard$
declare v_store bigint; v_date date;
begin
  v_store := case when tg_op='DELETE' then old.store_id else new.store_id end;
  v_date := case when tg_op='DELETE' then old.expense_date else new.expense_date end;
  perform pg_advisory_xact_lock(hashtext(v_store::text),extract(year from v_date)::integer*100+extract(month from v_date)::integer);
  if exists (select 1 from public.expense_month_closings
    where reopened_at is null and store_id=case when tg_op='DELETE' then old.store_id else new.store_id end
    and month=date_trunc('month',case when tg_op='DELETE' then old.expense_date else new.expense_date end)::date)
    then raise exception 'expense_month_closed'; end if;
  if tg_op='UPDATE' and old.expense_date is distinct from new.expense_date and exists (
    select 1 from public.expense_month_closings where reopened_at is null and store_id=old.store_id
    and month=date_trunc('month',old.expense_date)::date)
    then raise exception 'expense_month_closed'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $guard$;
drop trigger if exists guard_closed_expense_month on public.store_expenses;
create trigger guard_closed_expense_month before insert or update or delete on public.store_expenses
  for each row execute function public.guard_closed_expense_month();

create or replace function public.close_expense_month(p_store_id bigint,p_month date,p_user_id uuid)
returns bigint language plpgsql security invoker set search_path='public','pg_temp' as $close$
declare v_id bigint; v_total numeric; v_count integer; v_receipts integer; v_end date;
begin
  if p_month is null or extract(day from p_month)<>1 or p_month>=date_trunc('month',now() at time zone 'Asia/Tokyo')::date
    then raise exception 'month_not_finished'; end if;
  perform pg_advisory_xact_lock(hashtext(p_store_id::text),extract(year from p_month)::integer*100+extract(month from p_month)::integer);
  select id into v_id from public.expense_month_closings where store_id=p_store_id and month=p_month and reopened_at is null;
  if v_id is not null then return v_id; end if;
  v_end := (p_month + interval '1 month')::date;
  if exists(select 1 from public.receipt_imports where store_id=p_store_id
    and created_at >= (p_month::timestamp at time zone 'Asia/Tokyo')
    and created_at < (v_end::timestamp at time zone 'Asia/Tokyo')
    and extraction_status in ('needs_review','pending','failed'))
    then raise exception 'pending_receipts'; end if;
  if exists(select 1 from public.store_expenses where store_id=p_store_id
    and expense_date>=p_month and expense_date<v_end and voided_at is null
    and tax_category='unknown') then raise exception 'unknown_tax_category'; end if;
  select coalesce(sum(amount),0),count(*) into v_total,v_count from public.store_expenses
    where store_id=p_store_id and expense_date>=p_month and expense_date<v_end and voided_at is null;
  select count(*) into v_receipts from public.receipt_imports where store_id=p_store_id
    and confirmed=true and purchased_at >= (p_month::timestamp at time zone 'Asia/Tokyo')
    and purchased_at < (v_end::timestamp at time zone 'Asia/Tokyo');
  insert into public.expense_month_closings(store_id,month,expense_total,expense_count,receipt_count,closed_by)
    values(p_store_id,p_month,v_total,v_count,v_receipts,p_user_id) returning id into v_id;
  insert into public.audit_logs(store_id,user_id,action,entity_type,entity_id,details)
    values(p_store_id,p_user_id,'expense_month_closed','expense_month_closing',v_id::text,
      jsonb_build_object('month',p_month,'expense_total',v_total,'expense_count',v_count,'receipt_count',v_receipts));
  return v_id;
end $close$;
revoke all on function public.close_expense_month(bigint,date,uuid) from public,anon,authenticated;
grant execute on function public.close_expense_month(bigint,date,uuid) to service_role;

-- A mistaken close can be reopened with an explicit audit trail, then closed again.
create or replace function public.reopen_expense_month(p_store_id bigint,p_month date,p_user_id uuid,p_reason text)
returns bigint language plpgsql security invoker set search_path='public','pg_temp' as $reopen$
declare v public.expense_month_closings%rowtype;
begin
  if p_month is null or extract(day from p_month)<>1 or length(trim(coalesce(p_reason,'')))<5
    or length(p_reason)>500 then raise exception 'invalid_reopen_reason'; end if;
  perform pg_advisory_xact_lock(hashtext(p_store_id::text),extract(year from p_month)::integer*100+extract(month from p_month)::integer);
  select * into v from public.expense_month_closings where store_id=p_store_id and month=p_month
    and reopened_at is null for update;
  if not found then raise exception 'month_not_closed'; end if;
  update public.expense_month_closings set reopened_at=now(),reopened_by=p_user_id,
    reopen_reason=trim(p_reason) where id=v.id;
  insert into public.audit_logs(store_id,user_id,action,entity_type,entity_id,details)
    values(p_store_id,p_user_id,'expense_month_reopened','expense_month_closing',v.id::text,
      jsonb_build_object('month',p_month,'reason',trim(p_reason),'previous_total',v.expense_total,'previous_count',v.expense_count));
  return v.id;
end $reopen$;
revoke all on function public.reopen_expense_month(bigint,date,uuid,text) from public,anon,authenticated;
grant execute on function public.reopen_expense_month(bigint,date,uuid,text) to service_role;

-- Review resolution and its audit entry commit together.
create or replace function public.resolve_receipt_import(p_store_id bigint,p_receipt_id bigint,p_user_id uuid,p_reason text,p_note text)
returns bigint language plpgsql security invoker set search_path='public','pg_temp' as $resolve$
declare v public.receipt_imports%rowtype;
begin
  select * into v from public.receipt_imports where store_id=p_store_id and id=p_receipt_id for update;
  if not found then raise exception 'receipt_not_found'; end if;
  if v.extraction_status not in ('needs_review','pending','failed') or v.confirmed then raise exception 'receipt_already_resolved'; end if;
  if p_reason not in ('inventory','personal','duplicate','other') or length(trim(coalesce(p_note,'')))<3
    or length(p_note)>500 then raise exception 'invalid_resolution'; end if;
  update public.receipt_imports set extraction_status='resolved_'||p_reason,review_note=trim(p_note),
    confirmed_by=p_user_id,confirmed_at=now() where id=p_receipt_id;
  insert into public.audit_logs(store_id,user_id,action,entity_type,entity_id,details)
    values(p_store_id,p_user_id,'receipt_resolved','receipt_import',p_receipt_id::text,
      jsonb_build_object('reason',p_reason,'note',trim(p_note)));
  return p_receipt_id;
end $resolve$;
revoke all on function public.resolve_receipt_import(bigint,bigint,uuid,text,text) from public,anon,authenticated;
grant execute on function public.resolve_receipt_import(bigint,bigint,uuid,text,text) to service_role;

-- Aggregate without the API's default 1000-row response limit.
create or replace function public.expense_month_overview(p_store_id bigint,p_month date)
returns table(pending bigint,confirmed bigint,unknown_tax bigint,expense_total numeric)
language sql stable security invoker set search_path='public','pg_temp' as $overview$
select
  (select count(*) from public.receipt_imports r where r.store_id=p_store_id
    and r.created_at>=(p_month::timestamp at time zone 'Asia/Tokyo')
    and r.created_at<((p_month+interval '1 month')::timestamp at time zone 'Asia/Tokyo')
    and r.extraction_status in ('needs_review','pending','failed')),
  (select count(*) from public.receipt_imports r where r.store_id=p_store_id
    and r.confirmed=true and r.purchased_at>=(p_month::timestamp at time zone 'Asia/Tokyo')
    and r.purchased_at<((p_month+interval '1 month')::timestamp at time zone 'Asia/Tokyo')),
  (select count(*) from public.store_expenses e where e.store_id=p_store_id
    and e.expense_date>=p_month and e.expense_date<(p_month+interval '1 month')::date
    and e.voided_at is null and e.tax_category='unknown'),
  (select coalesce(sum(e.amount),0) from public.store_expenses e where e.store_id=p_store_id
    and e.expense_date>=p_month and e.expense_date<(p_month+interval '1 month')::date
    and e.voided_at is null);
$overview$;
revoke all on function public.expense_month_overview(bigint,date) from public,anon,authenticated;
grant execute on function public.expense_month_overview(bigint,date) to service_role;
