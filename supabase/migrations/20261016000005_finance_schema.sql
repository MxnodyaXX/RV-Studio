-- =============================================================================
-- RV BUSINESS HUB — central finance
--
--   payments               money received from customers
--                          purpose 'charge'  : pays for a job / direct sale (income when earned)
--                          purpose 'deposit' : refundable security deposit (a LIABILITY, never income)
--                          method 'deposit'  : part of a held deposit applied to charges (no new cash)
--   refunds                money returned (charge refunds, deposit returns)
--   financial_adjustments  discounts / write-offs / surcharges that change the amount due
--   expenses               money paid out, always assigned to one business
--   shared_expenses        one bill split across businesses by an explicit rule;
--                          only the per-business allocation rows (expenses) are counted
--
-- Corrections are made by voiding (with a reason) — never by deleting.
-- Every source (booking/order/rental) is referenced by a real foreign key.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Payments
-- -----------------------------------------------------------------------------
create table public.payments (
  id                uuid primary key default gen_random_uuid(),
  receipt_no        bigint generated always as identity unique,
  ref               text generated always as ('RCP-' || lpad(receipt_no::text, 6, '0')) stored,
  business_id       uuid not null references public.businesses (id) on delete restrict,
  customer_id       uuid references public.customers (id) on delete restrict,
  studio_booking_id uuid references public.studio_bookings (id) on delete restrict,
  frame_order_id    uuid references public.frame_orders (id) on delete restrict,
  camera_rental_id  uuid references public.camera_rentals (id) on delete restrict,
  gift_order_id     uuid references public.gift_orders (id) on delete restrict,
  source_id         uuid generated always as (coalesce(studio_booking_id, frame_order_id, camera_rental_id, gift_order_id)) stored,
  purpose           text not null default 'charge' check (purpose in ('charge', 'deposit')),
  category_id       uuid,
  category_type     public.transaction_type not null default 'income' check (category_type = 'income'),
  amount            numeric(14, 2) not null check (amount > 0),
  method            public.money_method not null,
  paid_on           date not null,
  reference         text check (reference is null or length(reference) <= 200),
  notes             text check (notes is null or length(notes) <= 1000),
  client_request_id uuid unique,
  voided_at         timestamptz,
  void_reason       text check (void_reason is null or length(btrim(void_reason)) between 3 and 500),
  voided_by         uuid references auth.users (id) on delete set null,
  created_by        uuid default auth.uid() references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint payments_single_source check (num_nonnulls(studio_booking_id, frame_order_id, camera_rental_id, gift_order_id) <= 1),
  constraint payments_category_fkey foreign key (category_id, category_type)
    references public.transaction_categories (id, type) on delete restrict,
  -- Direct sales (no booking/order) must say what was sold.
  constraint payments_direct_needs_category check (source_id is not null or category_id is not null),
  constraint payments_deposit_only_rentals check (purpose = 'charge' or camera_rental_id is not null),
  constraint payments_deposit_method check (method <> 'deposit' or (purpose = 'charge' and camera_rental_id is not null)),
  constraint payments_void_reason check ((voided_at is null) = (void_reason is null)),
  constraint payments_paid_on_range check (paid_on between date '2000-01-01' and date '2100-12-31')
);
create index payments_source_idx   on public.payments (source_id) where voided_at is null;
create index payments_business_idx on public.payments (business_id, paid_on desc);
create index payments_customer_idx on public.payments (customer_id);
create index payments_paid_on_idx  on public.payments (paid_on desc, created_at desc);

