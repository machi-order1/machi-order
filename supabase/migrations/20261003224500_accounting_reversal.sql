-- Corrections keep the posted original and add a linked opposite entry.
create table public.accounting_reversals (
  id bigint generated always as identity primary key,
  original_entry_id bigint not null unique references public.accounting_entries(id),
  reversal_entry_id bigint not null unique references public.accounting_entries(id),
  reason text not null check (length(trim(reason)) between 5 and 500),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (original_entry_id<>reversal_entry_id)
);

create function public.reverse_accounting_entry(p_entry_id bigint,p_date date,p_reason text,p_actor uuid)
returns bigint language plpgsql security invoker
set search_path to 'public','pg_temp' as $body$
declare original public.accounting_entries%rowtype; new_id bigint;
begin
  if p_actor is null or p_date is null or length(trim(coalesce(p_reason,''))) not between 5 and 500 then
    raise exception 'reversal_reason_date_actor_required';
  end if;
  select * into original from public.accounting_entries where id=p_entry_id for update;
  if not found or original.status<>'posted' or original.source_type='reversal' or p_date<original.entry_date then
    raise exception 'reversal_original_invalid';
  end if;
  if exists (select 1 from public.accounting_reversals where original_entry_id=p_entry_id) then
    raise exception 'entry_already_reversed';
  end if;
  insert into public.accounting_entries(subject_id,business_id,store_id,entry_date,description,source_type,source_id,created_by)
  values(original.subject_id,original.business_id,original.store_id,p_date,
    '取消：'||left(original.description,490),'reversal',p_entry_id::text,p_actor)
  returning id into new_id;
  insert into public.accounting_lines(entry_id,subject_id,account_id,debit_yen,credit_yen,description,receipt_import_id)
  select new_id,subject_id,account_id,credit_yen,debit_yen,description,receipt_import_id
  from public.accounting_lines where entry_id=p_entry_id;
  update public.accounting_entries set status='posted' where id=new_id;
  insert into public.accounting_reversals(original_entry_id,reversal_entry_id,reason,created_by)
  values(p_entry_id,new_id,trim(p_reason),p_actor);
  return new_id;
end $body$;

alter table public.accounting_reversals enable row level security;
revoke all on public.accounting_reversals from anon,authenticated;
revoke all on function public.reverse_accounting_entry(bigint,date,text,uuid) from public,anon,authenticated;
