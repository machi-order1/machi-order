-- Store-specific campaign plans and immutable outcome revisions; no inferred lift.
create table public.management_campaigns (
  id bigint generated always as identity primary key,
  store_id bigint not null references public.stores(id),
  entry_key uuid not null,
  title text not null check(length(trim(title)) between 2 and 120),
  campaign_type text not null check(campaign_type in ('ad','coupon','event','other')),
  start_on date not null,
  end_on date not null check(end_on>=start_on and end_on<=start_on+90),
  weekday_target smallint not null default 0 check(weekday_target between 0 and 7),
  slot_target text not null default 'all' check(slot_target in ('all','lunch','dinner')),
  planned_budget_yen integer not null check(planned_budget_yen between 0 and 100000000),
  hypothesis text not null check(length(trim(hypothesis)) between 5 and 500),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(store_id,entry_key)
);
create index management_campaigns_store_date on public.management_campaigns(store_id,start_on,id);
alter table public.management_campaigns enable row level security;
revoke all on public.management_campaigns from anon,authenticated;

create table public.management_campaign_results (
  id bigint generated always as identity primary key,
  campaign_id bigint not null references public.management_campaigns(id),
  store_id bigint not null references public.stores(id),
  entry_key uuid not null,
  actual_spend_yen integer not null check(actual_spend_yen between 0 and 100000000),
  outcome_note text not null check(length(trim(outcome_note)) between 5 and 1000),
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  unique(store_id,entry_key)
);
create index management_campaign_results_campaign on public.management_campaign_results(campaign_id,id desc);
alter table public.management_campaign_results enable row level security;
revoke all on public.management_campaign_results from anon,authenticated;

create function public.guard_management_campaign_immutable() returns trigger language plpgsql
set search_path to 'public','pg_temp' as $body$
begin
  raise exception 'campaign_history_is_immutable';
end $body$;
create trigger management_campaign_immutable before update or delete on public.management_campaigns
for each row execute function public.guard_management_campaign_immutable();
create trigger management_campaign_result_immutable before update or delete on public.management_campaign_results
for each row execute function public.guard_management_campaign_immutable();