-- -----------------------------------------------------------------------------
-- Refunds
-- -----------------------------------------------------------------------------
create table public.refunds (
  id                uuid primary key default gen_random_uuid(),
  refund_no         bigint generated always as identity unique,
  ref               text generated always as ('RFD-' || lpad(refund_no::text, 6, '0')) stored,
  business_id       uuid not null references public.businesses (id) on delete restrict,
  customer_id       uuid references public.customers (id) on delete restrict,
  studio_booking_id uuid references public.studio_bookings (id) on delete restrict,
  frame_order_id    uuid references public.frame_orders (id) on delete restrict,
  camera_rental_id  uuid references public.camera_rentals (id) on delete restrict,
  gift_order_id     uuid references public.gift_orders (id) on delete restrict,
  source_id         uuid generated always as (coalesce(studio_booking_id, frame_order_id, camera_rental_id, gift_order_id)) stored,
  payment_id        uuid references public.payments (id) on delete restrict,
  kind              text not null check (kind in ('charge_refund', 'deposit_return')),
  amount            numeric(14, 2) not null check (amount > 0),
  method            public.money_method not null check (method in ('cash', 'card', 'bank_transfer')),
  refunded_on       date not null check (refunded_on between date '2000-01-01' and date '2100-12-31'),
  reason            text not null check (length(btrim(reason)) between 3 and 500),
  client_request_id uuid unique,
  voided_at         timestamptz,
  void_reason       text check (void_reason is null or length(btrim(void_reason)) between 3 and 500),
  voided_by         uuid references auth.users (id) on delete set null,
  created_by        uuid default auth.uid() references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint refunds_single_source check (num_nonnulls(studio_booking_id, frame_order_id, camera_rental_id, gift_order_id) <= 1),
  constraint refunds_deposit_only_rentals check (kind = 'charge_refund' or camera_rental_id is not null),
  constraint refunds_direct_needs_payment check (source_id is not null or payment_id is not null),
  constraint refunds_void_reason check ((voided_at is null) = (void_reason is null))
);
create index refunds_source_idx   on public.refunds (source_id) where voided_at is null;
create index refunds_business_idx on public.refunds (business_id, refunded_on desc);
create index refunds_payment_idx  on public.refunds (payment_id);

-- -----------------------------------------------------------------------------
-- Financial adjustments (change the amount due of a booking/order/rental)
-- -----------------------------------------------------------------------------
create table public.financial_adjustments (
  id                uuid primary key default gen_random_uuid(),
  adjustment_no     bigint generated always as identity unique,
  ref               text generated always as ('ADJ-' || lpad(adjustment_no::text, 6, '0')) stored,
  business_id       uuid not null references public.businesses (id) on delete restrict,
  studio_booking_id uuid references public.studio_bookings (id) on delete restrict,
  frame_order_id    uuid references public.frame_orders (id) on delete restrict,
  camera_rental_id  uuid references public.camera_rentals (id) on delete restrict,
  gift_order_id     uuid references public.gift_orders (id) on delete restrict,
  source_id         uuid generated always as (coalesce(studio_booking_id, frame_order_id, camera_rental_id, gift_order_id)) stored,
  kind              text not null check (kind in ('discount', 'write_off', 'surcharge', 'cancellation', 'correction')),
  amount            numeric(14, 2) not null check (amount <> 0), -- negative reduces the amount due
  effective_on      date not null,
  reason            text not null check (length(btrim(reason)) between 3 and 500),
  client_request_id uuid unique,
  voided_at         timestamptz,
  void_reason       text check (void_reason is null or length(btrim(void_reason)) between 3 and 500),
  voided_by         uuid references auth.users (id) on delete set null,
  created_by        uuid default auth.uid() references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint adjustments_one_source check (num_nonnulls(studio_booking_id, frame_order_id, camera_rental_id, gift_order_id) = 1),
  constraint adjustments_sign check (
    (kind in ('discount', 'write_off') and amount < 0) or (kind = 'surcharge' and amount > 0) or kind in ('cancellation', 'correction')),
  constraint adjustments_void_reason check ((voided_at is null) = (void_reason is null))
);
create index adjustments_source_idx on public.financial_adjustments (source_id) where voided_at is null;

-- -----------------------------------------------------------------------------
-- Expenses and shared expenses
-- -----------------------------------------------------------------------------
create table public.shared_expenses (
  id                uuid primary key default gen_random_uuid(),
  shared_no         bigint generated always as identity unique,
  ref               text generated always as ('SHX-' || lpad(shared_no::text, 6, '0')) stored,
  category_id       uuid not null,
  category_type     public.transaction_type not null default 'expense' check (category_type = 'expense'),
  total_amount      numeric(14, 2) not null check (total_amount > 0),
  method            public.money_method not null check (method in ('cash', 'card', 'bank_transfer', 'other')),
  paid_on           date not null check (paid_on between date '2000-01-01' and date '2100-12-31'),
  description       text not null check (length(btrim(description)) between 1 and 500),
  receipt_reference text check (receipt_reference is null or length(receipt_reference) <= 200),
  allocation_method text not null check (allocation_method in ('equal', 'percentage', 'fixed')),
  allocation_rule   jsonb not null,
  client_request_id uuid unique,
  voided_at         timestamptz,
  void_reason       text check (void_reason is null or length(btrim(void_reason)) between 3 and 500),
  voided_by         uuid references auth.users (id) on delete set null,
  created_by        uuid default auth.uid() references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint shared_expenses_category_fkey foreign key (category_id, category_type)
    references public.transaction_categories (id, type) on delete restrict,
  constraint shared_expenses_void_reason check ((voided_at is null) = (void_reason is null))
);

