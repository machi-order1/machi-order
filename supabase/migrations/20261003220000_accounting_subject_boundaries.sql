-- Keep operational companies separate from legal taxpayers.
create extension if not exists btree_gist with schema extensions;

create table if not exists public.accounting_subjects (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('individual','corporation')),
  display_name text not null check (length(trim(display_name)) between 1 and 120),
  legal_name text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  check (verified_at is null or nullif(trim(legal_name),'') is not null)
);

create table if not exists public.accounting_businesses (
  id bigint generated always as identity primary key,
  code text not null unique check (code ~ '^[a-z0-9_]+$'),
  display_name text not null check (length(trim(display_name)) between 1 and 120),
  created_at timestamptz not null default now()
);

create table if not exists public.accounting_store_periods (
  id bigint generated always as identity primary key,
  store_id bigint not null references public.stores(id),
  business_id bigint not null references public.accounting_businesses(id),
  starts_on date not null,
  ends_on date,
  check (ends_on is null or ends_on > starts_on),
  exclude using gist (store_id with =, daterange(starts_on,coalesce(ends_on,'infinity'::date),'[)') with &&)
);

create table if not exists public.accounting_subject_periods (
  id bigint generated always as identity primary key,
  business_id bigint not null references public.accounting_businesses(id),
  subject_id bigint not null references public.accounting_subjects(id),
  starts_on date not null,
  ends_on date,
  check (ends_on is null or ends_on > starts_on),
  exclude using gist (business_id with =, daterange(starts_on,coalesce(ends_on,'infinity'::date),'[)') with &&)
);

create index if not exists accounting_store_periods_business_idx on public.accounting_store_periods(business_id,starts_on);
create index if not exists accounting_subject_periods_subject_idx on public.accounting_subject_periods(subject_id,starts_on);

alter table public.accounting_subjects enable row level security;
alter table public.accounting_businesses enable row level security;
alter table public.accounting_store_periods enable row level security;
alter table public.accounting_subject_periods enable row level security;
revoke all on public.accounting_subjects,public.accounting_businesses,public.accounting_store_periods,public.accounting_subject_periods from anon,authenticated;

insert into public.accounting_businesses(code,display_name) values
  ('hakata_aburasoba_151','博多油そば151'),
  ('yaneura','BAR YANEURA'),
  ('icoi','MissMrs.BAR icoi')
on conflict (code) do nothing;

insert into public.accounting_store_periods(store_id,business_id,starts_on)
select s.id,b.id,date '1900-01-01'
from public.stores s
join public.brands br on br.id=s.brand_id and br.name='博多油そば151'
join public.accounting_businesses b on b.code='hakata_aburasoba_151'
where not exists (select 1 from public.accounting_store_periods p where p.store_id=s.id);
