-- Payables from photographed supplier invoices; separate from cash receipts and expense entries.
create table if not exists public.supplier_invoices (
  id bigint generated always as identity primary key,
  store_id bigint not null references public.stores(id),
  image_path text not null,
  image_sha256 text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  ocr_text text,
  vendor_name text,
  invoice_number text,
  invoice_date date,
  due_date date,
  amount integer,
  tax_category text not null default 'unknown',
  status text not null default 'draft' check (status in ('draft','open','paid','void')),
  paid_amount integer not null default 0 check (paid_amount >= 0),
  confirmed_by uuid,
  confirmed_at timestamptz,
  note text,
  unique(store_id,image_sha256),
  check (amount is null or amount > 0),
  check (amount is null or paid_amount <= amount)
);
create index if not exists supplier_invoices_store_due_idx on public.supplier_invoices(store_id,due_date) where status='open';
create index if not exists supplier_invoices_store_date_idx on public.supplier_invoices(store_id,invoice_date);
alter table public.supplier_invoices enable row level security;
revoke all on public.supplier_invoices from anon,authenticated;
create table if not exists public.supplier_invoice_payments (
  id bigint generated always as identity primary key,
  invoice_id bigint not null references public.supplier_invoices(id),
  store_id bigint not null references public.stores(id),
  amount integer not null check (amount > 0),
  paid_on date not null,
  method text not null,
  reference text,
  recorded_by uuid not null,
  recorded_at timestamptz not null default now(),
  entry_key uuid not null,
  unique(store_id,entry_key)
);
alter table public.supplier_invoice_payments enable row level security;
revoke all on public.supplier_invoice_payments from anon,authenticated;

create or replace function public.confirm_supplier_invoice(
  p_store_id bigint,p_id bigint,p_user uuid,p_vendor text,p_number text,p_invoice_date date,
  p_due date,p_amount integer,p_tax text,p_note text,p_allow_duplicate boolean default false
) returns bigint language plpgsql security invoker set search_path='public','pg_temp' as $invoice$
declare v public.supplier_invoices%rowtype;
begin
  select * into v from public.supplier_invoices where store_id=p_store_id and id=p_id for update;
  if not found then raise exception 'invoice_not_found'; end if;
  if v.status <> 'draft' then raise exception 'invoice_already_confirmed'; end if;
  if p_invoice_date is null or p_due is null or p_due<p_invoice_date or p_amount is null
    or p_amount<=0 or p_amount>100000000 or nullif(trim(p_vendor),'') is null or length(p_vendor)>200
    or length(coalesce(p_number,''))>100 or length(coalesce(p_note,''))>500
    or p_tax is null or p_tax not in ('unknown','taxable_10','taxable_8','non_taxable','exempt','out_of_scope')
    then raise exception 'invalid_invoice'; end if;
  if not p_allow_duplicate and exists(select 1 from public.supplier_invoices
    where store_id=p_store_id and id<>p_id and status in ('open','paid')
    and invoice_date=p_invoice_date and amount=p_amount and lower(trim(vendor_name))=lower(trim(p_vendor)))
    then raise exception 'possible_duplicate'; end if;
  update public.supplier_invoices set vendor_name=trim(p_vendor),invoice_number=nullif(trim(p_number),''),
    invoice_date=p_invoice_date,due_date=p_due,amount=p_amount,tax_category=p_tax,
    note=nullif(trim(p_note),''),status='open',confirmed_by=p_user,confirmed_at=now()
    where id=p_id;
  insert into public.audit_logs(store_id,user_id,action,entity_type,entity_id,details)
    values(p_store_id,p_user,'supplier_invoice_confirmed','supplier_invoice',p_id::text,
      jsonb_build_object('vendor',p_vendor,'invoice_date',p_invoice_date,'due_date',p_due,'amount',p_amount,'duplicate_override',p_allow_duplicate));
  return p_id;
end $invoice$;
revoke all on function public.confirm_supplier_invoice(bigint,bigint,uuid,text,text,date,date,integer,text,text,boolean) from public,anon,authenticated;
grant execute on function public.confirm_supplier_invoice(bigint,bigint,uuid,text,text,date,date,integer,text,text,boolean) to service_role;

create or replace function public.record_supplier_payment(
  p_store_id bigint,p_id bigint,p_user uuid,p_amount integer,p_paid_on date,p_method text,
  p_reference text,p_key uuid
) returns bigint language plpgsql security invoker set search_path='public','pg_temp' as $payment$
declare v public.supplier_invoices%rowtype; v_id bigint;
begin
  select * into v from public.supplier_invoices where store_id=p_store_id and id=p_id for update;
  if not found then raise exception 'invoice_not_found'; end if;
  select id into v_id from public.supplier_invoice_payments where store_id=p_store_id and entry_key=p_key;
  if v_id is not null then
    if not exists(select 1 from public.supplier_invoice_payments where id=v_id and invoice_id=p_id) then raise exception 'payment_key_reused'; end if;
    return v_id;
  end if;
  if v.status <> 'open' or p_amount is null or p_amount<=0 or p_amount>v.amount-v.paid_amount
    or p_paid_on is null or nullif(trim(p_method),'') is null or length(p_method)>80
    or length(coalesce(p_reference,''))>200 then raise exception 'invalid_payment'; end if;
  insert into public.supplier_invoice_payments(invoice_id,store_id,amount,paid_on,method,reference,recorded_by,entry_key)
    values(p_id,p_store_id,p_amount,p_paid_on,trim(p_method),nullif(trim(p_reference),''),p_user,p_key)
    returning id into v_id;
  update public.supplier_invoices set paid_amount=paid_amount+p_amount,
    status=case when paid_amount+p_amount=amount then 'paid' else 'open' end where id=p_id;
  insert into public.audit_logs(store_id,user_id,action,entity_type,entity_id,details)
    values(p_store_id,p_user,'supplier_invoice_payment_recorded','supplier_invoice_payment',v_id::text,
      jsonb_build_object('invoice_id',p_id,'amount',p_amount,'paid_on',p_paid_on,'method',p_method));
  return v_id;
end $payment$;
revoke all on function public.record_supplier_payment(bigint,bigint,uuid,integer,date,text,text,uuid) from public,anon,authenticated;
grant execute on function public.record_supplier_payment(bigint,bigint,uuid,integer,date,text,text,uuid) to service_role;
