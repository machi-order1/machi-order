-- Private, subject-scoped double-entry journal. No live sales or expenses are
-- imported until the taxpayer and opening balances are verified.
create table public.accounting_accounts (
  id bigint generated always as identity primary key,
  subject_id bigint not null references public.accounting_subjects(id),
  code text not null check (code ~ '^[a-z0-9_]+$'),
  name text not null check (length(trim(name)) between 1 and 120),
  account_type text not null check (account_type in ('asset','liability','equity','revenue','expense')),
  active boolean not null default true,
  unique(subject_id,code),
  unique(id,subject_id)
);

create table public.accounting_entries (
  id bigint generated always as identity primary key,
  subject_id bigint not null references public.accounting_subjects(id),
  business_id bigint not null references public.accounting_businesses(id),
  store_id bigint references public.stores(id),
  entry_date date not null,
  description text not null check (length(trim(description)) between 1 and 500),
  source_type text not null check (source_type ~ '^[a-z_]+$'),
  source_id text,
  status text not null default 'draft' check (status in ('draft','posted')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  posted_at timestamptz,
  unique(id,subject_id),
  check ((status='draft' and posted_at is null) or (status='posted' and posted_at is not null))
);
create unique index accounting_entries_source_once on public.accounting_entries(subject_id,source_type,source_id) where source_id is not null;
create index accounting_entries_period on public.accounting_entries(subject_id,entry_date) where status='posted';

create table public.accounting_lines (
  id bigint generated always as identity primary key,
  entry_id bigint not null,
  subject_id bigint not null,
  account_id bigint not null,
  debit_yen bigint not null default 0 check (debit_yen>=0),
  credit_yen bigint not null default 0 check (credit_yen>=0),
  description text,
  receipt_import_id bigint references public.receipt_imports(id),
  foreign key(entry_id,subject_id) references public.accounting_entries(id,subject_id),
  foreign key(account_id,subject_id) references public.accounting_accounts(id,subject_id),
  check ((debit_yen>0 and credit_yen=0) or (credit_yen>0 and debit_yen=0))
);
create index accounting_lines_entry_idx on public.accounting_lines(entry_id);
create index accounting_lines_account_idx on public.accounting_lines(account_id);

create function public.guard_accounting_entry() returns trigger language plpgsql
set search_path to 'public','pg_temp' as $body$
declare v_debit numeric; v_credit numeric; v_count bigint;
begin
  if tg_op='DELETE' then raise exception 'posted_or_draft_entry_cannot_be_deleted'; end if;
  if tg_op='INSERT' then
    if new.status <> 'draft' or new.posted_at is not null then raise exception 'entry_must_start_as_draft'; end if;
    return new;
  end if;
  if old.status='posted' then raise exception 'posted_entry_is_immutable'; end if;
  if new.status='draft' then
    if new.posted_at is not null then raise exception 'draft_cannot_have_posted_at'; end if;
    return new;
  end if;
  if new.subject_id is distinct from old.subject_id or new.business_id is distinct from old.business_id
    or new.store_id is distinct from old.store_id or new.entry_date is distinct from old.entry_date then
    raise exception 'posting_cannot_change_entry_identity';
  end if;
  if not exists (select 1 from public.accounting_subjects s where s.id=new.subject_id and s.verified_at is not null) then
    raise exception 'taxpayer_not_verified';
  end if;
  if not exists (select 1 from public.accounting_subject_periods p where p.subject_id=new.subject_id
    and p.business_id=new.business_id and new.entry_date>=p.starts_on and (p.ends_on is null or new.entry_date<p.ends_on)) then
    raise exception 'business_not_assigned_to_taxpayer_on_date';
  end if;
  if new.store_id is not null and not exists (select 1 from public.accounting_store_periods p
    where p.store_id=new.store_id and p.business_id=new.business_id
    and new.entry_date>=p.starts_on and (p.ends_on is null or new.entry_date<p.ends_on)) then
    raise exception 'store_not_assigned_to_business_on_date';
  end if;
  select count(*),coalesce(sum(debit_yen),0),coalesce(sum(credit_yen),0)
    into v_count,v_debit,v_credit from public.accounting_lines where entry_id=new.id;
  if v_count<2 or v_debit<>v_credit or v_debit<=0 then raise exception 'journal_not_balanced'; end if;
  new.posted_at:=now();
  return new;
end $body$;

create trigger accounting_entry_guard before insert or update or delete on public.accounting_entries
for each row execute function public.guard_accounting_entry();

create function public.guard_accounting_line() returns trigger language plpgsql
set search_path to 'public','pg_temp' as $body$
declare v_entry_id bigint; v_status text;
begin
  v_entry_id:=case when tg_op='DELETE' then old.entry_id else new.entry_id end;
  if tg_op='UPDATE' then
    if new.entry_id<>old.entry_id then raise exception 'journal_line_cannot_move'; end if;
  end if;
  select status into v_status from public.accounting_entries where id=v_entry_id for update;
  if v_status is distinct from 'draft' then raise exception 'posted_entry_lines_are_immutable'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $body$;

create trigger accounting_line_guard before insert or update or delete on public.accounting_lines
for each row execute function public.guard_accounting_line();

create function public.accounting_trial_balance(p_subject_id bigint,p_from date,p_to_exclusive date)
returns table(account_code text,account_name text,account_type text,debit_yen numeric,credit_yen numeric,balance_yen numeric)
language sql stable security invoker set search_path to 'public','pg_temp' as $body$
  select a.code,a.name,a.account_type,
    coalesce(sum(l.debit_yen),0),coalesce(sum(l.credit_yen),0),
    coalesce(sum(l.debit_yen-l.credit_yen),0)
  from public.accounting_accounts a
  left join public.accounting_lines l on l.account_id=a.id
    and exists (select 1 from public.accounting_entries e where e.id=l.entry_id
      and e.subject_id=p_subject_id and e.status='posted'
      and e.entry_date>=p_from and e.entry_date<p_to_exclusive)
  where a.subject_id=p_subject_id and p_to_exclusive>p_from
  group by a.id,a.code,a.name,a.account_type
  order by a.code
$body$;

alter table public.accounting_accounts enable row level security;
alter table public.accounting_entries enable row level security;
alter table public.accounting_lines enable row level security;
revoke all on public.accounting_accounts,public.accounting_entries,public.accounting_lines from anon,authenticated;
revoke all on function public.accounting_trial_balance(bigint,date,date) from public,anon,authenticated;
