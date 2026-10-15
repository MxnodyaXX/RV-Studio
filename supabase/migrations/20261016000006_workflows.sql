-- =============================================================================
-- RV BUSINESS HUB — workflow rules and admin RPCs
--
-- Status changes are validated by triggers, so the rules hold no matter how a
-- row is updated:
--   * Studio booking is confirmed only after the required advance is paid.
--   * A frame order is delivered only after full payment.
--   * A camera rental closes only when equipment is back, the balance is paid,
--     the deposit is settled and any held ID is returned.
--   * Gift orders follow the configurable delivery rule in system_settings.
-- Write RPCs are SECURITY DEFINER and begin with private.require_admin().
-- =============================================================================

-- -----------------------------------------------------------------------------
-- JSON input helpers
-- -----------------------------------------------------------------------------
create or replace function private.j_text(p jsonb, k text, max_len int default 500, required boolean default false)
returns text language plpgsql immutable set search_path = '' as $$
declare v text := nullif(btrim(p ->> k), '');
begin
  if v is null and required then raise exception '% is required', k using errcode = '22023'; end if;
  if v is not null and length(v) > max_len then raise exception '% is too long', k using errcode = '22023'; end if;
  return v;
end;
$$;

create or replace function private.j_money(p jsonb, k text, required boolean default true, default_value numeric default 0)
returns numeric language plpgsql immutable set search_path = '' as $$
declare v text := nullif(btrim(p ->> k), '');
begin
  if v is null then
    if required then raise exception '% is required', k using errcode = '22023'; end if;
    return default_value;
  end if;
  if v !~ '^\d{1,12}(\.\d{1,2})?$' then
    raise exception 'Invalid amount for %', k using errcode = '22023';
  end if;
  return v::numeric(14, 2);
end;
$$;

create or replace function private.j_uuid(p jsonb, k text, required boolean default false)
returns uuid language plpgsql immutable set search_path = '' as $$
declare v text := nullif(btrim(p ->> k), '');
begin
  if v is null then
    if required then raise exception '% is required', k using errcode = '22023'; end if;
    return null;
  end if;
  return v::uuid;
exception when invalid_text_representation then
  raise exception 'Invalid identifier for %', k using errcode = '22023';
end;
$$;

-- -----------------------------------------------------------------------------
-- Status machines
-- -----------------------------------------------------------------------------
create or replace function private.assert_transition(p_kind text, p_from text, p_to text)
returns void language plpgsql immutable set search_path = '' as $$
declare
  allowed text[];
begin
  allowed := case p_kind || ':' || p_from
    when 'studio:pending_advance'   then array['confirmed', 'cancelled']
    when 'studio:confirmed'         then array['in_progress', 'shoot_completed', 'cancelled']
    when 'studio:in_progress'       then array['shoot_completed']
    when 'studio:shoot_completed'   then array['closed']
    when 'frame:new'                then array['processing', 'ready', 'cancelled']
    when 'frame:processing'         then array['new', 'ready', 'cancelled']
    when 'frame:ready'              then array['processing', 'delivered', 'cancelled']
    when 'frame:delivered'          then array['closed']
    when 'camera:booked'            then array['ready_for_pickup', 'rented_out', 'cancelled']
    when 'camera:ready_for_pickup'  then array['booked', 'rented_out', 'cancelled']
    when 'camera:rented_out'        then array['returned']
    when 'camera:returned'          then array['closed']
    when 'gift:new'                 then array['processing', 'ready', 'delivered', 'cancelled']
    when 'gift:processing'          then array['new', 'ready', 'delivered', 'cancelled']
    when 'gift:ready'               then array['processing', 'delivered', 'cancelled']
    when 'gift:delivered'           then array['completed']
    else array[]::text[]
  end;
  if not (p_to = any (allowed)) then
    raise exception 'Cannot change status from % to %', replace(p_from, '_', ' '), replace(p_to, '_', ' ')
      using errcode = 'check_violation';
  end if;
end;
$$;

create or replace function private.studio_booking_status_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare b record;
begin
  if new.status = old.status then
    if old.status in ('closed', 'cancelled')
       and private.row_changed(to_jsonb(new), to_jsonb(old), array['notes', 'updated_at']) then
      raise exception 'Closed or cancelled bookings cannot be edited' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  perform private.assert_transition('studio', old.status::text, new.status::text);
  select * into b from private.balance_of(new.id);

  case new.status
    when 'confirmed' then
      if b.net_paid <= 0 or b.net_paid < new.required_advance then
        raise exception 'Record the advance payment (at least Rs. %) before confirming the booking', new.required_advance
          using errcode = 'check_violation';
      end if;
      new.confirmed_at := now();
    when 'in_progress' then
      new.started_at := now();
    when 'shoot_completed' then
      new.started_at := coalesce(new.started_at, now());
      new.completed_on := coalesce(new.completed_on, private.today());
    when 'closed' then
      if b.outstanding > 0 then
        raise exception 'The booking can only be closed when it is fully paid (Rs. % outstanding)', b.outstanding
          using errcode = 'check_violation';
      end if;
      new.closed_at := now();
    when 'cancelled' then
      if b.outstanding <> 0 then
        raise exception 'Use the cancel action to settle the balance before cancelling' using errcode = 'check_violation';
      end if;
      new.cancelled_at := now();
    else null;
  end case;
  return new;
end;
$$;
create trigger studio_bookings_status_guard before update on public.studio_bookings
  for each row execute function private.studio_booking_status_guard();

create or replace function private.frame_order_status_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare b record;
begin
  if new.status = old.status then
    if old.status in ('delivered', 'closed', 'cancelled')
       and private.row_changed(to_jsonb(new), to_jsonb(old), array['special_instructions', 'updated_at', 'total_amount']) then
      raise exception 'Delivered, closed or cancelled orders cannot be edited' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  perform private.assert_transition('frame', old.status::text, new.status::text);
  select * into b from private.balance_of(new.id);

  case new.status
    when 'ready' then new.ready_at := now();
    when 'delivered' then
      if b.outstanding > 0 then
        raise exception 'Full payment is required before the frame is delivered (Rs. % outstanding)', b.outstanding
          using errcode = 'check_violation';
      end if;
      new.delivered_on := coalesce(new.delivered_on, private.today());
    when 'closed' then
      if b.outstanding > 0 then
        raise exception 'The order has an outstanding balance of Rs. %', b.outstanding using errcode = 'check_violation';
      end if;
      new.closed_at := now();
    when 'cancelled' then
      if b.outstanding <> 0 then
        raise exception 'Use the cancel action to settle the balance before cancelling' using errcode = 'check_violation';
      end if;
      new.cancelled_at := now();
    else null;
  end case;
  return new;
end;
$$;
create trigger frame_orders_status_guard before update on public.frame_orders
  for each row execute function private.frame_order_status_guard();

