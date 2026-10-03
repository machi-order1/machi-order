-- Strengthen the original check on already migrated databases.
alter table public.settlement_entries add constraint settlement_void_reason_required
check (voided_at is null or (void_reason is not null and length(trim(void_reason)) between 5 and 500));