create table public.expenses (
  id                uuid primary key default gen_random_uuid(),
  expense_no        bigint generated always as identity unique,
  ref               text generated always as ('EXP-' || lpad(expense_no::text, 6, '0')) stored,
  business_id       uuid not null references public.businesses (id) on delete restrict,
  category_id       uuid not null,
  category_type     public.transaction_type not null default 'expense' check (category_type = 'expense'),
  amount            numeric(14, 2) not null check (amount > 0),
  method            public.money_method not null check (method in ('cash', 'card', 'bank_transfer', 'other')),
  paid_on           date not null check (paid_on between date '2000-01-01' and date '2100-12-31'),
  description       text check (description is null or length(description) <= 1000),
  receipt_reference text check (receipt_reference is null or length(receipt_reference) <= 200),
  studio_booking_id uuid references public.studio_bookings (id) on delete restrict,
  frame_order_id    uuid references public.frame_orders (id) on delete restrict,
  camera_rental_id  uuid references public.camera_rentals (id) on delete restrict,
  gift_order_id     uuid references public.gift_orders (id) on delete restrict,
  source_id         uuid generated always as (coalesce(studio_booking_id, frame_order_id, camera_rental_id, gift_order_id)) stored,
  shared_expense_id uuid references public.shared_expenses (id) on delete restrict,
  client_request_id uuid unique,
  voided_at         timestamptz,
  void_reason       text check (void_reason is null or length(btrim(void_reason)) between 3 and 500),
  voided_by         uuid references auth.users (id) on delete set null,
  created_by        uuid default auth.uid() references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint expenses_category_fkey foreign key (category_id, category_type)
    references public.transaction_categories (id, type) on delete restrict,
  constraint expenses_single_source check (num_nonnulls(studio_booking_id, frame_order_id, camera_rental_id, gift_order_id) <= 1),
  constraint expenses_void_reason check ((voided_at is null) = (void_reason is null))
);
create index expenses_business_idx on public.expenses (business_id, paid_on desc);
create index expenses_paid_on_idx  on public.expenses (paid_on desc, created_at desc);
create index expenses_source_idx   on public.expenses (source_id) where voided_at is null;
create index expenses_shared_idx   on public.expenses (shared_expense_id);
create index expenses_category_idx on public.expenses (category_id);

-- -----------------------------------------------------------------------------
-- Move Phase 1 transactions into the new ledger (no data is lost)
-- -----------------------------------------------------------------------------
insert into public.payments (id, business_id, category_id, purpose, amount, method, paid_on, reference, notes,
                             client_request_id, created_by, created_at, updated_at)
select t.id, t.business_id, t.category_id, 'charge', t.amount,
       coalesce(t.payment_method::text, 'other')::public.money_method,
       t.transaction_date, t.reference, t.description, t.client_request_id, t.created_by, t.created_at, t.updated_at
from public.transactions t where t.type = 'income';

insert into public.expenses (id, business_id, category_id, amount, method, paid_on, description, receipt_reference,
                             client_request_id, created_by, created_at, updated_at)
select t.id, t.business_id, t.category_id, t.amount,
       coalesce(t.payment_method::text, 'other')::public.money_method,
       t.transaction_date, t.description, t.reference, t.client_request_id, t.created_by, t.created_at, t.updated_at
from public.transactions t where t.type = 'expense';

drop function if exists public.get_transaction_aggregates(date, date, uuid, text);
drop table public.transactions;

