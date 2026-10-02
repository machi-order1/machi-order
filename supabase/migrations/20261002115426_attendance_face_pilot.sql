-- Templates are accessible only through the authenticated kiosk Edge Function.
create table public.staff_face_templates (
  staff_id bigint primary key references public.staff_roster(id) on delete cascade,
  model text not null check (model = 'face-api-0.22.2-recognition-v1'),
  descriptors jsonb not null check (jsonb_typeof(descriptors) = 'array' and jsonb_array_length(descriptors) = 3),
  consent_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create table public.attendance_face_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  device_id uuid not null references public.attendance_kiosk_devices(id) on delete cascade,
  store_id bigint not null references public.stores(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  outcome text not null default 'started' check (outcome in ('started','matched','fallback')),
  reason text,
  matched_staff_id bigint references public.staff_roster(id) on delete set null,
  verified_staff_id bigint references public.staff_roster(id) on delete set null,
  verified_at timestamptz
);
create index attendance_face_attempts_device_time on public.attendance_face_attempts(device_id,started_at);
alter table public.staff_face_templates enable row level security;
alter table public.attendance_face_attempts enable row level security;
revoke all on public.staff_face_templates,public.attendance_face_attempts from anon,authenticated;
grant all on public.staff_face_templates,public.attendance_face_attempts to service_role;
