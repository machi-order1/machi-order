-- Explicit source-to-journal links prevent the same POS closing or expense
-- from being posted twice. No automatic posting is enabled by this migration.
create table public.accounting_source_links (
  id bigint generated always as identity primary key,
  subject_id bigint not null,
  entry_id bigint not null unique,
  source_kind text not null check (source_kind in ('daily_closing','store_expense')),
  source_id bigint not null,
  store_id bigint not null references public.stores(id),
  source_date date not null,
  source_amount_yen bigint not null check (source_amount_yen>=0),
  created_at timestamptz not null default now(),
  foreign key(entry_id,subject_id) references public.accounting_entries(id,subject_id),
  unique(source_kind,source_id)
);
create index accounting_source_links_store_date on public.accounting_source_links(store_id,source_date);

create function public.guard_accounting_source_link() returns trigger language plpgsql
set search_path to 'public','pg_temp' as $body$
declare src_store bigint; src_date date; src_amount bigint; e public.accounting_entries%rowtype;
begin
  if tg_op='UPDATE' or tg_op='DELETE' then raise exception 'source_link_is_immutable'; end if;
  select * into e from public.accounting_entries where id=new.entry_id for update;
  if not found or e.status<>'draft' or e.subject_id<>new.subject_id or e.store_id is distinct from new.store_id
    or e.entry_date<>new.source_date then raise exception 'source_entry_mismatch'; end if;
  if new.source_kind='daily_closing' then
    select store_id,business_date,net_sales into src_store,src_date,src_amount
    from public.daily_closings where id=new.source_id;
  else
    select store_id,expense_date,amount into src_store,src_date,src_amount
    from public.store_expenses where id=new.source_id and voided_at is null;
  end if;
  if not found or src_store<>new.store_id or src_date<>new.source_date
    or src_amount<>new.source_amount_yen then raise exception 'source_snapshot_mismatch'; end if;
  return new;
end $body$;

create trigger accounting_source_link_guard before insert or update or delete on public.accounting_source_links
for each row execute function public.guard_accounting_source_link();

alter table public.accounting_source_links enable row level security;
revoke all on public.accounting_source_links from anon,authenticated;