create or replace function private.camera_rental_status_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare b record;
begin
  if new.status = old.status then
    if old.status in ('closed', 'cancelled')
       and private.row_changed(to_jsonb(new), to_jsonb(old), array['notes', 'updated_at']) then
      raise exception 'Closed or cancelled rentals cannot be edited' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  perform private.assert_transition('camera', old.status::text, new.status::text);
  select * into b from private.balance_of(new.id);

  case new.status
    when 'rented_out' then
      if not exists (select 1 from public.camera_rental_id_handover_records h where h.rental_id = new.id and h.verified) then
        raise exception 'Verify the customer''s identity before handing over equipment' using errcode = 'check_violation';
      end if;
      new.actual_pickup_at := coalesce(new.actual_pickup_at, now());
    when 'returned' then
      new.actual_return_at := coalesce(new.actual_return_at, now());
      new.equipment_returned := true;
    when 'closed' then
      if not new.equipment_returned then
        raise exception 'All equipment must be returned before closing' using errcode = 'check_violation';
      end if;
      if b.outstanding > 0 then
        raise exception 'The rental balance must be paid before closing (Rs. % outstanding)', b.outstanding using errcode = 'check_violation';
      end if;
      if b.deposit_held <> 0 then
        raise exception 'Settle the security deposit (Rs. % held) before closing', b.deposit_held using errcode = 'check_violation';
      end if;
      if new.id_status = 'held' then
        raise exception 'Return the customer''s ID before closing' using errcode = 'check_violation';
      end if;
      new.closed_at := now();
    when 'cancelled' then
      if b.outstanding <> 0 or b.deposit_held <> 0 then
        raise exception 'Use the cancel action to settle the balance and deposit before cancelling' using errcode = 'check_violation';
      end if;
      if new.id_status = 'held' then
        raise exception 'Return the customer''s ID before cancelling' using errcode = 'check_violation';
      end if;
      new.cancelled_at := now();
    else null;
  end case;
  return new;
end;
$$;
create trigger camera_rentals_status_guard before update on public.camera_rentals
  for each row execute function private.camera_rental_status_guard();

create or replace function private.gift_order_status_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  b record;
  v_require_full boolean;
begin
  if new.status = old.status then
    if old.status in ('completed', 'cancelled')
       and private.row_changed(to_jsonb(new), to_jsonb(old), array['notes', 'updated_at', 'stock_deducted']) then
      raise exception 'Completed or cancelled orders cannot be edited' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  perform private.assert_transition('gift', old.status::text, new.status::text);
  select * into b from private.balance_of(new.id);
  select gift_require_full_payment_before_delivery into v_require_full from public.system_settings limit 1;

  case new.status
    when 'delivered' then
      if coalesce(v_require_full, true) and b.outstanding > 0 then
        raise exception 'Full payment is required before delivery (Rs. % outstanding)', b.outstanding using errcode = 'check_violation';
      end if;
      new.delivered_on := coalesce(new.delivered_on, private.today());
    when 'completed' then
      if b.outstanding > 0 then
        raise exception 'The order has an outstanding balance of Rs. %', b.outstanding using errcode = 'check_violation';
      end if;
      new.completed_at := now();
    when 'cancelled' then
      if b.outstanding <> 0 then
        raise exception 'Use the cancel action to settle the balance before cancelling' using errcode = 'check_violation';
      end if;
      new.cancelled_at := now();
    else null;
  end case;
  return new;
end;
$$;
create trigger gift_orders_status_guard before update on public.gift_orders
  for each row execute function private.gift_order_status_guard();

-- Item lists can only change while an order is still open.
create or replace function private.order_items_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  if tg_table_name = 'frame_order_items' then
    select status::text into v_status from public.frame_orders where id = coalesce(new.order_id, old.order_id);
    if v_status not in ('new', 'processing', 'ready') then
      raise exception 'Items can only be changed before delivery' using errcode = 'check_violation';
    end if;
  elsif tg_table_name = 'gift_order_items' then
    select status::text into v_status from public.gift_orders where id = coalesce(new.order_id, old.order_id);
    if v_status not in ('new', 'processing', 'ready') then
      raise exception 'Items can only be changed before delivery' using errcode = 'check_violation';
    end if;
  else
    select status::text into v_status from public.camera_rentals where id = coalesce(new.rental_id, old.rental_id);
    if tg_op <> 'UPDATE' and v_status not in ('booked', 'ready_for_pickup') then
      raise exception 'Equipment can only be changed before pickup' using errcode = 'check_violation';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
create trigger frame_order_items_guard before insert or update or delete on public.frame_order_items
  for each row execute function private.order_items_guard();
create trigger gift_order_items_guard before insert or update or delete on public.gift_order_items
  for each row execute function private.order_items_guard();
create trigger camera_rental_items_guard before insert or delete on public.camera_rental_items
  for each row execute function private.order_items_guard();

