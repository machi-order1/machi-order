create extension if not exists pgcrypto with schema extensions;

create table if not exists public.staff_kiosk_credentials (
  staff_id bigint primary key references public.staff_roster(id) on delete cascade,
  pin_hash text not null,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  last_success_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.attendance_kiosk_devices (
  id uuid primary key default extensions.gen_random_uuid(),
  store_id bigint not null references public.stores(id) on delete cascade,
  device_name text not null check (length(trim(device_name)) between 1 and 80),
  token_hash text not null unique,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);

create index if not exists attendance_kiosk_devices_store_active_idx
  on public.attendance_kiosk_devices(store_id,active);

alter table public.staff_kiosk_credentials enable row level security;
alter table public.attendance_kiosk_devices enable row level security;
revoke all on public.staff_kiosk_credentials from anon,authenticated;
revoke all on public.attendance_kiosk_devices from anon,authenticated;
grant all on public.staff_kiosk_credentials to service_role;
grant all on public.attendance_kiosk_devices to service_role;

alter table public.work_breaks add column if not exists roster_staff_id bigint references public.staff_roster(id) on delete restrict;
alter table public.work_breaks alter column user_id drop not null;
alter table public.work_breaks drop constraint if exists work_breaks_has_staff_identity;
alter table public.work_breaks add constraint work_breaks_has_staff_identity
  check (user_id is not null or roster_staff_id is not null) not valid;
alter table public.work_breaks validate constraint work_breaks_has_staff_identity;
create index if not exists work_breaks_roster_idx on public.work_breaks(roster_staff_id,started_at);

create or replace function public.set_staff_kiosk_pin(p_staff_id bigint,p_pin text,p_updated_by uuid)
returns void
language plpgsql
security definer
set search_path=public,extensions
as $$
begin
  if p_pin !~ '^[0-9]{4,8}$' then
    raise exception 'PIN must contain 4 to 8 digits';
  end if;
  insert into public.staff_kiosk_credentials(staff_id,pin_hash,updated_by,updated_at,failed_attempts,locked_until)
  values(p_staff_id,crypt(p_pin,gen_salt('bf',10)),p_updated_by,now(),0,null)
  on conflict(staff_id) do update set
    pin_hash=excluded.pin_hash,
    updated_by=excluded.updated_by,
    updated_at=now(),
    failed_attempts=0,
    locked_until=null;
end;
$$;

create or replace function public.verify_staff_kiosk_pin(p_store_id bigint,p_staff_id bigint,p_pin text)
returns boolean
language plpgsql
security definer
set search_path=public,extensions
as $$
declare c public.staff_kiosk_credentials%rowtype;
begin
  if p_pin !~ '^[0-9]{4,8}$' then return false; end if;
  if not exists (
    select 1 from public.staff_roster r
    join public.staff_store_assignments a on a.staff_id=r.id
    where r.id=p_staff_id and r.active and a.store_id=p_store_id and a.active
  ) then return false; end if;
  select * into c from public.staff_kiosk_credentials where staff_id=p_staff_id for update;
  if not found or (c.locked_until is not null and c.locked_until>now()) then return false; end if;
  if crypt(p_pin,c.pin_hash)=c.pin_hash then
    update public.staff_kiosk_credentials set failed_attempts=0,locked_until=null,last_success_at=now() where staff_id=p_staff_id;
    return true;
  end if;
  update public.staff_kiosk_credentials set
    failed_attempts=failed_attempts+1,
    locked_until=case when failed_attempts+1>=5 then now()+interval '10 minutes' else null end
  where staff_id=p_staff_id;
  return false;
end;
$$;

revoke all on function public.set_staff_kiosk_pin(bigint,text,uuid) from public,anon,authenticated;
revoke all on function public.verify_staff_kiosk_pin(bigint,bigint,text) from public,anon,authenticated;
grant execute on function public.set_staff_kiosk_pin(bigint,text,uuid) to service_role;
grant execute on function public.verify_staff_kiosk_pin(bigint,bigint,text) to service_role;
