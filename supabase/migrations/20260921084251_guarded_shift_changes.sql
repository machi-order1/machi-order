-- Private atomic manager mutations. Staff roster identities and pay stay in the database.
create or replace function public.manage_roster_shift(p_actor uuid,p_body jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 a text:=p_body->>'action'; sid bigint; st bigint; rid bigint; cid bigint;
 r public.staff_roster%rowtype; old public.work_shifts%rowtype; saved public.work_shifts%rowtype;
 d date; t1 time; t2 time; ci timestamptz; co timestamptz; br integer; reason text:=trim(coalesce(p_body->>'reason',''));
begin
 if a not in ('shift_create','shift_update','shift_cancel','attendance_save') or a is null then raise exception '未対応の操作です'; end if;
 if a='shift_create' then
  rid:=(p_body->>'staff_id')::bigint; st:=(p_body->>'store_id')::bigint;
 else
  sid:=(p_body->>'shift_id')::bigint;
  -- Match review's request -> roster lock order.
  perform 1 from public.roster_shift_requests where shift_id=sid for update;
  select * into old from public.work_shifts where id=sid;
  if not found then raise exception 'シフトが見つかりません'; end if;
  rid:=old.roster_staff_id; st:=old.store_id;
  if rid is null then select id into rid from public.staff_roster where auth_user_id=old.user_id; end if;
 end if;
 select * into r from public.staff_roster where id=rid for update;
 if not found then raise exception '名簿との紐付けが必要です'; end if;
 cid:=r.company_id;
 if not exists(select 1 from public.stores s join public.brands b on b.id=s.brand_id where s.id=st and b.company_id=cid)
 or not exists(select 1 from public.store_memberships m join public.stores s on s.id=m.store_id join public.brands b on b.id=s.brand_id where m.user_id=p_actor and m.active and m.role in ('owner','manager','admin') and b.company_id=cid) then raise exception '店長権限が必要です'; end if;
 if a<>'shift_create' then
  select * into old from public.work_shifts where id=sid for update;
  if old.updated_at is distinct from (p_body->>'expected_updated_at')::timestamptz then raise exception '別の操作で更新されています。再読み込みしてください'; end if;
  if old.status='cancelled' then raise exception '取消済みのシフトです'; end if;
 end if;
 if a in ('shift_create','shift_update') then
  if not r.active or not exists(select 1 from public.staff_store_assignments where staff_id=rid and store_id=st and active) then raise exception 'この店舗の在籍スタッフではありません'; end if;
  if a='shift_update' and (old.status<>'scheduled' or old.clock_in is not null) then raise exception '勤務開始後は予定を変更できません。勤怠修正を使ってください'; end if;
  if a='shift_update' and ((p_body->>'staff_id')::bigint is distinct from rid or (p_body->>'store_id')::bigint is distinct from st) then raise exception 'スタッフ・店舗の変更は取消後に登録してください'; end if;
  d:=(p_body->>'shift_date')::date; t1:=(p_body->>'scheduled_start')::time; t2:=(p_body->>'scheduled_end')::time;
  if d is null or t1 is null or t2 is null or t1>=t2 then raise exception '日付と開始・終了時刻を確認してください'; end if;
  if exists(select 1 from public.work_shifts w where w.id<>coalesce(sid,-1) and (w.roster_staff_id=rid or (r.auth_user_id is not null and w.user_id=r.auth_user_id)) and w.shift_date=d and w.status in ('scheduled','working','completed') and coalesce(w.scheduled_start,'00:00'::time)<t2 and coalesce(w.scheduled_end,'24:00'::time)>t1) then raise exception '他店舗を含め同じ時間帯に勤務があります'; end if;
  if a='shift_create' then
   insert into public.work_shifts(store_id,roster_staff_id,user_id,shift_date,scheduled_start,scheduled_end,hourly_wage_snapshot,status,published_at,note)
   values(st,rid,r.auth_user_id,d,t1,t2,r.hourly_wage,'scheduled',now(),left(p_body->>'note',300)) returning * into saved;
  else
   update public.work_shifts set shift_date=d,scheduled_start=t1,scheduled_end=t2,updated_at=clock_timestamp(),revision=revision+1 where id=sid returning * into saved;
  end if;
 elsif a='shift_cancel' then
  if old.status<>'scheduled' or old.clock_in is not null then raise exception '勤務開始後のシフトは取消できません'; end if;
  if length(reason)<2 or length(reason)>300 then raise exception '取消理由を2〜300文字で入力してください'; end if;
  update public.work_shifts set status='cancelled',updated_at=clock_timestamp(),revision=revision+1 where id=sid returning * into saved;
  update public.roster_shift_requests set status='declined',revision=revision+1,reviewed_by=p_actor,reviewed_at=now(),updated_at=now() where shift_id=sid;
 else
  if length(reason)<2 or length(reason)>300 then raise exception '修正理由を2〜300文字で入力してください'; end if;
  ci:=(p_body->>'clock_in')::timestamptz; co:=(p_body->>'clock_out')::timestamptz;
  if coalesce(p_body->>'break_minutes','') !~ '^[0-9]+$' then raise exception '休憩は0以上の整数で入力してください'; end if;
  br:=(p_body->>'break_minutes')::integer;
  if ci is null or co is null or not isfinite(ci) or not isfinite(co) or co<=ci or br*60.0>extract(epoch from co-ci) then raise exception '出退勤時刻・休憩時間を確認してください'; end if;
  if exists(select 1 from public.work_breaks where shift_id=sid and ended_at is null) then raise exception '休憩中です。先に店舗端末で休憩を終了してください'; end if;
  update public.work_shifts set clock_in=ci,clock_out=co,break_minutes=br,labor_cost=round(greatest(0,round(extract(epoch from co-ci)/60)-br)/60*hourly_wage_snapshot),status='completed',updated_at=clock_timestamp(),revision=revision+1 where id=sid returning * into saved;
 end if;
 insert into public.audit_logs(company_id,store_id,user_id,action,entity_type,entity_id,details)
 values(cid,st,p_actor,a,'work_shift',saved.id::text,jsonb_build_object('reason',reason,'before',case when a='shift_create' then null else to_jsonb(old) end,'after',to_jsonb(saved)));
 return to_jsonb(saved);
end;
$$;
revoke all on function public.manage_roster_shift(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.manage_roster_shift(uuid,jsonb) to service_role;
