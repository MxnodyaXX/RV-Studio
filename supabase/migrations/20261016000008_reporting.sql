-- =============================================================================
-- RV BUSINESS HUB — financial reporting
--
-- Accounting rules (consistent across every report):
--   * Earned revenue (P&L) is recognised when the work is done:
--       studio shoot completed · frame delivered · camera returned · gift delivered
--     and equals the document's final amount due (charges ± adjustments).
--     A cancelled document recognises only what was retained, on the cancel date.
--     Direct sales (no booking/order) are earned on the payment date, net of refunds.
--   * Collections report money actually received, by method, on the payment date.
--     "Deposit" method = part of a held deposit applied to charges (not new cash).
--   * Refundable deposits are liabilities: never revenue, never profit.
--   * Expenses are recognised on the date paid. Shared expenses count only via
--     their per-business allocation rows, so totals are never double-counted.
--   * Net profit = earned revenue − expenses.
-- All functions are SECURITY INVOKER: RLS decides what the caller can see.
-- =============================================================================

create or replace function private.in_range(p_value date, p_from date, p_to date) returns boolean
language sql immutable set search_path = '' as $$
  -- A missing date (e.g. not yet completed) is never inside any range.
  select p_value is not null and (p_from is null or p_value >= p_from) and (p_to is null or p_value <= p_to);
$$;

create or replace function public.report_business_summary(p_from date default null, p_to date default null, p_business_id uuid default null)
returns table (
  business_id       uuid,
  earned_revenue    numeric,
  job_revenue       numeric,
  direct_sales      numeric,
  collected_total   numeric,
  collected_cash    numeric,
  collected_card    numeric,
  collected_bank    numeric,
  collected_other   numeric,
  deposit_applied   numeric,
  refunds_total     numeric,
  advance_payments  numeric,
  expenses_total    numeric,
  net_profit        numeric,
  deposits_received numeric,
  deposits_returned numeric,
  deposits_held     numeric,
  outstanding       numeric,
  overdue           numeric,
  documents_count   bigint,
  completed_count   bigint
)
language sql stable security invoker set search_path = '' as $$
  with biz as (
    select b.id from public.businesses b where p_business_id is null or b.id = p_business_id
  ),
  docs as (
    select * from public.receivables where p_business_id is null or business_id = p_business_id
  ),
  jobs as (
    select d.business_id,
           sum(d.amount_due) filter (where private.in_range(d.recognized_on, p_from, p_to)) as job_revenue,
           count(*) filter (where not d.is_cancelled and private.in_range((d.created_at at time zone 'Asia/Colombo')::date, p_from, p_to)) as documents_count,
           count(*) filter (where not d.is_cancelled and private.in_range(d.recognized_on, p_from, p_to)) as completed_count,
           sum(d.outstanding) filter (where not d.is_cancelled and d.outstanding > 0) as outstanding,
           sum(d.outstanding) filter (where d.is_overdue) as overdue,
           sum(d.deposit_held) as deposits_held
    from docs d group by d.business_id
  ),
  pay as (
    select p.business_id,
           sum(p.amount) filter (where p.purpose = 'charge') as collected_total,
           sum(p.amount) filter (where p.purpose = 'charge' and p.method = 'cash') as collected_cash,
           sum(p.amount) filter (where p.purpose = 'charge' and p.method = 'card') as collected_card,
           sum(p.amount) filter (where p.purpose = 'charge' and p.method = 'bank_transfer') as collected_bank,
           sum(p.amount) filter (where p.purpose = 'charge' and p.method = 'other') as collected_other,
           sum(p.amount) filter (where p.method = 'deposit') as deposit_applied,
           sum(p.amount) filter (where p.purpose = 'charge' and p.source_id is null) as direct_sales_gross,
           sum(p.amount) filter (where p.purpose = 'deposit') as deposits_received,
           sum(p.amount) filter (where p.purpose = 'charge' and p.source_id is not null
                                   and (d.recognized_on is null or p.paid_on < d.recognized_on)) as advance_payments
    from public.payments p
    left join public.source_documents d on d.source_id = p.source_id
    where p.voided_at is null and private.in_range(p.paid_on, p_from, p_to)
      and (p_business_id is null or p.business_id = p_business_id)
    group by p.business_id
  ),
  ref as (
    select r.business_id,
           sum(r.amount) filter (where r.kind = 'charge_refund') as refunds_total,
           sum(r.amount) filter (where r.kind = 'charge_refund' and r.source_id is null) as direct_refunds,
           sum(r.amount) filter (where r.kind = 'deposit_return') as deposits_returned
    from public.refunds r
    where r.voided_at is null and private.in_range(r.refunded_on, p_from, p_to)
      and (p_business_id is null or r.business_id = p_business_id)
    group by r.business_id
  ),
  exp as (
    select e.business_id, sum(e.amount) as expenses_total
    from public.expenses e
    where e.voided_at is null and private.in_range(e.paid_on, p_from, p_to)
      and (p_business_id is null or e.business_id = p_business_id)
    group by e.business_id
  )
  select biz.id,
         (coalesce(j.job_revenue, 0) + coalesce(p.direct_sales_gross, 0) - coalesce(r.direct_refunds, 0))::numeric(14, 2),
         coalesce(j.job_revenue, 0)::numeric(14, 2),
         (coalesce(p.direct_sales_gross, 0) - coalesce(r.direct_refunds, 0))::numeric(14, 2),
         coalesce(p.collected_total, 0)::numeric(14, 2),
         coalesce(p.collected_cash, 0)::numeric(14, 2),
         coalesce(p.collected_card, 0)::numeric(14, 2),
         coalesce(p.collected_bank, 0)::numeric(14, 2),
         coalesce(p.collected_other, 0)::numeric(14, 2),
         coalesce(p.deposit_applied, 0)::numeric(14, 2),
         coalesce(r.refunds_total, 0)::numeric(14, 2),
         coalesce(p.advance_payments, 0)::numeric(14, 2),
         coalesce(e.expenses_total, 0)::numeric(14, 2),
         (coalesce(j.job_revenue, 0) + coalesce(p.direct_sales_gross, 0) - coalesce(r.direct_refunds, 0) - coalesce(e.expenses_total, 0))::numeric(14, 2),
         coalesce(p.deposits_received, 0)::numeric(14, 2),
         coalesce(r.deposits_returned, 0)::numeric(14, 2),
         coalesce(j.deposits_held, 0)::numeric(14, 2),
         coalesce(j.outstanding, 0)::numeric(14, 2),
         coalesce(j.overdue, 0)::numeric(14, 2),
         coalesce(j.documents_count, 0),
         coalesce(j.completed_count, 0)
  from biz
  left join jobs j on j.business_id = biz.id
  left join pay p on p.business_id = biz.id
  left join ref r on r.business_id = biz.id
  left join exp e on e.business_id = biz.id;