-- -----------------------------------------------------------------------------
-- Integrity triggers
-- -----------------------------------------------------------------------------
create trigger payments_set_updated_at before update on public.payments for each row execute function private.set_updated_at();
create trigger refunds_set_updated_at before update on public.refunds for each row execute function private.set_updated_at();
create trigger adjustments_set_updated_at before update on public.financial_adjustments for each row execute function private.set_updated_at();
create trigger expenses_set_updated_at before update on public.expenses for each row execute function private.set_updated_at();
create trigger shared_expenses_set_updated_at before update on public.shared_expenses for each row execute function private.set_updated_at();

-- Business and customer of a ledger row always come from its source document.
create or replace function private.ledger_row_defaults()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_business uuid;
  v_customer uuid;
begin
  if new.studio_booking_id is not null then
    select business_id, customer_id into v_business, v_customer from public.studio_bookings where id = new.studio_booking_id;
  elsif new.frame_order_id is not null then
    select business_id, customer_id into v_business, v_customer from public.frame_orders where id = new.frame_order_id;
  elsif new.camera_rental_id is not null then
    select business_id, customer_id into v_business, v_customer from public.camera_rentals where id = new.camera_rental_id;
  elsif new.gift_order_id is not null then
    select business_id, customer_id into v_business, v_customer from public.gift_orders where id = new.gift_order_id;
  end if;

  if v_business is not null then
    new.business_id := v_business;
    if tg_table_name in ('payments', 'refunds') then
      new.customer_id := coalesce(v_customer, new.customer_id);
    end if;
  end if;

  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
  else
    -- Financial facts are immutable; only notes/reference and voiding may change.
    if private.row_changed(to_jsonb(new), to_jsonb(old), array['notes', 'reference', 'description', 'receipt_reference', 'voided_at', 'void_reason', 'voided_by', 'updated_at']) then
      raise exception 'Recorded amounts, dates and links cannot be edited. Void the entry and record a new one.'
        using errcode = 'check_violation';
    end if;
    if old.voided_at is not null and new.voided_at is null then
      raise exception 'A voided entry cannot be restored' using errcode = 'check_violation';
    end if;
    if old.voided_at is null and new.voided_at is not null then
      new.voided_by := auth.uid();
    end if;
  end if;
  return new;
end;
$$;

create trigger payments_defaults before insert or update on public.payments for each row execute function private.ledger_row_defaults();
create trigger refunds_defaults before insert or update on public.refunds for each row execute function private.ledger_row_defaults();
create trigger adjustments_defaults before insert or update on public.financial_adjustments for each row execute function private.ledger_row_defaults();
create trigger expenses_defaults before insert or update on public.expenses for each row execute function private.ledger_row_defaults();

create or replace function private.shared_expense_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
    return new;
  end if;
  if private.row_changed(to_jsonb(new), to_jsonb(old), array['description', 'receipt_reference', 'voided_at', 'void_reason', 'voided_by', 'updated_at']) then
    raise exception 'Shared expense amounts and allocation cannot be edited. Void it and record a new one.' using errcode = 'check_violation';
  end if;
  if old.voided_at is not null and new.voided_at is null then
    raise exception 'A voided entry cannot be restored' using errcode = 'check_violation';
  end if;
  if old.voided_at is null and new.voided_at is not null then
    new.voided_by := auth.uid();
  end if;
  return new;
end;
$$;
create trigger shared_expenses_guard before insert or update on public.shared_expenses for each row execute function private.shared_expense_guard();

-- Voiding a shared expense voids its allocation rows; allocations can't be voided alone.
create or replace function private.shared_expense_cascade_void()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.voided_at is null and new.voided_at is not null then
    perform set_config('rv.shared_void', 'on', true);
    update public.expenses set voided_at = new.voided_at, void_reason = new.void_reason
     where shared_expense_id = new.id and voided_at is null;
    perform set_config('rv.shared_void', 'off', true);
  end if;
  return null;
end;
$$;
create trigger shared_expenses_cascade_void after update on public.shared_expenses for each row execute function private.shared_expense_cascade_void();

create or replace function private.expense_category_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_scope uuid;
begin
  select business_id into v_scope from public.transaction_categories where id = new.category_id;
  if v_scope is not null and v_scope <> new.business_id then
    raise exception 'This expense category belongs to a different business' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and new.shared_expense_id is not null and old.voided_at is null and new.voided_at is not null
     and coalesce(current_setting('rv.shared_void', true), 'off') <> 'on' then
    raise exception 'Void the shared expense instead of a single allocation' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger expenses_category_scope before insert or update on public.expenses for each row execute function private.expense_category_scope();

