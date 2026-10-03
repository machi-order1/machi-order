-- The two bars will use independent applications. Remove the unlinked draft rows
-- created by the earlier accounting foundation migration; never delete linked data.
delete from public.accounting_businesses b
where b.code in ('icoi','yaneura')
  and not exists (select 1 from public.accounting_store_periods p where p.business_id=b.id)
  and not exists (select 1 from public.accounting_subject_periods p where p.business_id=b.id);
