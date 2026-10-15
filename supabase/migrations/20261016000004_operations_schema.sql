-- =============================================================================
-- RV BUSINESS HUB — operations schema
-- Customers, settings, Studio of RV bookings, The Frame House orders,
-- RV Camera Rent rentals and equipment, Gift Park products/orders/inventory.
-- Money is NUMERIC(14,2). Business dates are Asia/Colombo calendar dates.
-- =============================================================================

create extension if not exists btree_gist with schema extensions;

-- -----------------------------------------------------------------------------
-- Types
-- -----------------------------------------------------------------------------
create type public.money_method as enum ('cash', 'card', 'bank_transfer', 'deposit', 'other');
create type public.source_type as enum ('studio_booking', 'frame_order', 'camera_rental', 'gift_order');
create type public.studio_booking_status as enum ('pending_advance', 'confirmed', 'in_progress', 'shoot_completed', 'closed', 'cancelled');
create type public.frame_order_status as enum ('new', 'processing', 'ready', 'delivered', 'closed', 'cancelled');
create type public.camera_rental_status as enum ('booked', 'ready_for_pickup', 'rented_out', 'returned', 'closed', 'cancelled');
create type public.gift_order_status as enum ('new', 'processing', 'ready', 'delivered', 'completed', 'cancelled');
create type public.equipment_status as enum ('available', 'maintenance', 'retired');

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
create or replace function private.today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Colombo')::date;
$$;