-- -----------------------------------------------------------------------------
-- Views (security_invoker: the caller's RLS applies)
-- -----------------------------------------------------------------------------

-- Every billable document with its base charges, due date and the date its
-- revenue is recognised (earned): shoot completed / delivered / returned.
create view public.source_documents with (security_invoker = true) as
select 'studio_booking'::public.source_type as source_type, b.id as source_id, b.ref, b.business_id, b.customer_id,
       b.package_name as title, b.status::text as status,
       (b.package_price + b.additional_charges) as base_amount,
       b.shoot_date as due_date, b.shoot_date as event_date,
       coalesce(b.completed_on, (b.cancelled_at at time zone 'Asia/Colombo')::date) as recognized_on,
       b.status = 'cancelled' as is_cancelled, b.status in ('closed', 'cancelled') as is_closed,
       0::numeric(14, 2) as deposit_required, b.created_at,
       lower(b.shoot_period) as event_at, upper(b.shoot_period) as end_at
from public.studio_bookings b
union all
select 'frame_order', f.id, f.ref, f.business_id, f.customer_id,
       coalesce((select string_agg(i.quantity || ' × ' || i.frame_type || ' ' || i.frame_size, ', ' order by i.sort_order)
                 from public.frame_order_items i where i.order_id = f.id), 'Frame order'),
       f.status::text, f.total_amount,
       f.expected_completion_date, f.expected_completion_date,
       coalesce(f.delivered_on, (f.cancelled_at at time zone 'Asia/Colombo')::date),
       f.status = 'cancelled', f.status in ('closed', 'cancelled'), 0::numeric(14, 2), f.created_at,
       null::timestamptz, null::timestamptz
from public.frame_orders f
union all
select 'camera_rental', r.id, r.ref, r.business_id, r.customer_id,
       coalesce((select string_agg(e.name, ', ' order by e.name)
                 from public.camera_rental_items i join public.camera_equipment e on e.id = i.equipment_id
                 where i.rental_id = r.id), 'Camera rental'),
       r.status::text, (r.rental_charge + r.late_fee + r.damage_charge + r.other_charges),
       (r.expected_return_at at time zone 'Asia/Colombo')::date, (r.pickup_at at time zone 'Asia/Colombo')::date,
       coalesce((r.actual_return_at at time zone 'Asia/Colombo')::date, (r.cancelled_at at time zone 'Asia/Colombo')::date),
       r.status = 'cancelled', r.status in ('closed', 'cancelled'), r.deposit_required, r.created_at,
       r.pickup_at, r.expected_return_at
from public.camera_rentals r
union all
select 'gift_order', g.id, g.ref, g.business_id, g.customer_id,
       coalesce((select string_agg(i.quantity || ' × ' || i.product_name, ', ' order by i.sort_order)
                 from public.gift_order_items i where i.order_id = g.id), 'Gift order'),
       g.status::text, g.total_amount,
       coalesce(g.expected_delivery_date, g.order_date), coalesce(g.expected_delivery_date, g.order_date),
       coalesce(g.delivered_on, (g.cancelled_at at time zone 'Asia/Colombo')::date),
       g.status = 'cancelled', g.status in ('completed', 'cancelled'), 0::numeric(14, 2), g.created_at,
       null::timestamptz, null::timestamptz
from public.gift_orders g;

-- Balances per document. Outstanding = amount due − (charge payments − charge refunds).
create view public.receivables with (security_invoker = true) as
select d.*,
       c.full_name as customer_name, c.phone as customer_phone, c.whatsapp as customer_whatsapp,
       coalesce(a.total, 0)::numeric(14, 2)                                         as adjustments,
       (d.base_amount + coalesce(a.total, 0))::numeric(14, 2)                       as amount_due,
       coalesce(p.charge_paid, 0)::numeric(14, 2)                                   as charge_paid,
       coalesce(r.charge_refunded, 0)::numeric(14, 2)                               as charge_refunded,
       (coalesce(p.charge_paid, 0) - coalesce(r.charge_refunded, 0))::numeric(14, 2) as net_paid,
       (d.base_amount + coalesce(a.total, 0) - coalesce(p.charge_paid, 0) + coalesce(r.charge_refunded, 0))::numeric(14, 2) as outstanding,
       coalesce(p.deposit_received, 0)::numeric(14, 2)                              as deposit_received,
       coalesce(p.deposit_applied, 0)::numeric(14, 2)                               as deposit_applied,
       coalesce(r.deposit_returned, 0)::numeric(14, 2)                              as deposit_returned,
       (coalesce(p.deposit_received, 0) - coalesce(p.deposit_applied, 0) - coalesce(r.deposit_returned, 0))::numeric(14, 2) as deposit_held,
       p.last_paid_on,
       case
         when (coalesce(p.charge_paid, 0) - coalesce(r.charge_refunded, 0)) > (d.base_amount + coalesce(a.total, 0)) then 'overpaid'
         when (d.base_amount + coalesce(a.total, 0)) <= 0 then 'no_charge'
         when (coalesce(p.charge_paid, 0) - coalesce(r.charge_refunded, 0)) = (d.base_amount + coalesce(a.total, 0)) then 'paid'
         when (coalesce(p.charge_paid, 0) - coalesce(r.charge_refunded, 0)) > 0 then 'partially_paid'
         else 'unpaid'
       end as payment_status,
       (not d.is_cancelled
         and (d.base_amount + coalesce(a.total, 0) - coalesce(p.charge_paid, 0) + coalesce(r.charge_refunded, 0)) > 0
         and d.due_date is not null and d.due_date < private.today()) as is_overdue
from public.source_documents d
left join public.customers c on c.id = d.customer_id
left join lateral (
  select sum(x.amount) filter (where x.purpose = 'charge')  as charge_paid,
         sum(x.amount) filter (where x.purpose = 'deposit') as deposit_received,
         sum(x.amount) filter (where x.method = 'deposit')  as deposit_applied,
         max(x.paid_on) filter (where x.purpose = 'charge') as last_paid_on
  from public.payments x where x.source_id = d.source_id and x.voided_at is null
) p on true
left join lateral (
  select sum(x.amount) filter (where x.kind = 'charge_refund')  as charge_refunded,
         sum(x.amount) filter (where x.kind = 'deposit_return') as deposit_returned
  from public.refunds x where x.source_id = d.source_id and x.voided_at is null
) r on true
left join lateral (
  select sum(x.amount) as total from public.financial_adjustments x where x.source_id = d.source_id and x.voided_at is null
) a on true;

-- Unified money ledger (what "Transaction History" shows).
create view public.ledger_entries with (security_invoker = true) as
select p.id, p.ref, case when p.purpose = 'deposit' then 'deposit_received' else 'payment' end as entry_type,
       'in'::text as direction, p.business_id, p.customer_id, d.source_type, p.source_id, d.ref as source_ref,
       p.paid_on as entry_date, p.amount, p.method, c.name as category_name,
       coalesce(p.notes, d.title) as description, p.reference,
       p.voided_at is not null as is_voided, p.void_reason, p.created_at
from public.payments p
left join public.source_documents d on d.source_id = p.source_id
left join public.transaction_categories c on c.id = p.category_id
union all
select r.id, r.ref, case when r.kind = 'deposit_return' then 'deposit_returned' else 'refund' end,
       'out', r.business_id, r.customer_id, d.source_type, r.source_id, d.ref,
       r.refunded_on, r.amount, r.method, null, r.reason, null,
       r.voided_at is not null, r.void_reason, r.created_at
from public.refunds r
left join public.source_documents d on d.source_id = r.source_id
union all
select e.id, e.ref, 'expense', 'out', e.business_id, null, d.source_type, e.source_id, d.ref,
       e.paid_on, e.amount, e.method, c.name, e.description, coalesce(e.receipt_reference, sx.ref),
       e.voided_at is not null, e.void_reason, e.created_at
from public.expenses e
left join public.source_documents d on d.source_id = e.source_id
left join public.transaction_categories c on c.id = e.category_id
left join public.shared_expenses sx on sx.id = e.shared_expense_id;

-- Balance of one document (used by workflow rules).
create or replace function private.balance_of(p_source_id uuid)
returns table (amount_due numeric, net_paid numeric, outstanding numeric, deposit_held numeric)
language sql stable security definer set search_path = '' as $$
  select amount_due, net_paid, outstanding, deposit_held from public.receivables where source_id = p_source_id;
$$;
