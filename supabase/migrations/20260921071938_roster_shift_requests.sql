create table public.roster_shift_requests (
 id bigint generated always as identity primary key,
 staff_id bigint not null references public.staff_roster(id),
 store_id bigint not null references public.stores(id),
 work_date date not null,
 preference text not null check(preference in ('available','unavailable')),
 start_time time,
 end_time time,
 note text not null default '' check(length(note)<=300),
 status text not null default 'pending' check(status in ('pending','approved','declined')),
 revision integer not null default 1,
 shift_id bigint references public.work_shifts(id),
 reviewed_by uuid references auth.users(id),
 reviewed_at timestamptz,
 updated_at timestamptz not null default now(),
 unique(staff_id,store_id,work_date),
 check((preference='unavailable' and start_time is null and end_time is null)
   or (preference='available' and start_time is not null and end_time is not null and start_time<end_time))
);
create index roster_shift_requests_store_date on public.roster_shift_requests(store_id,work_date,status);
alter table public.roster_shift_requests enable row level security;
revoke all on public.roster_shift_requests from public,anon,authenticated;
grant all on public.roster_shift_requests to service_role;
grant usage,select on sequence public.roster_shift_requests_id_seq to service_role;

create function public.save_roster_shift_request(p_staff_id bigint,p_store_id bigint,p_date date,p_preference text,p_start time,p_end time,p_note text)
returns bigint language plpgsql security invoker set search_path='' as $$
declare v_id bigint;
begin
 if p_date<(now() at time zone 'Asia/Tokyo')::date or p_date>(now() at time zone 'Asia/Tokyo')::date+90 then raise exception '希望日は本日から90日以内にしてください'; end if;
 if not exists(select 1 from public.staff_roster r join public.staff_store_assignments a on a.staff_id=r.id where r.id=p_staff_id and r.active and a.active and a.store_id=p_store_id) then raise exception '在籍店舗ではありません'; end if;
 insert into public.roster_shift_requests(staff_id,store_id,work_date,preference,start_time,end_time,note)
 values(p_staff_id,p_store_id,p_date,p_preference,p_start,p_end,coalesce(p_note,''))
 on conflict(staff_id,store_id,work_date) do update set preference=excluded.preference,start_time=excluded.start_time,end_time=excluded.end_time,note=excluded.note,status='pending',reviewed_by=null,reviewed_at=null,revision=roster_shift_requests.revision+1,updated_at=now()
 where roster_shift_requests.status<>'approved'
 returning id into v_id;
 if v_id is null then raise exception '確定済みの希望は店長に変更を依頼してください'; end if;
 return v_id;
end;
$$;

create function public.review_roster_shift_request(p_request_id bigint,p_revision integer,p_approve boolean,p_actor uuid)
returns bigint language plpgsql security invoker set search_path='' as $$
declare q public.roster_shift_requests%rowtype; r public.staff_roster%rowtype; v_shift bigint;
begin
 select * into q from public.roster_shift_requests where id=p_request_id for update;
 if not found then raise exception '希望が見つかりません'; end if;
 if not exists(select 1 from public.store_memberships where user_id=p_actor and store_id=q.store_id and active and role in ('manager','owner','admin')) then raise exception 'この店舗の店長権限が必要です'; end if;
 if q.status<>'pending' or q.revision<>p_revision then raise exception '希望が更新されています。再読み込みしてください'; end if;
 select * into r from public.staff_roster where id=q.staff_id and active for update;
 if not found or not exists(select 1 from public.staff_store_assignments where staff_id=q.staff_id and store_id=q.store_id and active) then raise exception '在籍スタッフではありません'; end if;
 if q.work_date<(now() at time zone 'Asia/Tokyo')::date then raise exception '過去の希望は確定できません'; end if;
 if p_approve and q.preference='available' then
  if exists(select 1 from public.work_shifts w where (w.roster_staff_id=r.id or (r.auth_user_id is not null and w.user_id=r.auth_user_id)) and w.shift_date=q.work_date and w.status in ('scheduled','working','completed') and coalesce(w.scheduled_start,'00:00'::time)<q.end_time and coalesce(w.scheduled_end,'24:00'::time)>q.start_time) then raise exception '他店舗を含め同じ時間に勤務があります'; end if;
  insert into public.work_shifts(store_id,roster_staff_id,user_id,shift_date,scheduled_start,scheduled_end,status,hourly_wage_snapshot,published_at,note)
  values(q.store_id,r.id,r.auth_user_id,q.work_date,q.start_time,q.end_time,'scheduled',r.hourly_wage,now(),'希望から確定') returning id into v_shift;
 end if;
 if p_approve and q.preference='unavailable' and exists(select 1 from public.work_shifts where store_id=q.store_id and (roster_staff_id=r.id or (r.auth_user_id is not null and user_id=r.auth_user_id)) and shift_date=q.work_date and status in ('scheduled','working')) then raise exception '登録済みシフトがあります。先に店長画面で調整してください'; end if;
 update public.roster_shift_requests set status=case when p_approve then 'approved' else 'declined' end,shift_id=v_shift,reviewed_by=p_actor,reviewed_at=now(),updated_at=now(),revision=revision+1 where id=q.id;
 insert into public.audit_logs(company_id,store_id,user_id,action,entity_type,entity_id,details)
 values(r.company_id,q.store_id,p_actor,'roster_shift_review','roster_shift_request',q.id::text,jsonb_build_object('approved',p_approve,'shift_id',v_shift));
 return v_shift;
end;
$$;
revoke all on function public.save_roster_shift_request(bigint,bigint,date,text,time,time,text) from public,anon,authenticated;
revoke all on function public.review_roster_shift_request(bigint,integer,boolean,uuid) from public,anon,authenticated;
grant execute on function public.save_roster_shift_request(bigint,bigint,date,text,time,time,text) to service_role;
grant execute on function public.review_roster_shift_request(bigint,integer,boolean,uuid) to service_role;