create or replace function private.business_id_for(p_slug text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.businesses where slug = p_slug;
$$;

create or replace function private.require_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
end;
$$;

-- True when a row changed outside the allowed columns. Stored generated
-- columns are always ignored: they are not yet computed inside BEFORE triggers.
create or replace function private.row_changed(p_new jsonb, p_old jsonb, p_allowed text[]) returns boolean
language sql immutable set search_path = '' as $$
  select (p_new - p_allowed - array['ref', 'source_id', 'total_amount', 'line_total', 'updated_at'])
         is distinct from
         (p_old - p_allowed - array['ref', 'source_id', 'total_amount', 'line_total', 'updated_at']);
$$;

-- Valid reminder offsets: 0..365, at most 10 entries, no nulls.
create or replace function private.valid_offsets(p int[]) returns boolean
language sql immutable set search_path = '' as $$
  select p is not null
     and coalesce(array_length(p, 1), 0) <= 10
     and not exists (select 1 from unnest(p) v where v is null or v < 0 or v > 365);
$$;

-- -----------------------------------------------------------------------------
-- System settings (singleton row)
-- -----------------------------------------------------------------------------
create table public.system_settings (
  id uuid primary key default gen_random_uuid(),
  studio_reminder_days        int[] not null default '{7,3,1,0}' check (private.valid_offsets(studio_reminder_days)),
  frame_reminder_days         int[] not null default '{1,0}'     check (private.valid_offsets(frame_reminder_days)),
  gift_reminder_days          int[] not null default '{1,0}'     check (private.valid_offsets(gift_reminder_days)),
  payment_due_reminder_days   int[] not null default '{1,0}'     check (private.valid_offsets(payment_due_reminder_days)),
  rental_pickup_reminder_hours int[] not null default '{24,2}'   check (private.valid_offsets(rental_pickup_reminder_hours)),
  rental_return_reminder_hours int[] not null default '{24,3}'   check (private.valid_offsets(rental_return_reminder_hours)),
  default_advance_percent     numeric(5, 2) not null default 25 check (default_advance_percent between 0 and 100),
  late_fee_multiplier         numeric(5, 2) not null default 1  check (late_fee_multiplier between 0 and 10),
  rental_grace_minutes        int not null default 60 check (rental_grace_minutes between 0 and 1440),
  gift_require_full_payment_before_delivery boolean not null default true,
  gift_stock_deduction        text not null default 'on_order' check (gift_stock_deduction in ('on_order', 'on_delivery')),
  receipt_footer              text not null default 'Thank you for your business.' check (length(receipt_footer) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index system_settings_singleton on public.system_settings ((true));
insert into public.system_settings default values;

-- -----------------------------------------------------------------------------
-- Customers (shared across all four businesses)
-- -----------------------------------------------------------------------------
create table public.customers (
  id          uuid primary key default gen_random_uuid(),
  customer_no bigint generated always as identity unique,
  ref         text generated always as ('CUS-' || lpad(customer_no::text, 5, '0')) stored,
  full_name   text not null check (length(btrim(full_name)) between 1 and 120),
  phone       text check (phone is null or phone ~ '^\+?[0-9 ()-]{7,20}$'),
  whatsapp    text check (whatsapp is null or whatsapp ~ '^\+?[0-9 ()-]{7,20}$'),
  email       text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  address     text check (address is null or length(address) <= 300),
  notes       text check (notes is null or length(notes) <= 1000),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index customers_name_idx  on public.customers (lower(full_name));
create index customers_phone_idx on public.customers (phone);

-- -----------------------------------------------------------------------------
-- Studio of RV
-- -----------------------------------------------------------------------------
create table public.studio_packages (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique check (length(btrim(name)) between 1 and 120),
  description    text check (description is null or length(description) <= 1000),
  base_price     numeric(14, 2) not null default 0 check (base_price >= 0),
  duration_hours numeric(4, 1) check (duration_hours is null or duration_hours between 0.5 and 48),
  is_active      boolean not null default true,
  sort_order     smallint not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Photographers, studio rooms or other resources that can't be double-booked.
create table public.studio_resources (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (length(btrim(name)) between 1 and 120),
  kind       text not null default 'photographer' check (kind in ('photographer', 'studio', 'equipment', 'other')),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.studio_bookings (
  id                  uuid primary key default gen_random_uuid(),
  booking_no          bigint generated always as identity unique,
  ref                 text generated always as ('SB-' || lpad(booking_no::text, 6, '0')) stored,
  business_id         uuid not null references public.businesses (id) on delete restrict,
  customer_id         uuid not null references public.customers (id) on delete restrict,
  package_id          uuid references public.studio_packages (id) on delete set null,
  package_name        text not null check (length(btrim(package_name)) between 1 and 120),
  package_description text check (package_description is null or length(package_description) <= 1000),
  shoot_date          date not null,
  start_time          time not null,
  end_time            time not null,
  location            text not null check (length(btrim(location)) between 1 and 200),
  resource_id         uuid references public.studio_resources (id) on delete restrict,
  package_price       numeric(14, 2) not null check (package_price >= 0),
  additional_charges  numeric(14, 2) not null default 0 check (additional_charges >= 0),
  additional_charges_note text check (additional_charges_note is null or length(additional_charges_note) <= 300),
  required_advance    numeric(14, 2) not null default 0 check (required_advance >= 0),
  notes               text check (notes is null or length(notes) <= 2000),
  status              public.studio_booking_status not null default 'pending_advance',
  shoot_period        tstzrange,
  confirmed_at        timestamptz,
  started_at          timestamptz,
  completed_on        date,
  closed_at           timestamptz,
  cancelled_at        timestamptz,
  cancel_reason       text check (cancel_reason is null or length(cancel_reason) <= 500),
  client_request_id   uuid unique,
  created_by          uuid default auth.uid() references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint studio_bookings_time_order check (end_time > start_time),
  constraint studio_bookings_advance_le_total check (required_advance <= package_price + additional_charges),
  -- A photographer / studio resource can't have two confirmed or in-progress shoots at once.
  constraint studio_bookings_no_resource_overlap exclude using gist (resource_id with =, shoot_period with &&)
    where (resource_id is not null and status in ('confirmed', 'in_progress'))
);
create index studio_bookings_date_idx     on public.studio_bookings (shoot_date);
create index studio_bookings_status_idx   on public.studio_bookings (status);
create index studio_bookings_customer_idx on public.studio_bookings (customer_id);

-- -----------------------------------------------------------------------------
-- The Frame House
-- -----------------------------------------------------------------------------
create table public.frame_orders (
  id                       uuid primary key default gen_random_uuid(),
  order_no                 bigint generated always as identity unique,
  ref                      text generated always as ('FO-' || lpad(order_no::text, 6, '0')) stored,
  business_id              uuid not null references public.businesses (id) on delete restrict,
  customer_id              uuid not null references public.customers (id) on delete restrict,
  order_date               date not null,
  expected_completion_date date,
  special_instructions     text check (special_instructions is null or length(special_instructions) <= 2000),
  status                   public.frame_order_status not null default 'new',
  total_amount             numeric(14, 2) not null default 0 check (total_amount >= 0),
  ready_at                 timestamptz,
  delivered_on             date,
  closed_at                timestamptz,
  cancelled_at             timestamptz,
  cancel_reason            text check (cancel_reason is null or length(cancel_reason) <= 500),
  client_request_id        uuid unique,
  created_by               uuid default auth.uid() references auth.users (id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint frame_orders_dates check (expected_completion_date is null or expected_completion_date >= order_date)
);
create index frame_orders_status_idx   on public.frame_orders (status);
create index frame_orders_customer_idx on public.frame_orders (customer_id);
create index frame_orders_date_idx     on public.frame_orders (order_date);

create table public.frame_order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.frame_orders (id) on delete cascade,
  frame_type  text not null check (length(btrim(frame_type)) between 1 and 120),
  frame_size  text not null check (length(btrim(frame_size)) between 1 and 60),
  description text check (description is null or length(description) <= 500),
  quantity    int not null check (quantity between 1 and 10000),
  unit_price  numeric(14, 2) not null check (unit_price >= 0),
  line_total  numeric(14, 2) generated always as (quantity * unit_price) stored,
  sort_order  smallint not null default 0,
  created_at  timestamptz not null default now()
);
create index frame_order_items_order_idx on public.frame_order_items (order_id);

-- -----------------------------------------------------------------------------
-- RV Camera Rent
-- -----------------------------------------------------------------------------
create table public.camera_equipment (
  id                   uuid primary key default gen_random_uuid(),
  asset_no             bigint generated always as identity unique,
  ref                  text generated always as ('EQ-' || lpad(asset_no::text, 4, '0')) stored,
  name                 text not null check (length(btrim(name)) between 1 and 120),
  category             text not null default 'Camera' check (length(btrim(category)) between 1 and 60),
  brand                text check (brand is null or length(brand) <= 60),
  model                text check (model is null or length(model) <= 60),
  serial_number        text not null unique check (length(btrim(serial_number)) between 1 and 80),
  daily_rate           numeric(14, 2) not null check (daily_rate >= 0),
  default_deposit      numeric(14, 2) not null default 0 check (default_deposit >= 0),
  included_accessories text check (included_accessories is null or length(included_accessories) <= 500),
  status               public.equipment_status not null default 'available',
  condition_notes      text check (condition_notes is null or length(condition_notes) <= 1000),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table public.camera_rentals (
  id                 uuid primary key default gen_random_uuid(),
  rental_no          bigint generated always as identity unique,
  ref                text generated always as ('CR-' || lpad(rental_no::text, 6, '0')) stored,
  business_id        uuid not null references public.businesses (id) on delete restrict,
  customer_id        uuid not null references public.customers (id) on delete restrict,
  booking_date       date not null,
  pickup_at          timestamptz not null,
  expected_return_at timestamptz not null,
  actual_pickup_at   timestamptz,
  actual_return_at   timestamptz,
  rental_days        int not null default 1 check (rental_days between 1 and 365),
  rental_charge      numeric(14, 2) not null default 0 check (rental_charge >= 0),
  late_fee           numeric(14, 2) not null default 0 check (late_fee >= 0),
  damage_charge      numeric(14, 2) not null default 0 check (damage_charge >= 0),
  other_charges      numeric(14, 2) not null default 0 check (other_charges >= 0),
  deposit_required   numeric(14, 2) not null default 0 check (deposit_required >= 0),
  status             public.camera_rental_status not null default 'booked',
  equipment_returned boolean not null default false,
  -- not_held: no original ID kept · held: original ID kept by the shop · returned: given back
  id_status          text not null default 'not_held' check (id_status in ('not_held', 'held', 'returned')),
  notes              text check (notes is null or length(notes) <= 2000),
  return_notes       text check (return_notes is null or length(return_notes) <= 2000),
  closed_at          timestamptz,
  cancelled_at       timestamptz,
  cancel_reason      text check (cancel_reason is null or length(cancel_reason) <= 500),
  client_request_id  uuid unique,
  created_by         uuid default auth.uid() references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint camera_rentals_period check (expected_return_at > pickup_at),
  constraint camera_rentals_return_after_pickup check (actual_return_at is null or actual_pickup_at is null or actual_return_at >= actual_pickup_at)
);
create index camera_rentals_status_idx   on public.camera_rentals (status);
create index camera_rentals_customer_idx on public.camera_rentals (customer_id);
create index camera_rentals_return_idx   on public.camera_rentals (expected_return_at);
create index camera_rentals_pickup_idx   on public.camera_rentals (pickup_at);

create table public.camera_rental_items (
  id                  uuid primary key default gen_random_uuid(),
  rental_id           uuid not null references public.camera_rentals (id) on delete cascade,
  equipment_id        uuid not null references public.camera_equipment (id) on delete restrict,
  daily_rate          numeric(14, 2) not null check (daily_rate >= 0),
  accessories_out     text check (accessories_out is null or length(accessories_out) <= 500),
  accessories_in      text check (accessories_in is null or length(accessories_in) <= 500),
  returned_at         timestamptz,
  -- Maintained from the parent rental by trigger; drives double-booking prevention.
  period              tstzrange not null,
  is_blocking         boolean not null default true,
  created_at          timestamptz not null default now(),
  constraint camera_rental_items_unique unique (rental_id, equipment_id),
  -- The same piece of equipment can't be in two active rentals that overlap in time.
  constraint camera_rental_items_no_overlap exclude using gist (equipment_id with =, period with &&) where (is_blocking)
);
create index camera_rental_items_equipment_idx on public.camera_rental_items (equipment_id);

create table public.camera_condition_checks (
  id           uuid primary key default gen_random_uuid(),
  rental_id    uuid not null references public.camera_rentals (id) on delete cascade,
  equipment_id uuid not null references public.camera_equipment (id) on delete restrict,
  stage        text not null check (stage in ('pickup', 'return')),
  condition    text not null check (condition in ('excellent', 'good', 'fair', 'damaged')),
  accessories  text check (accessories is null or length(accessories) <= 500),
  notes        text check (notes is null or length(notes) <= 1000),
  checked_at   timestamptz not null default now(),
  created_by   uuid default auth.uid() references auth.users (id) on delete set null
);
create index camera_condition_checks_rental_idx on public.camera_condition_checks (rental_id);

-- Identity verification. Data minimisation: only the ID type and the last
-- 4 characters are stored — never full numbers or document images.
create table public.camera_rental_id_handover_records (
  id                 uuid primary key default gen_random_uuid(),
  rental_id          uuid not null unique references public.camera_rentals (id) on delete cascade,
  id_type            text not null check (id_type in ('nic', 'passport', 'driving_licence', 'other')),
  id_last4           text check (id_last4 is null or id_last4 ~ '^[A-Za-z0-9]{2,4}$'),
  verified           boolean not null default false,
  verification_notes text check (verification_notes is null or length(verification_notes) <= 500),
  original_held      boolean not null default false,
  received_at        timestamptz,
  returned_at        timestamptz,
  return_note        text check (return_note is null or length(return_note) <= 500),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint id_handover_return_requires_held check (returned_at is null or original_held),
  constraint id_handover_received check (not original_held or received_at is not null)
);

-- -----------------------------------------------------------------------------
-- Gift Park
-- -----------------------------------------------------------------------------
create table public.gift_products (
  id             uuid primary key default gen_random_uuid(),
  sku            text unique check (sku is null or length(btrim(sku)) between 1 and 40),
  name           text not null check (length(btrim(name)) between 1 and 120),
  description    text check (description is null or length(description) <= 1000),
  unit_price     numeric(14, 2) not null check (unit_price >= 0),
  cost_price     numeric(14, 2) check (cost_price is null or cost_price >= 0),
  track_stock    boolean not null default true,
  stock_quantity int not null default 0,
  reorder_level  int not null default 0 check (reorder_level >= 0),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint gift_products_stock_non_negative check (not track_stock or stock_quantity >= 0)
);

create table public.gift_orders (
  id                     uuid primary key default gen_random_uuid(),
  order_no               bigint generated always as identity unique,
  ref                    text generated always as ('GO-' || lpad(order_no::text, 6, '0')) stored,
  business_id            uuid not null references public.businesses (id) on delete restrict,
  customer_id            uuid references public.customers (id) on delete restrict, -- null = walk-in
  order_date             date not null,
  expected_delivery_date date,
  delivery_charge        numeric(14, 2) not null default 0 check (delivery_charge >= 0),
  subtotal               numeric(14, 2) not null default 0 check (subtotal >= 0),
  total_amount           numeric(14, 2) generated always as (subtotal + delivery_charge) stored,
  status                 public.gift_order_status not null default 'new',
  notes                  text check (notes is null or length(notes) <= 2000),
  stock_deducted         boolean not null default false,
  delivered_on           date,
  completed_at           timestamptz,
  cancelled_at           timestamptz,
  cancel_reason          text check (cancel_reason is null or length(cancel_reason) <= 500),
  client_request_id      uuid unique,
  created_by             uuid default auth.uid() references auth.users (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint gift_orders_dates check (expected_delivery_date is null or expected_delivery_date >= order_date)
);
create index gift_orders_status_idx   on public.gift_orders (status);
create index gift_orders_customer_idx on public.gift_orders (customer_id);
create index gift_orders_date_idx     on public.gift_orders (order_date);

create table public.gift_order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.gift_orders (id) on delete cascade,
  product_id   uuid references public.gift_products (id) on delete restrict, -- null = custom item
  product_name text not null check (length(btrim(product_name)) between 1 and 120),
  quantity     int not null check (quantity between 1 and 10000),
  unit_price   numeric(14, 2) not null check (unit_price >= 0),
  line_total   numeric(14, 2) generated always as (quantity * unit_price) stored,
  sort_order   smallint not null default 0,
  created_at   timestamptz not null default now()
);
create index gift_order_items_order_idx   on public.gift_order_items (order_id);
create index gift_order_items_product_idx on public.gift_order_items (product_id);

-- Append-only stock ledger; gift_products.stock_quantity is derived from it.
create table public.inventory_movements (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.gift_products (id) on delete restrict,
  quantity      int not null check (quantity <> 0),
  reason        text not null check (reason in ('purchase', 'sale', 'sale_reversal', 'adjustment', 'return', 'damage')),
  gift_order_id uuid references public.gift_orders (id) on delete restrict,
  unit_cost     numeric(14, 2) check (unit_cost is null or unit_cost >= 0),
  note          text check (note is null or length(note) <= 500),
  moved_at      timestamptz not null default now(),
  created_by    uuid default auth.uid() references auth.users (id) on delete set null
);
create index inventory_movements_product_idx on public.inventory_movements (product_id, moved_at desc);
create index inventory_movements_order_idx   on public.inventory_movements (gift_order_id);

-- -----------------------------------------------------------------------------
-- Maintenance triggers
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['system_settings', 'customers', 'studio_packages', 'studio_resources', 'studio_bookings',
                           'frame_orders', 'camera_equipment', 'camera_rentals', 'camera_rental_id_handover_records',
                           'gift_products', 'gift_orders']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function private.set_updated_at()',
                   t || '_set_updated_at', t);
  end loop;
end $$;

-- Assigns the owning business and forces creator on insert.
create or replace function private.assign_document_business()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_slug text := tg_argv[0];
begin
  if tg_op = 'INSERT' then
    new.business_id := private.business_id_for(v_slug);
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
  else
    new.business_id := old.business_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create trigger studio_bookings_business before insert or update on public.studio_bookings
  for each row execute function private.assign_document_business('studio-of-rv');
create trigger frame_orders_business before insert or update on public.frame_orders
  for each row execute function private.assign_document_business('the-frame-house');
create trigger camera_rentals_business before insert or update on public.camera_rentals
  for each row execute function private.assign_document_business('rv-camera-rent');
create trigger gift_orders_business before insert or update on public.gift_orders
  for each row execute function private.assign_document_business('gift-park');

-- Studio: compute the shoot window in Asia/Colombo for overlap checks.
create or replace function private.studio_booking_period()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.shoot_period := tstzrange(
    (new.shoot_date + new.start_time) at time zone 'Asia/Colombo',
    (new.shoot_date + new.end_time) at time zone 'Asia/Colombo',
    '[)');
  return new;
end;
$$;
create trigger studio_bookings_period before insert or update of shoot_date, start_time, end_time on public.studio_bookings
  for each row execute function private.studio_booking_period();

-- Frame / gift: keep order totals in sync with their items.
create or replace function private.refresh_order_total()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_order uuid := coalesce(new.order_id, old.order_id);
begin
  if tg_table_name = 'frame_order_items' then
    update public.frame_orders o
       set total_amount = coalesce((select sum(line_total) from public.frame_order_items i where i.order_id = v_order), 0)
     where o.id = v_order;
  else
    update public.gift_orders o
       set subtotal = coalesce((select sum(line_total) from public.gift_order_items i where i.order_id = v_order), 0)
     where o.id = v_order;
  end if;
  return null;
end;
$$;
create trigger frame_order_items_total after insert or update or delete on public.frame_order_items
  for each row execute function private.refresh_order_total();
create trigger gift_order_items_total after insert or update or delete on public.gift_order_items
  for each row execute function private.refresh_order_total();

-- Camera: rental days from the booked window (part days round up, minimum 1).
create or replace function private.camera_rental_days(p_from timestamptz, p_to timestamptz) returns int
language sql immutable set search_path = '' as $$
  select greatest(1, ceil(extract(epoch from (p_to - p_from)) / 86400.0)::int);
$$;

create or replace function private.camera_rental_before()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.rental_days := private.camera_rental_days(new.pickup_at, new.expected_return_at);
  return new;
end;
$$;
create trigger camera_rentals_days before insert or update of pickup_at, expected_return_at on public.camera_rentals
  for each row execute function private.camera_rental_before();

-- Item rows mirror the rental window and whether they still block the equipment.
create or replace function private.camera_item_window()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  select pickup_at, expected_return_at, actual_return_at, status into r
  from public.camera_rentals where id = new.rental_id;
  new.period := tstzrange(r.pickup_at, greatest(r.expected_return_at, coalesce(r.actual_return_at, r.expected_return_at)), '[)');
  new.is_blocking := r.status in ('booked', 'ready_for_pickup', 'rented_out') and new.returned_at is null;
  return new;
end;
$$;
create trigger camera_rental_items_window before insert or update on public.camera_rental_items
  for each row execute function private.camera_item_window();

-- When a rental's dates/status change, re-evaluate its items (re-runs the overlap check)
-- and recompute the base rental charge from the item rates.
create or replace function private.camera_rental_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.pickup_at, new.expected_return_at, new.actual_return_at, new.status)
                          is not distinct from (old.pickup_at, old.expected_return_at, old.actual_return_at, old.status) then
    return null;
  end if;
  update public.camera_rental_items set rental_id = rental_id where rental_id = new.id;
  return null;
end;
$$;
create trigger camera_rentals_items_sync after update on public.camera_rentals
  for each row execute function private.camera_rental_after();

create or replace function private.camera_rental_charge(p_rental uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(i.daily_rate), 0) * r.rental_days
  from public.camera_rentals r
  left join public.camera_rental_items i on i.rental_id = r.id
  where r.id = p_rental
  group by r.rental_days;
$$;

-- Gift Park: stock derived from the movement ledger.
create or replace function private.apply_inventory_movement()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.gift_products set stock_quantity = stock_quantity + new.quantity where id = new.product_id;
  return null;
exception when check_violation then
  raise exception 'Insufficient stock for this product' using errcode = 'check_violation';
end;
$$;
create trigger inventory_movements_apply after insert on public.inventory_movements
  for each row execute function private.apply_inventory_movement();

create or replace function private.forbid_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '% records are append-only', tg_table_name using errcode = '42501';
end;
$$;
create trigger inventory_movements_immutable before update or delete on public.inventory_movements
  for each row execute function private.forbid_change();

-- Default categories for the new expense types (shared categories already exist).
insert into public.transaction_categories (name, type, business_id, sort_order)
select v.name, 'expense', private.business_id_for(v.slug), v.sort_order
from (values
  ('Vehicle Rental',            'studio-of-rv',    10),
  ('Camera Equipment Rental',   'studio-of-rv',    11),
  ('Photographer Payments',     'studio-of-rv',    12),
  ('Assistant Payments',        'studio-of-rv',    13),
  ('Location Charges',          'studio-of-rv',    14),
  ('Food and Refreshments',     'studio-of-rv',    15),
  ('Frame Material Cost',       'the-frame-house', 10),
  ('Printing Cost',             'the-frame-house', 11),
  ('Labour Cost',               'the-frame-house', 12),
  ('Packaging',                 'the-frame-house', 13),
  ('Product Purchases',         'gift-park',       10),
  ('Equipment Repairs',         'rv-camera-rent',  10)
) as v(name, slug, sort_order)
where private.business_id_for(v.slug) is not null
on conflict do nothing;

insert into public.transaction_categories (name, type, business_id, sort_order)
select v.name, 'income', null, v.sort_order
from (values ('Direct Sale', 6), ('Service Charges', 7)) as v(name, sort_order)
where not exists (select 1 from public.transaction_categories c where lower(c.name) = lower(v.name) and c.type = 'income');
