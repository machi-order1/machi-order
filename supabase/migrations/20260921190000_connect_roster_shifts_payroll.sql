alter table public.work_shifts add column if not exists roster_staff_id bigint references public.staff_roster(id) on delete restrict;
alter table public.work_shifts alter column user_id drop not null;

update public.work_shifts w
set roster_staff_id = r.id
from public.staff_roster r
where w.roster_staff_id is null and r.auth_user_id = w.user_id;

alter table public.work_shifts drop constraint if exists work_shifts_has_staff_identity;
alter table public.work_shifts add constraint work_shifts_has_staff_identity
  check (user_id is not null or roster_staff_id is not null) not valid;
alter table public.work_shifts validate constraint work_shifts_has_staff_identity;

create index if not exists work_shifts_roster_date_idx
  on public.work_shifts(roster_staff_id,shift_date) where roster_staff_id is not null;
create unique index if not exists work_shifts_roster_no_exact_duplicate
  on public.work_shifts(store_id,roster_staff_id,shift_date,scheduled_start,scheduled_end)
  where roster_staff_id is not null and status in ('scheduled','working');
create unique index if not exists work_shifts_roster_one_open
  on public.work_shifts(store_id,roster_staff_id)
  where roster_staff_id is not null and status='working' and clock_out is null;