-- -----------------------------------------------------------------------------
-- Gift Park stock: reconcile the movement ledger with the order (idempotent)
-- -----------------------------------------------------------------------------
create or replace function private.sync_gift_stock(p_order uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  o record;
  v_mode text;
  v_should boolean;
  r record;
begin
  select * into o from public.gift_orders where id = p_order;
  select gift_stock_deduction into v_mode from public.system_settings limit 1;
  v_should := o.status <> 'cancelled' and (coalesce(v_mode, 'on_order') = 'on_order' or o.status in ('delivered', 'completed'));

  for r in
    with wanted as (
      select i.product_id, sum(i.quantity)::int as qty
      from public.gift_order_items i join public.gift_products gp on gp.id = i.product_id and gp.track_stock
      where i.order_id = p_order and v_should
      group by i.product_id
    ), done as (
      select m.product_id, -sum(m.quantity)::int as qty
      from public.inventory_movements m
      where m.gift_order_id = p_order and m.reason in ('sale', 'sale_reversal')
      group by m.product_id
    )
    select coalesce(w.product_id, d.product_id) as product_id, coalesce(w.qty, 0) - coalesce(d.qty, 0) as delta
    from wanted w full join done d on d.product_id = w.product_id
  loop
    if r.delta <> 0 then
      insert into public.inventory_movements (product_id, quantity, reason, gift_order_id, note)
      values (r.product_id, -r.delta, case when r.delta > 0 then 'sale' else 'sale_reversal' end, p_order, o.ref);
    end if;
  end loop;

  update public.gift_orders set stock_deducted = v_should where id = p_order and stock_deducted is distinct from v_should;
end;
$$;

create or replace function private.gift_order_stock_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    perform private.sync_gift_stock(new.id);
  end if;
  return null;
end;
$$;
create trigger gift_orders_stock after update of status on public.gift_orders
  for each row execute function private.gift_order_stock_after();

-- -----------------------------------------------------------------------------
-- Save (create/update) documents
-- -----------------------------------------------------------------------------
create or replace function public.save_studio_booking(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_req uuid;
  v_price numeric;
  v_extra numeric;
  v_advance numeric;
  v_pct numeric;
begin
  perform private.require_admin();
  v_id := private.j_uuid(p, 'id');
  v_req := private.j_uuid(p, 'client_request_id');
  v_price := private.j_money(p, 'package_price');
  v_extra := private.j_money(p, 'additional_charges', false, 0);

  if v_id is null and v_req is not null then
    select id into v_id from public.studio_bookings where client_request_id = v_req;
    if found then return v_id; end if;
  end if;

  if nullif(p ->> 'required_advance', '') is null then
    select default_advance_percent into v_pct from public.system_settings limit 1;
    v_advance := round((v_price + v_extra) * coalesce(v_pct, 0) / 100, 2);
  else
    v_advance := private.j_money(p, 'required_advance');
  end if;

  if v_id is null then
    insert into public.studio_bookings (customer_id, package_id, package_name, package_description, shoot_date, start_time,
      end_time, location, resource_id, package_price, additional_charges, additional_charges_note, required_advance, notes,
      client_request_id)
    values (private.j_uuid(p, 'customer_id', true), private.j_uuid(p, 'package_id'), private.j_text(p, 'package_name', 120, true),
      private.j_text(p, 'package_description', 1000), (p ->> 'shoot_date')::date, (p ->> 'start_time')::time,
      (p ->> 'end_time')::time, private.j_text(p, 'location', 200, true), private.j_uuid(p, 'resource_id'),
      v_price, v_extra, private.j_text(p, 'additional_charges_note', 300), v_advance, private.j_text(p, 'notes', 2000), v_req)
    returning id into v_id;
  else
    update public.studio_bookings set
      customer_id = private.j_uuid(p, 'customer_id', true), package_id = private.j_uuid(p, 'package_id'),
      package_name = private.j_text(p, 'package_name', 120, true), package_description = private.j_text(p, 'package_description', 1000),
      shoot_date = (p ->> 'shoot_date')::date, start_time = (p ->> 'start_time')::time, end_time = (p ->> 'end_time')::time,
      location = private.j_text(p, 'location', 200, true), resource_id = private.j_uuid(p, 'resource_id'),
      package_price = v_price, additional_charges = v_extra, additional_charges_note = private.j_text(p, 'additional_charges_note', 300),
      required_advance = v_advance, notes = private.j_text(p, 'notes', 2000)
    where id = v_id;
    if not found then raise exception 'Booking not found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
exception
  when exclusion_violation then
    raise exception 'The assigned photographer/resource is already booked at that time' using errcode = '23P01';
end;
$$;

create or replace function public.save_frame_order(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_req uuid;
  v_item jsonb;
  v_i int := 0;
begin
  perform private.require_admin();
  v_id := private.j_uuid(p, 'id');
  v_req := private.j_uuid(p, 'client_request_id');
  if jsonb_typeof(p -> 'items') <> 'array' or jsonb_array_length(p -> 'items') = 0 then
    raise exception 'Add at least one frame to the order' using errcode = '22023';
  end if;

  if v_id is null and v_req is not null then
    select id into v_id from public.frame_orders where client_request_id = v_req;
    if found then return v_id; end if;
  end if;

  if v_id is null then
    insert into public.frame_orders (customer_id, order_date, expected_completion_date, special_instructions, client_request_id)
    values (private.j_uuid(p, 'customer_id', true), coalesce((p ->> 'order_date')::date, private.today()),
            nullif(p ->> 'expected_completion_date', '')::date, private.j_text(p, 'special_instructions', 2000), v_req)
    returning id into v_id;
  else
    update public.frame_orders set customer_id = private.j_uuid(p, 'customer_id', true),
      order_date = coalesce((p ->> 'order_date')::date, order_date),
      expected_completion_date = nullif(p ->> 'expected_completion_date', '')::date,
      special_instructions = private.j_text(p, 'special_instructions', 2000)
    where id = v_id;
    if not found then raise exception 'Order not found' using errcode = 'P0002'; end if;
    delete from public.frame_order_items where order_id = v_id;
  end if;

  for v_item in select * from jsonb_array_elements(p -> 'items') loop
    insert into public.frame_order_items (order_id, frame_type, frame_size, description, quantity, unit_price, sort_order)
    values (v_id, private.j_text(v_item, 'frame_type', 120, true), private.j_text(v_item, 'frame_size', 60, true),
            private.j_text(v_item, 'description', 500), (v_item ->> 'quantity')::int, private.j_money(v_item, 'unit_price'), v_i);
    v_i := v_i + 1;
  end loop;
  return v_id;
end;
$$;

create or replace function public.save_camera_rental(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_req uuid;
  v_status text;
  v_item jsonb;
  v_equipment record;
  v_conflict text;
begin
  perform private.require_admin();
  v_id := private.j_uuid(p, 'id');
  v_req := private.j_uuid(p, 'client_request_id');
  if jsonb_typeof(p -> 'items') <> 'array' or jsonb_array_length(p -> 'items') = 0 then
    raise exception 'Select at least one piece of equipment' using errcode = '22023';
  end if;

  if v_id is null and v_req is not null then
    select id into v_id from public.camera_rentals where client_request_id = v_req;
    if found then return v_id; end if;
  end if;

  if v_id is null then
    insert into public.camera_rentals (customer_id, booking_date, pickup_at, expected_return_at, deposit_required, notes, client_request_id)
    values (private.j_uuid(p, 'customer_id', true), coalesce((p ->> 'booking_date')::date, private.today()),
            (p ->> 'pickup_at')::timestamptz, (p ->> 'expected_return_at')::timestamptz,
            private.j_money(p, 'deposit_required', false, 0), private.j_text(p, 'notes', 2000), v_req)
    returning id, status::text into v_id, v_status;
  else
    select status::text into v_status from public.camera_rentals where id = v_id;
    if v_status is null then raise exception 'Rental not found' using errcode = 'P0002'; end if;
    if v_status not in ('booked', 'ready_for_pickup', 'rented_out') then
      raise exception 'This rental can no longer be edited' using errcode = 'check_violation';
    end if;
    -- Changing dates re-checks every item for overlaps (via the item window trigger).
    begin
      if v_status = 'rented_out' then
        -- While equipment is out only the return time / notes may change (extension).
        update public.camera_rentals set expected_return_at = (p ->> 'expected_return_at')::timestamptz,
          notes = private.j_text(p, 'notes', 2000) where id = v_id;
      else
        update public.camera_rentals set customer_id = private.j_uuid(p, 'customer_id', true),
          pickup_at = (p ->> 'pickup_at')::timestamptz, expected_return_at = (p ->> 'expected_return_at')::timestamptz,
          deposit_required = private.j_money(p, 'deposit_required', false, 0), notes = private.j_text(p, 'notes', 2000)
        where id = v_id;
      end if;
    exception when exclusion_violation then
      raise exception 'Some of this equipment is already booked for the new dates' using errcode = '23P01';
    end;
    if v_status = 'rented_out' then
      update public.camera_rentals set rental_charge = private.camera_rental_charge(v_id) where id = v_id;
      return v_id;
    end if;
    delete from public.camera_rental_items i where i.rental_id = v_id
      and i.equipment_id not in (select private.j_uuid(x, 'equipment_id', true) from jsonb_array_elements(p -> 'items') x);
  end if;

  for v_item in select * from jsonb_array_elements(p -> 'items') loop
    select id, name, daily_rate, status into v_equipment
    from public.camera_equipment where id = private.j_uuid(v_item, 'equipment_id', true);
    if v_equipment.id is null then raise exception 'Equipment not found' using errcode = 'P0002'; end if;
    if v_equipment.status <> 'available' then
      raise exception '% is not available for rent (%)', v_equipment.name, v_equipment.status using errcode = 'check_violation';
    end if;
    begin
      insert into public.camera_rental_items (rental_id, equipment_id, daily_rate, accessories_out, period)
      values (v_id, v_equipment.id, v_equipment.daily_rate, private.j_text(v_item, 'accessories', 500), tstzrange(now(), now() + interval '1 second'))
      on conflict (rental_id, equipment_id) do update set accessories_out = excluded.accessories_out;
    exception when exclusion_violation then
      select r.ref into v_conflict from public.camera_rental_items i join public.camera_rentals r on r.id = i.rental_id
       where i.equipment_id = v_equipment.id and i.is_blocking and i.rental_id <> v_id
         and i.period && (select tstzrange(pickup_at, expected_return_at, '[)') from public.camera_rentals where id = v_id)
       limit 1;
      raise exception '% is already booked for overlapping dates (%)', v_equipment.name, coalesce(v_conflict, 'another rental')
        using errcode = '23P01';
    end;
  end loop;

  update public.camera_rentals set rental_charge = private.camera_rental_charge(v_id) where id = v_id;
  return v_id;
end;
$$;

create or replace function public.save_gift_order(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_req uuid;
  v_item jsonb;
  v_product record;
  v_i int := 0;
begin
  perform private.require_admin();
  v_id := private.j_uuid(p, 'id');
  v_req := private.j_uuid(p, 'client_request_id');
  if jsonb_typeof(p -> 'items') <> 'array' or jsonb_array_length(p -> 'items') = 0 then
    raise exception 'Add at least one product to the order' using errcode = '22023';
  end if;

  if v_id is null and v_req is not null then
    select id into v_id from public.gift_orders where client_request_id = v_req;
    if found then return v_id; end if;
  end if;

  if v_id is null then
    insert into public.gift_orders (customer_id, order_date, expected_delivery_date, delivery_charge, notes, client_request_id)
    values (private.j_uuid(p, 'customer_id'), coalesce((p ->> 'order_date')::date, private.today()),
            nullif(p ->> 'expected_delivery_date', '')::date, private.j_money(p, 'delivery_charge', false, 0),
            private.j_text(p, 'notes', 2000), v_req)
    returning id into v_id;
  else
    update public.gift_orders set customer_id = private.j_uuid(p, 'customer_id'),
      order_date = coalesce((p ->> 'order_date')::date, order_date),
      expected_delivery_date = nullif(p ->> 'expected_delivery_date', '')::date,
      delivery_charge = private.j_money(p, 'delivery_charge', false, 0), notes = private.j_text(p, 'notes', 2000)
    where id = v_id;
    if not found then raise exception 'Order not found' using errcode = 'P0002'; end if;
    delete from public.gift_order_items where order_id = v_id;
  end if;

  for v_item in select * from jsonb_array_elements(p -> 'items') loop
    v_product := null;
    if private.j_uuid(v_item, 'product_id') is not null then
      select id, name, unit_price, is_active into v_product from public.gift_products where id = private.j_uuid(v_item, 'product_id');
      if v_product.id is null then raise exception 'Product not found' using errcode = 'P0002'; end if;
    end if;
    insert into public.gift_order_items (order_id, product_id, product_name, quantity, unit_price, sort_order)
    values (v_id, v_product.id, coalesce(private.j_text(v_item, 'product_name', 120), v_product.name),
            (v_item ->> 'quantity')::int,
            case when nullif(v_item ->> 'unit_price', '') is null then v_product.unit_price else private.j_money(v_item, 'unit_price') end,
            v_i);
    v_i := v_i + 1;
  end loop;

  perform private.sync_gift_stock(v_id);
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Status changes and cancellation
-- -----------------------------------------------------------------------------
create or replace function public.set_document_status(p_source_type public.source_type, p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  if p_status = 'cancelled' then
    raise exception 'Use cancel_document to cancel' using errcode = '22023';
  end if;
  case p_source_type
    when 'studio_booking' then update public.studio_bookings set status = p_status::public.studio_booking_status where id = p_id;
    when 'frame_order'    then update public.frame_orders    set status = p_status::public.frame_order_status    where id = p_id;
    when 'camera_rental'  then update public.camera_rentals  set status = p_status::public.camera_rental_status  where id = p_id;
    when 'gift_order'     then update public.gift_orders     set status = p_status::public.gift_order_status     where id = p_id;
  end case;
  if not found then raise exception 'Record not found' using errcode = 'P0002'; end if;
exception
  when invalid_text_representation then
    raise exception 'Unknown status %', p_status using errcode = '22023';
  when exclusion_violation then
    raise exception 'The assigned photographer/resource is already booked at that time' using errcode = '23P01';
end;
$$;

-- Inserts the source foreign key for any ledger table row.
create or replace function private.source_columns(p_source_type public.source_type, p_id uuid,
  out studio_booking_id uuid, out frame_order_id uuid, out camera_rental_id uuid, out gift_order_id uuid)
language sql immutable set search_path = '' as $$
  select case when p_source_type = 'studio_booking' then p_id end,
         case when p_source_type = 'frame_order' then p_id end,
         case when p_source_type = 'camera_rental' then p_id end,
         case when p_source_type = 'gift_order' then p_id end;
$$;

-- Cancels a document: optional refund of charges, mandatory return of any held
-- deposit, and a 'cancellation' adjustment so the retained amount (if any) is
-- recognised as revenue and nothing remains outstanding.
create or replace function public.cancel_document(p_source_type public.source_type, p_id uuid, p_reason text,
  p_refund_amount numeric default 0, p_refund_method public.money_method default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  b record;
  s record;
  v_status text;
begin
  perform private.require_admin();
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'Enter a cancellation reason' using errcode = '22023';
  end if;

  select status into v_status from public.source_documents where source_id = p_id and source_type = p_source_type;
  if v_status is null then raise exception 'Record not found' using errcode = 'P0002'; end if;
  if v_status in ('closed', 'cancelled', 'completed', 'delivered', 'shoot_completed', 'returned', 'rented_out') then
    raise exception 'A % record cannot be cancelled', replace(v_status, '_', ' ') using errcode = 'check_violation';
  end if;

  s := private.source_columns(p_source_type, p_id);
  select * into b from private.balance_of(p_id);

  if coalesce(p_refund_amount, 0) > 0 then
    if p_refund_method is null or p_refund_method not in ('cash', 'card', 'bank_transfer') then
      raise exception 'Choose how the refund is paid' using errcode = '22023';
    end if;
    if p_refund_amount > b.net_paid then
      raise exception 'Refund (Rs. %) is more than the amount paid (Rs. %)', p_refund_amount, b.net_paid using errcode = 'check_violation';
    end if;
    insert into public.refunds (business_id, studio_booking_id, frame_order_id, camera_rental_id, gift_order_id, kind, amount, method, refunded_on, reason)
    values ((select business_id from public.source_documents where source_id = p_id), s.studio_booking_id, s.frame_order_id,
            s.camera_rental_id, s.gift_order_id, 'charge_refund', p_refund_amount, p_refund_method, private.today(),
            'Cancellation refund: ' || btrim(p_reason));
  end if;

  if b.deposit_held > 0 then
    if p_refund_method is null or p_refund_method not in ('cash', 'card', 'bank_transfer') then
      raise exception 'Choose how the held deposit (Rs. %) is returned', b.deposit_held using errcode = '22023';
    end if;
    insert into public.refunds (business_id, camera_rental_id, kind, amount, method, refunded_on, reason)
    values ((select business_id from public.source_documents where source_id = p_id), p_id, 'deposit_return', b.deposit_held,
            p_refund_method, private.today(), 'Deposit returned on cancellation');
  end if;

  select * into b from private.balance_of(p_id);
  if b.outstanding < 0 then
    raise exception 'Refund the overpaid amount (Rs. %) before cancelling', -b.outstanding using errcode = 'check_violation';
  end if;
  if b.outstanding > 0 then
    insert into public.financial_adjustments (business_id, studio_booking_id, frame_order_id, camera_rental_id, gift_order_id,
                                              kind, amount, effective_on, reason)
    values ((select business_id from public.source_documents where source_id = p_id), s.studio_booking_id, s.frame_order_id,
            s.camera_rental_id, s.gift_order_id, 'cancellation', -b.outstanding, private.today(), btrim(p_reason));
  end if;

  case p_source_type
    when 'studio_booking' then update public.studio_bookings set status = 'cancelled', cancel_reason = btrim(p_reason) where id = p_id;
    when 'frame_order'    then update public.frame_orders    set status = 'cancelled', cancel_reason = btrim(p_reason) where id = p_id;
    when 'camera_rental'  then update public.camera_rentals  set status = 'cancelled', cancel_reason = btrim(p_reason) where id = p_id;
    when 'gift_order'     then update public.gift_orders     set status = 'cancelled', cancel_reason = btrim(p_reason) where id = p_id;
  end case;
end;
$$;

-- -----------------------------------------------------------------------------
-- Money RPCs
-- -----------------------------------------------------------------------------
create or replace function public.record_payment(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_req uuid;
  v_source_type public.source_type;
  v_source_id uuid;
  v_purpose text;
  v_amount numeric;
  v_method public.money_method;
  v_paid_on date;
  v_existing record;
  v_doc record;
  v_booking record;
  b record;
  s record;
  v_id uuid;
  v_ref text;
  v_confirmed boolean := false;
begin
  perform private.require_admin();
  v_req := private.j_uuid(p, 'client_request_id');
  v_source_type := nullif(p ->> 'source_type', '')::public.source_type;
  v_source_id := private.j_uuid(p, 'source_id');
  v_purpose := coalesce(nullif(p ->> 'purpose', ''), 'charge');
  v_amount := private.j_money(p, 'amount');
  v_method := (p ->> 'method')::public.money_method;
  v_paid_on := coalesce(nullif(p ->> 'paid_on', '')::date, private.today());
  -- Defaults for entries not linked to a booking/order/rental.
  s := private.source_columns(null, null);
  select null::uuid as business_id, null::uuid as customer_id into v_doc;

  if v_req is not null then
    select id, ref into v_existing from public.payments where client_request_id = v_req;
    if found then return jsonb_build_object('id', v_existing.id, 'ref', v_existing.ref, 'duplicate', true, 'confirmed', false); end if;
  end if;

  if v_amount <= 0 then raise exception 'Amount must be greater than zero' using errcode = '22023'; end if;
  if v_method = 'other' then raise exception 'Choose cash, card or bank transfer' using errcode = '22023'; end if;
  if v_paid_on > private.today() then raise exception 'Payment date cannot be in the future' using errcode = '22023'; end if;
  if v_purpose not in ('charge', 'deposit') then raise exception 'Invalid payment purpose' using errcode = '22023'; end if;

  if (v_source_type is null) <> (v_source_id is null) then
    raise exception 'source_type and source_id must be given together' using errcode = '22023';
  end if;

  if v_source_id is not null then
    select * into v_doc from public.source_documents where source_id = v_source_id and source_type = v_source_type;
    if v_doc.source_id is null then raise exception 'Record not found' using errcode = 'P0002'; end if;
    if v_doc.is_closed then
      raise exception 'Payments cannot be recorded on a closed or cancelled record' using errcode = 'check_violation';
    end if;
    select * into b from private.balance_of(v_source_id);
    if v_purpose = 'charge' and v_amount > b.outstanding then
      raise exception 'Amount is more than the outstanding balance (Rs. %)', b.outstanding using errcode = 'check_violation';
    end if;
    if v_method = 'deposit' and v_amount > b.deposit_held then
      raise exception 'Only Rs. % of deposit is available to apply', b.deposit_held using errcode = 'check_violation';
    end if;
    s := private.source_columns(v_source_type, v_source_id);
  else
    if v_method = 'deposit' or v_purpose = 'deposit' then
      raise exception 'Deposits apply to camera rentals only' using errcode = '22023';
    end if;
  end if;

  insert into public.payments (business_id, customer_id, studio_booking_id, frame_order_id, camera_rental_id, gift_order_id,
                               purpose, category_id, amount, method, paid_on, reference, notes, client_request_id)
  values (coalesce(v_doc.business_id, private.j_uuid(p, 'business_id', true)),
          coalesce(v_doc.customer_id, private.j_uuid(p, 'customer_id')),
          s.studio_booking_id, s.frame_order_id, s.camera_rental_id, s.gift_order_id,
          v_purpose, case when v_source_id is null then private.j_uuid(p, 'category_id', true) end,
          v_amount, v_method, v_paid_on, private.j_text(p, 'reference', 200), private.j_text(p, 'notes', 1000), v_req)
  returning id, ref into v_id, v_ref;

  -- Studio: the advance confirms the booking and reserves the shoot date.
  if v_source_type = 'studio_booking' then
    select status, required_advance into v_booking from public.studio_bookings where id = v_source_id;
    select * into b from private.balance_of(v_source_id);
    if v_booking.status = 'pending_advance' and b.net_paid > 0 and b.net_paid >= v_booking.required_advance then
      begin
        update public.studio_bookings set status = 'confirmed' where id = v_source_id;
        v_confirmed := true;
      exception when exclusion_violation then
        raise exception 'Payment not saved: the assigned photographer/resource is already booked at that time. Change the resource or time first.'
          using errcode = '23P01';
      end;
    end if;
  end if;

  return jsonb_build_object('id', v_id, 'ref', v_ref, 'duplicate', false, 'confirmed', v_confirmed);
end;
$$;

create or replace function public.record_refund(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_req uuid;
  v_source_type public.source_type;
  v_source_id uuid;
  v_payment_id uuid;
  v_kind text;
  v_amount numeric;
  v_method public.money_method;
  v_reason text;
  v_reduce boolean;
  v_existing record;
  v_doc record;
  v_pay record;
  b record;
  s record;
  v_overpaid numeric;
  v_adjust numeric;
  v_id uuid;
  v_ref text;
  v_refunded numeric;
begin
  perform private.require_admin();
  v_req := private.j_uuid(p, 'client_request_id');
  v_source_type := nullif(p ->> 'source_type', '')::public.source_type;
  v_source_id := private.j_uuid(p, 'source_id');
  v_payment_id := private.j_uuid(p, 'payment_id');
  v_kind := coalesce(nullif(p ->> 'kind', ''), 'charge_refund');
  v_amount := private.j_money(p, 'amount');
  v_method := (p ->> 'method')::public.money_method;
  v_reason := private.j_text(p, 'reason', 500, true);
  v_reduce := coalesce((p ->> 'reduce_amount_due')::boolean, true);
  if v_req is not null then
    select id, ref into v_existing from public.refunds where client_request_id = v_req;
    if found then return jsonb_build_object('id', v_existing.id, 'ref', v_existing.ref, 'duplicate', true); end if;
  end if;
  if v_method not in ('cash', 'card', 'bank_transfer') then raise exception 'Choose cash, card or bank transfer' using errcode = '22023'; end if;

  if v_source_id is null and v_payment_id is not null then
    -- Refund of a direct sale (no booking/order).
    select * into v_pay from public.payments where id = v_payment_id and voided_at is null;
    if v_pay.id is null then raise exception 'Payment not found' using errcode = 'P0002'; end if;
    if v_pay.source_id is not null then
      v_source_id := v_pay.source_id;
      v_source_type := (select source_type from public.source_documents where source_id = v_pay.source_id);
    else
      select coalesce(sum(amount), 0) into v_refunded from public.refunds where payment_id = v_payment_id and voided_at is null;
      if v_amount > v_pay.amount - v_refunded then
        raise exception 'Refund is more than the remaining payment (Rs. %)', v_pay.amount - v_refunded using errcode = 'check_violation';
      end if;
      insert into public.refunds (business_id, customer_id, payment_id, kind, amount, method, refunded_on, reason, client_request_id)
      values (v_pay.business_id, v_pay.customer_id, v_payment_id, 'charge_refund', v_amount, v_method, private.today(), v_reason, v_req)
      returning id, ref into v_id, v_ref;
      return jsonb_build_object('id', v_id, 'ref', v_ref, 'duplicate', false);
    end if;
  end if;

  if v_source_id is null then raise exception 'Choose what the refund is for' using errcode = '22023'; end if;
  select * into v_doc from public.source_documents where source_id = v_source_id;
  if v_doc.source_id is null then raise exception 'Record not found' using errcode = 'P0002'; end if;
  select * into b from private.balance_of(v_source_id);
  s := private.source_columns(v_doc.source_type, v_source_id);

  if v_kind = 'deposit_return' then
    if v_amount > b.deposit_held then
      raise exception 'Only Rs. % of deposit is held', b.deposit_held using errcode = 'check_violation';
    end if;
  else
    if v_amount > b.net_paid then
      raise exception 'Refund is more than the amount paid (Rs. %)', b.net_paid using errcode = 'check_violation';
    end if;
    -- Refunding an overpayment doesn't change what is owed; any further refund
    -- reduces the amount due (a price reduction) unless the caller says otherwise.
    v_overpaid := least(v_amount, greatest(-b.outstanding, 0));
    v_adjust := case when v_reduce then v_amount - v_overpaid else 0 end;
    if v_adjust > 0 then
      insert into public.financial_adjustments (business_id, studio_booking_id, frame_order_id, camera_rental_id, gift_order_id,
                                                kind, amount, effective_on, reason)
      values (v_doc.business_id, s.studio_booking_id, s.frame_order_id, s.camera_rental_id, s.gift_order_id,
              'discount', -v_adjust, private.today(), 'Refund: ' || v_reason);
    end if;
  end if;

  insert into public.refunds (business_id, customer_id, studio_booking_id, frame_order_id, camera_rental_id, gift_order_id,
                              payment_id, kind, amount, method, refunded_on, reason, client_request_id)
  values (v_doc.business_id, v_doc.customer_id, s.studio_booking_id, s.frame_order_id, s.camera_rental_id, s.gift_order_id,
          v_payment_id, v_kind, v_amount, v_method, private.today(), v_reason, v_req)
  returning id, ref into v_id, v_ref;
  return jsonb_build_object('id', v_id, 'ref', v_ref, 'duplicate', false);
end;
$$;

create or replace function public.record_adjustment(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_source_type public.source_type;
  v_source_id uuid;
  v_kind text;
  v_amount numeric;
  v_doc record;
  b record;
  s record;
  v_id uuid;
begin
  perform private.require_admin();
  v_source_type := (p ->> 'source_type')::public.source_type;
  v_source_id := private.j_uuid(p, 'source_id', true);
  v_kind := p ->> 'kind';
  v_amount := private.j_money(p, 'amount');
  if v_kind not in ('discount', 'write_off', 'surcharge', 'correction') then
    raise exception 'Invalid adjustment type' using errcode = '22023';
  end if;
  if v_kind in ('discount', 'write_off') or (v_kind = 'correction' and coalesce((p ->> 'decrease')::boolean, false)) then
    v_amount := -v_amount;
  end if;
  select * into v_doc from public.source_documents where source_id = v_source_id and source_type = v_source_type;
  if v_doc.source_id is null then raise exception 'Record not found' using errcode = 'P0002'; end if;
  if v_doc.is_closed then raise exception 'Closed or cancelled records cannot be adjusted' using errcode = 'check_violation'; end if;
  select * into b from private.balance_of(v_source_id);
  if b.amount_due + v_amount < 0 then
    raise exception 'The adjustment would make the amount due negative' using errcode = 'check_violation';
  end if;
  if b.amount_due + v_amount < b.net_paid then
    raise exception 'The new amount due (Rs. %) is less than what has been paid (Rs. %). Record a refund instead.',
      b.amount_due + v_amount, b.net_paid using errcode = 'check_violation';
  end if;
  s := private.source_columns(v_source_type, v_source_id);
  insert into public.financial_adjustments (business_id, studio_booking_id, frame_order_id, camera_rental_id, gift_order_id,
                                            kind, amount, effective_on, reason, client_request_id)
  values (v_doc.business_id, s.studio_booking_id, s.frame_order_id, s.camera_rental_id, s.gift_order_id,
          v_kind, v_amount, private.today(), private.j_text(p, 'reason', 500, true), private.j_uuid(p, 'client_request_id'))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.record_expense(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_req uuid;
  v_source_type public.source_type;
  v_source_id uuid;
  v_paid_on date;
  v_method public.money_method;
  v_existing record;
  v_doc record;
  s record;
  v_id uuid;
  v_ref text;
begin
  perform private.require_admin();
  v_req := private.j_uuid(p, 'client_request_id');
  v_source_type := nullif(p ->> 'source_type', '')::public.source_type;
  v_source_id := private.j_uuid(p, 'source_id');
  v_paid_on := coalesce(nullif(p ->> 'paid_on', '')::date, private.today());
  -- Defaults for entries not linked to a booking/order/rental.
  s := private.source_columns(null, null);
  select null::uuid as business_id, null::uuid as customer_id into v_doc;
  v_method := (p ->> 'method')::public.money_method;
  if v_req is not null then
    select id, ref into v_existing from public.expenses where client_request_id = v_req;
    if found then return jsonb_build_object('id', v_existing.id, 'ref', v_existing.ref, 'duplicate', true); end if;
  end if;
  if v_paid_on > private.today() then raise exception 'Expense date cannot be in the future' using errcode = '22023'; end if;
  if v_method = 'deposit' then raise exception 'Invalid payment method' using errcode = '22023'; end if;

  if v_source_id is not null then
    select * into v_doc from public.source_documents where source_id = v_source_id and source_type = v_source_type;
    if v_doc.source_id is null then raise exception 'Record not found' using errcode = 'P0002'; end if;
    s := private.source_columns(v_source_type, v_source_id);
  end if;

  insert into public.expenses (business_id, category_id, amount, method, paid_on, description, receipt_reference,
                               studio_booking_id, frame_order_id, camera_rental_id, gift_order_id, client_request_id)
  values (coalesce(v_doc.business_id, private.j_uuid(p, 'business_id', true)), private.j_uuid(p, 'category_id', true),
          private.j_money(p, 'amount'), v_method, v_paid_on, private.j_text(p, 'description', 1000),
          private.j_text(p, 'receipt_reference', 200), s.studio_booking_id, s.frame_order_id, s.camera_rental_id,
          s.gift_order_id, v_req)
  returning id, ref into v_id, v_ref;
  return jsonb_build_object('id', v_id, 'ref', v_ref, 'duplicate', false);
end;
$$;

-- Splits one bill across businesses. Allocation rows always sum to the total.
create or replace function public.create_shared_expense(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_req uuid;
  v_total numeric;
  v_method text;
  v_alloc jsonb;
  v_n int;
  v_sum numeric;
  v_existing record;
  v_id uuid;
  v_ref text;
  v_scope uuid;
  v_rows jsonb := '[]'::jsonb;
  v_amount numeric;
  v_assigned numeric := 0;
  v_i int := 0;
  a jsonb;
begin
  perform private.require_admin();
  v_req := private.j_uuid(p, 'client_request_id');
  v_total := private.j_money(p, 'total_amount');
  v_method := coalesce(p ->> 'allocation_method', 'equal');
  v_alloc := p -> 'allocations';
  if v_req is not null then
    select id, ref into v_existing from public.shared_expenses where client_request_id = v_req;
    if found then return jsonb_build_object('id', v_existing.id, 'ref', v_existing.ref, 'duplicate', true); end if;
  end if;
  if jsonb_typeof(v_alloc) <> 'array' or jsonb_array_length(v_alloc) < 2 then
    raise exception 'Choose at least two businesses to share the expense' using errcode = '22023';
  end if;
  if (select count(distinct x ->> 'business_id') from jsonb_array_elements(v_alloc) x) <> jsonb_array_length(v_alloc) then
    raise exception 'Each business can appear only once' using errcode = '22023';
  end if;
  select business_id into v_scope from public.transaction_categories where id = private.j_uuid(p, 'category_id', true);
  if v_scope is not null then
    raise exception 'Shared expenses must use a category shared by all businesses' using errcode = 'check_violation';
  end if;
  v_n := jsonb_array_length(v_alloc);

  if v_method = 'percentage' then
    select sum((x ->> 'percent')::numeric) into v_sum from jsonb_array_elements(v_alloc) x;
    if v_sum is distinct from 100 then raise exception 'Percentages must add up to 100' using errcode = '22023'; end if;
  elsif v_method = 'fixed' then
    select sum(private.j_money(x, 'amount')) into v_sum from jsonb_array_elements(v_alloc) x;
    if v_sum is distinct from v_total then
      raise exception 'Allocated amounts (Rs. %) must equal the total (Rs. %)', v_sum, v_total using errcode = '22023';
    end if;
  elsif v_method <> 'equal' then
    raise exception 'Invalid allocation method' using errcode = '22023';
  end if;

  -- Compute each share in cents; the last business absorbs rounding so the sum is exact.
  for a in select * from jsonb_array_elements(v_alloc) loop
    v_i := v_i + 1;
    if v_i = v_n then
      v_amount := v_total - v_assigned;
    elsif v_method = 'equal' then
      v_amount := trunc(v_total / v_n, 2);
    elsif v_method = 'percentage' then
      v_amount := round(v_total * (a ->> 'percent')::numeric / 100, 2);
    else
      v_amount := private.j_money(a, 'amount');
    end if;
    if v_amount <= 0 then raise exception 'Every business must receive a positive share' using errcode = '22023'; end if;
    v_assigned := v_assigned + v_amount;
    v_rows := v_rows || jsonb_build_object('business_id', a ->> 'business_id', 'amount', v_amount);
  end loop;

  insert into public.shared_expenses (category_id, total_amount, method, paid_on, description, receipt_reference,
                                      allocation_method, allocation_rule, client_request_id)
  values (private.j_uuid(p, 'category_id', true), v_total, (p ->> 'method')::public.money_method,
          coalesce(nullif(p ->> 'paid_on', '')::date, private.today()), private.j_text(p, 'description', 500, true),
          private.j_text(p, 'receipt_reference', 200), v_method, v_alloc, v_req)
  returning id, ref into v_id, v_ref;

  insert into public.expenses (business_id, category_id, amount, method, paid_on, description, receipt_reference, shared_expense_id)
  select (r ->> 'business_id')::uuid, sx.category_id, (r ->> 'amount')::numeric, sx.method, sx.paid_on,
         sx.description || ' (shared ' || sx.ref || ')', sx.receipt_reference, sx.id
  from jsonb_array_elements(v_rows) r cross join public.shared_expenses sx where sx.id = v_id;

  return jsonb_build_object('id', v_id, 'ref', v_ref, 'duplicate', false, 'allocations', v_rows);
end;
$$;

-- Voids a ledger entry with a reason (the record stays for audit).
create or replace function public.void_entry(p_kind text, p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_source uuid;
  v_closed boolean;
  b record;
begin
  perform private.require_admin();
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'Enter a reason for voiding' using errcode = '22023';
  end if;

  case p_kind
    when 'payment'    then select source_id into v_source from public.payments where id = p_id and voided_at is null;
    when 'refund'     then select source_id into v_source from public.refunds where id = p_id and voided_at is null;
    when 'expense'    then select source_id into v_source from public.expenses where id = p_id and voided_at is null;
    when 'adjustment' then select source_id into v_source from public.financial_adjustments where id = p_id and voided_at is null;
    when 'shared_expense' then null;
    else raise exception 'Unknown entry type' using errcode = '22023';
  end case;

  if v_source is not null and p_kind <> 'expense' then
    select is_closed into v_closed from public.source_documents where source_id = v_source;
    if v_closed then
      raise exception 'Entries on closed or cancelled records cannot be voided' using errcode = 'check_violation';
    end if;
  end if;

  case p_kind
    when 'payment'        then update public.payments set voided_at = now(), void_reason = btrim(p_reason) where id = p_id and voided_at is null;
    when 'refund'         then update public.refunds set voided_at = now(), void_reason = btrim(p_reason) where id = p_id and voided_at is null;
    when 'expense'        then update public.expenses set voided_at = now(), void_reason = btrim(p_reason) where id = p_id and voided_at is null;
    when 'adjustment'     then update public.financial_adjustments set voided_at = now(), void_reason = btrim(p_reason) where id = p_id and voided_at is null;
    when 'shared_expense' then update public.shared_expenses set voided_at = now(), void_reason = btrim(p_reason) where id = p_id and voided_at is null;
  end case;
  if not found then raise exception 'Entry not found or already voided' using errcode = 'P0002'; end if;

  if v_source is not null then
    select * into b from private.balance_of(v_source);
    if b.deposit_held < 0 then
      raise exception 'Voiding this would leave a negative deposit balance' using errcode = 'check_violation';
    end if;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- RV Camera Rent: availability, pickup, return, ID return
-- -----------------------------------------------------------------------------
create or replace function public.check_equipment_availability(p_from timestamptz, p_to timestamptz, p_exclude_rental uuid default null)
returns table (equipment_id uuid, is_available boolean, conflict_ref text, conflict_until timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  if p_to <= p_from then raise exception 'Return time must be after pickup time' using errcode = '22023'; end if;
  return query
  select e.id,
         e.status = 'available' and c.ref is null,
         c.ref,
         c.until
  from public.camera_equipment e
  left join lateral (
    select r.ref, upper(i.period) as until
    from public.camera_rental_items i join public.camera_rentals r on r.id = i.rental_id
    where i.equipment_id = e.id and i.is_blocking and i.period && tstzrange(p_from, p_to, '[)')
      and (p_exclude_rental is null or i.rental_id <> p_exclude_rental)
    order by lower(i.period) limit 1
  ) c on true
  where e.status <> 'retired';
end;
$$;

-- Pickup: identity verification (data-minimised), condition + accessories, handover.
create or replace function public.camera_pickup(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
  v_held boolean;
  v_item jsonb;
begin
  perform private.require_admin();
  v_held := coalesce((p ->> 'original_held')::boolean, false);
  select status::text into v_status from public.camera_rentals where id = p_id for update;
  if v_status is null then raise exception 'Rental not found' using errcode = 'P0002'; end if;
  if v_status not in ('booked', 'ready_for_pickup') then
    raise exception 'This rental has already been picked up or closed' using errcode = 'check_violation';
  end if;
  if not coalesce((p ->> 'verified')::boolean, false) then
    raise exception 'Confirm that the customer''s identity was verified' using errcode = 'check_violation';
  end if;

  insert into public.camera_rental_id_handover_records (rental_id, id_type, id_last4, verified, verification_notes, original_held, received_at)
  values (p_id, coalesce(p ->> 'id_type', 'nic'), private.j_text(p, 'id_last4', 4), true, private.j_text(p, 'verification_notes', 500),
          v_held, case when v_held then now() end)
  on conflict (rental_id) do update set id_type = excluded.id_type, id_last4 = excluded.id_last4, verified = true,
    verification_notes = excluded.verification_notes, original_held = excluded.original_held, received_at = excluded.received_at;

  for v_item in select * from jsonb_array_elements(coalesce(p -> 'items', '[]'::jsonb)) loop
    insert into public.camera_condition_checks (rental_id, equipment_id, stage, condition, accessories, notes)
    values (p_id, private.j_uuid(v_item, 'equipment_id', true), 'pickup', coalesce(v_item ->> 'condition', 'good'),
            private.j_text(v_item, 'accessories', 500), private.j_text(v_item, 'notes', 1000));
    update public.camera_rental_items set accessories_out = coalesce(private.j_text(v_item, 'accessories', 500), accessories_out)
     where rental_id = p_id and equipment_id = private.j_uuid(v_item, 'equipment_id', true);
  end loop;

  update public.camera_rentals set id_status = case when v_held then 'held' else 'not_held' end, status = 'rented_out',
         actual_pickup_at = now() where id = p_id;
end;
$$;

-- Return: inspection, late fee (default from settings), damage/other charges.
create or replace function public.camera_return(p_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_returned_at timestamptz;
  v_grace int;
  v_mult numeric;
  v_rate numeric;
  v_late_days int := 0;
  v_late_fee numeric;
  v_item jsonb;
begin
  perform private.require_admin();
  v_returned_at := coalesce(nullif(p ->> 'returned_at', '')::timestamptz, now());
  select * into r from public.camera_rentals where id = p_id for update;
  if r.id is null then raise exception 'Rental not found' using errcode = 'P0002'; end if;
  if r.status <> 'rented_out' then raise exception 'Only rented-out equipment can be returned' using errcode = 'check_violation'; end if;
  if v_returned_at < r.actual_pickup_at then raise exception 'Return time is before pickup' using errcode = '22023'; end if;

  select rental_grace_minutes, late_fee_multiplier into v_grace, v_mult from public.system_settings limit 1;
  select coalesce(sum(daily_rate), 0) into v_rate from public.camera_rental_items where rental_id = p_id;
  if v_returned_at > r.expected_return_at + make_interval(mins => coalesce(v_grace, 0)) then
    v_late_days := ceil(extract(epoch from (v_returned_at - r.expected_return_at)) / 86400.0)::int;
  end if;
  v_late_fee := case when nullif(p ->> 'late_fee', '') is null
                     then round(v_rate * v_late_days * coalesce(v_mult, 1), 2)
                     else private.j_money(p, 'late_fee') end;

  for v_item in select * from jsonb_array_elements(coalesce(p -> 'items', '[]'::jsonb)) loop
    insert into public.camera_condition_checks (rental_id, equipment_id, stage, condition, accessories, notes)
    values (p_id, private.j_uuid(v_item, 'equipment_id', true), 'return', coalesce(v_item ->> 'condition', 'good'),
            private.j_text(v_item, 'accessories', 500), private.j_text(v_item, 'notes', 1000));
    update public.camera_rental_items set accessories_in = private.j_text(v_item, 'accessories', 500), returned_at = v_returned_at
     where rental_id = p_id and equipment_id = private.j_uuid(v_item, 'equipment_id', true);
  end loop;
  update public.camera_rental_items set returned_at = v_returned_at where rental_id = p_id and returned_at is null;

  update public.camera_rentals set actual_return_at = v_returned_at, late_fee = v_late_fee,
         damage_charge = private.j_money(p, 'damage_charge', false, 0), other_charges = private.j_money(p, 'other_charges', false, other_charges),
         return_notes = private.j_text(p, 'return_notes', 2000), status = 'returned'
   where id = p_id;

  return jsonb_build_object('late_days', v_late_days, 'late_fee', v_late_fee);
end;
$$;

create or replace function public.camera_return_id(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  update public.camera_rental_id_handover_records set returned_at = now(), return_note = nullif(btrim(p_note), '')
   where rental_id = p_id and original_held and returned_at is null;
  if not found then raise exception 'No held ID to return for this rental' using errcode = 'check_violation'; end if;
  update public.camera_rentals set id_status = 'returned' where id = p_id;
end;
$$;