$$;

-- Time series per business: earned revenue, net collections and expenses.
create or replace function public.report_trend(p_from date default null, p_to date default null,
  p_business_id uuid default null, p_granularity text default 'month')
returns table (business_id uuid, period date, earned_revenue numeric, collected numeric, expenses numeric)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_granularity not in ('day', 'month') then
    raise exception 'Invalid granularity' using errcode = '22023';
  end if;
  return query
  with rows as (
    select d.business_id, d.recognized_on as on_date, d.amount_due as earned, 0::numeric as collected, 0::numeric as spent
    from public.receivables d where d.recognized_on is not null
    union all
    select p.business_id, p.paid_on, case when p.source_id is null and p.purpose = 'charge' then p.amount else 0 end,
           case when p.purpose = 'charge' and p.method <> 'deposit' then p.amount else 0 end, 0
    from public.payments p where p.voided_at is null
    union all
    select r.business_id, r.refunded_on, case when r.source_id is null then -r.amount else 0 end,
           case when r.kind = 'charge_refund' then -r.amount else 0 end, 0
    from public.refunds r where r.voided_at is null
    union all
    select e.business_id, e.paid_on, 0, 0, e.amount from public.expenses e where e.voided_at is null
  )
  select x.business_id, date_trunc(p_granularity, x.on_date)::date,
         sum(x.earned)::numeric(14, 2), sum(x.collected)::numeric(14, 2), sum(x.spent)::numeric(14, 2)
  from rows x
  where private.in_range(x.on_date, p_from, p_to) and (p_business_id is null or x.business_id = p_business_id)
  group by 1, 2
  order by 2, 1;
end;
$$;

