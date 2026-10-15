-- =============================================================================
-- RV BUSINESS HUB — reporting RPCs
-- SECURITY INVOKER: they run with the caller's privileges, so RLS applies and a
-- non-administrator receives no rows.
-- =============================================================================

-- Totals grouped by business x period x type for an optional date range and
-- optional business. Every transaction falls into exactly one group, so nothing
-- is double-counted. All KPIs (net profit, distributions, charts) are derived
-- from these rows. p_granularity is 'day' or 'month'.
create or replace function public.get_transaction_aggregates(
  p_from        date default null,
  p_to          date default null,
  p_business_id uuid default null,
  p_granularity text default 'month'
)
returns table (
  business_id uuid,
  period      date,
  type        public.transaction_type,
  total       numeric(14, 2),
  txn_count   bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_granularity not in ('day', 'month') then
    raise exception 'Invalid granularity %', p_granularity using errcode = '22023';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'Start date must be on or before end date' using errcode = '22023';
  end if;

  return query
  select
    t.business_id,
    date_trunc(p_granularity, t.transaction_date)::date as period,
    t.type,
    sum(t.amount)::numeric(14, 2)                       as total,
    count(*)                                            as txn_count
  from public.transactions t
  where (p_from is null or t.transaction_date >= p_from)
    and (p_to is null or t.transaction_date <= p_to)
    and (p_business_id is null or t.business_id = p_business_id)
  group by t.business_id, date_trunc(p_granularity, t.transaction_date), t.type
  order by 2, 1, 3;
end;
$$;

revoke all on function public.get_transaction_aggregates(date, date, uuid, text) from public, anon;
grant execute on function public.get_transaction_aggregates(date, date, uuid, text) to authenticated;
