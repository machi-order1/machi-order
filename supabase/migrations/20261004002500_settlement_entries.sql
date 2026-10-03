-- Bank/payment statement amounts are evidence for reconciliation, not sales.
create table public.settlement_entries (
  id bigint generated always as identity primary key,
  store_id bigint not null references public.stores(id),
  posted_on date not null,
  channel_code text not null check (channel_code in ('paypay','card','cash_deposit','other')),
  amount_yen bigint not null check (amount_yen between 1 and 1000000000),
  source_ref text not null default '' check (length(source_ref)<=120),
  note text not null default '' check (length(note)<=500),
  entry_key uuid not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users(id),
  void_reason text,
  unique(store_id,entry_key),
  check ((voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and void_reason is not null and length(trim(void_reason)) between 5 and 500))
);
create index settlement_entries_store_month on public.settlement_entries(store_id,posted_on,channel_code);
create index settlement_entries_duplicate_candidates on public.settlement_entries(store_id,posted_on,channel_code,amount_yen) where voided_at is null;

create function public.guard_settlement_entry() returns trigger language plpgsql
set search_path to 'public','pg_temp' as $body$
begin
  if tg_op='DELETE' then raise exception 'settlement_cannot_be_deleted'; end if;
  if tg_op='INSERT' then
    if new.voided_at is not null then raise exception 'settlement_must_start_active'; end if;
    return new;
  end if;
  if old.voided_at is not null or new.voided_at is null
    or (to_jsonb(new) - 'voided_at' - 'voided_by' - 'void_reason')
      is distinct from (to_jsonb(old) - 'voided_at' - 'voided_by' - 'void_reason') then
    raise exception 'settlement_is_append_only';
  end if;
  return new;
end $body$;
create trigger settlement_entry_guard before insert or update or delete on public.settlement_entries
for each row execute function public.guard_settlement_entry();

alter table public.settlement_entries enable row level security;
revoke all on public.settlement_entries from anon,authenticated;