-- Money in/out by payment method (collections report, not P&L).
create or replace function public.report_payment_methods(p_from date default null, p_to date default null, p_business_id uuid default null)
returns table (business_id uuid, method public.money_method, charge_payments numeric, deposits_received numeric,
               refunds_paid numeric, deposits_returned numeric, expenses_paid numeric)
language sql stable security invoker set search_path = '' as $$
  with rows as (
    select p.business_id, p.method,
           case when p.purpose = 'charge' then p.amount else 0 end as cp,
           case when p.purpose = 'deposit' then p.amount else 0 end as dr, 0::numeric as rf, 0::numeric as dret, 0::numeric as ex
    from public.payments p where p.voided_at is null and private.in_range(p.paid_on, p_from, p_to)
    union all
    select r.business_id, r.method, 0, 0,
           case when r.kind = 'charge_refund' then r.amount else 0 end,
           case when r.kind = 'deposit_return' then r.amount else 0 end, 0
    from public.refunds r where r.voided_at is null and private.in_range(r.refunded_on, p_from, p_to)
    union all
    select e.business_id, e.method, 0, 0, 0, 0, e.amount
    from public.expenses e where e.voided_at is null and private.in_range(e.paid_on, p_from, p_to)
  )
  select business_id, method, sum(cp)::numeric(14, 2), sum(dr)::numeric(14, 2), sum(rf)::numeric(14, 2),
         sum(dret)::numeric(14, 2), sum(ex)::numeric(14, 2)
  from rows
  where p_business_id is null or business_id = p_business_id
  group by business_id, method
  order by business_id, method;
$$;

-- Operational counters for the dashboard business cards.
create or replace function public.dashboard_operations(p_from date default null, p_to date default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'studio', jsonb_build_object(
      'total_bookings',  (select count(*) from public.studio_bookings b where b.status <> 'cancelled'
                            and private.in_range(b.shoot_date, p_from, p_to)),
      'confirmed_shoots', (select count(*) from public.studio_bookings b where b.status in ('confirmed', 'in_progress')
                            and private.in_range(b.shoot_date, p_from, p_to)),
      'pending_advance', (select count(*) from public.studio_bookings b where b.status = 'pending_advance'),
      'upcoming_shoots', (select count(*) from public.studio_bookings b where b.status in ('confirmed', 'in_progress')
                            and b.shoot_date >= private.today())
    ),
    'frame', jsonb_build_object(
      'total_orders',      (select count(*) from public.frame_orders f where f.status <> 'cancelled'
                              and private.in_range(f.order_date, p_from, p_to)),
      'processing',        (select count(*) from public.frame_orders f where f.status in ('new', 'processing')),
      'ready',             (select count(*) from public.frame_orders f where f.status = 'ready'),
      'pending_deliveries',(select count(*) from public.frame_orders f where f.status in ('new', 'processing', 'ready')
                              and f.expected_completion_date is not null and f.expected_completion_date <= private.today() + 3)
    ),
    'camera', jsonb_build_object(
      'active_rentals',     (select count(*) from public.camera_rentals r where r.status = 'rented_out'),
      'available_equipment',(select count(*) from public.camera_equipment e where e.status = 'available'
                               and not exists (select 1 from public.camera_rental_items i join public.camera_rentals r on r.id = i.rental_id
                                               where i.equipment_id = e.id and r.status = 'rented_out' and i.returned_at is null)),
      'total_equipment',    (select count(*) from public.camera_equipment e where e.status <> 'retired'),
      'upcoming_returns',   (select count(*) from public.camera_rentals r where r.status = 'rented_out'
                               and r.expected_return_at between now() and now() + interval '3 days'),
      'overdue_rentals',    (select count(*) from public.camera_rentals r where r.status = 'rented_out' and r.expected_return_at < now())
    ),
    'gift', jsonb_build_object(
      'total_orders',     (select count(*) from public.gift_orders g where g.status <> 'cancelled'
                             and private.in_range(g.order_date, p_from, p_to)),
      'pending_orders',   (select count(*) from public.gift_orders g where g.status in ('new', 'processing', 'ready')),
      'completed_orders', (select count(*) from public.gift_orders g where g.status in ('delivered', 'completed')
                             and private.in_range(coalesce(g.delivered_on, g.order_date), p_from, p_to)),
      'low_stock',        (select count(*) from public.gift_products gp where gp.is_active and gp.track_stock
                             and gp.stock_quantity <= gp.reorder_level)
    )
  )
  where private.is_admin();
$$;
