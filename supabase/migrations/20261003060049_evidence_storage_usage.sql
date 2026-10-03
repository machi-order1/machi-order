-- One indexed bucket scan reports the live size of receipt and invoice originals.
-- Only trusted server code may call this function; the Edge API checks membership.
create or replace function public.evidence_storage_usage(p_store_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'project_bytes', coalesce(sum(s.bytes), 0),
    'project_files', count(*),
    'store_bytes', coalesce(sum(s.bytes) filter (where left(o.name, length(p_store_id::text) + 1) = p_store_id::text || '/'), 0),
    'store_files', count(*) filter (where left(o.name, length(p_store_id::text) + 1) = p_store_id::text || '/')
  )
  from storage.objects o
  cross join lateral (
    select case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::bigint else 0 end as bytes
  ) s
  where o.bucket_id = 'expense-receipts';
$$;

revoke all on function public.evidence_storage_usage(bigint) from public, anon, authenticated;
grant execute on function public.evidence_storage_usage(bigint) to service_role;
