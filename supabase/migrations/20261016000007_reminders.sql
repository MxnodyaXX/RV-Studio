-- =============================================================================
-- RV BUSINESS HUB — reminders & in-app notifications
--
-- Automatic reminders are regenerated from the current state of each booking /
-- order / rental whenever it (or a payment against it) changes, using the
-- offsets in system_settings. Manual reminders are never touched.
-- Notifications are created from due reminders by generate_notifications(),
-- which the app calls on load and periodically. The `channel` column leaves
-- room for email/WhatsApp delivery in a later phase.
-- =============================================================================

create table public.reminders (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid references public.businesses (id) on delete cascade,
  studio_booking_id uuid references public.studio_bookings (id) on delete cascade,
  frame_order_id    uuid references public.frame_orders (id) on delete cascade,
  camera_rental_id  uuid references public.camera_rentals (id) on delete cascade,
  gift_order_id     uuid references public.gift_orders (id) on delete cascade,
  source_id         uuid generated always as (coalesce(studio_booking_id, frame_order_id, camera_rental_id, gift_order_id)) stored,
  kind              text not null check (kind in ('studio_shoot', 'frame_completion', 'rental_pickup', 'rental_return',
                                                  'rental_overdue', 'gift_delivery', 'payment_due', 'custom')),
  title             text not null check (length(btrim(title)) between 1 and 200),
  body              text check (body is null or length(body) <= 1000),
  event_at          timestamptz,
  due_at            timestamptz not null,
  status            text not null default 'pending' check (status in ('pending', 'done', 'dismissed')),
  channel           text not null default 'in_app' check (channel in ('in_app', 'email', 'whatsapp')),
  auto_generated    boolean not null default false,
  notified_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint reminders_single_source check (num_nonnulls(studio_booking_id, frame_order_id, camera_rental_id, gift_order_id) <= 1)
);
create index reminders_due_idx    on public.reminders (status, due_at);
create index reminders_source_idx on public.reminders (source_id);
create trigger reminders_set_updated_at before update on public.reminders for each row execute function private.set_updated_at();

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  reminder_id uuid unique references public.reminders (id) on delete set null,
  business_id uuid references public.businesses (id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text,
  link        text check (link is null or link ~ '^/[A-Za-z0-9/_?=&.-]*$'),
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_unread_idx on public.notifications (created_at desc) where read_at is null;

create or replace function private.source_link(p_type public.source_type, p_id uuid) returns text
language sql immutable set search_path = '' as $$
  select case p_type
    when 'studio_booking' then '/studio/bookings/' || p_id
    when 'frame_order'    then '/frames/orders/' || p_id
    when 'camera_rental'  then '/camera/rentals/' || p_id
    when 'gift_order'     then '/gifts/orders/' || p_id
  end;
$$;

-- 09:00 Asia/Colombo on (date − offset days).
create or replace function private.colombo_morning(p_date date, p_days_before int) returns timestamptz
language sql immutable set search_path = '' as $$
  select ((p_date - p_days_before) + time '09:00') at time zone 'Asia/Colombo';
$$;

create or replace function private.offset_label(p_days int, p_unit text default 'day') returns text
language sql immutable set search_path = '' as $$
  select case when p_days = 0 then (case p_unit when 'day' then 'today' else 'now' end)
              when p_days = 1 then '1 ' || p_unit || ' left'
              else p_days || ' ' || p_unit || 's left' end;
$$;

-- Rebuilds the automatic reminders of one document.
create or replace function private.sync_reminders(p_type public.source_type, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  st public.system_settings;
  d record;
  r record;
  v_customer text;
  v_offset int;
  v_due timestamptz;
  v_now timestamptz := now();
  s record;
begin
  delete from public.reminders where source_id = p_id and auto_generated and status = 'pending';

  select * into st from public.system_settings limit 1;
  select * into d from public.receivables where source_id = p_id;
  if d.source_id is null then return; end if;
  select full_name into v_customer from public.customers where id = d.customer_id;
  s := private.source_columns(p_type, p_id);

  -- Payment-due reminders for anything still owed.
  if not d.is_closed and d.outstanding > 0 and d.due_date is not null then
    foreach v_offset in array st.payment_due_reminder_days loop
      v_due := private.colombo_morning(d.due_date, v_offset);
      if v_due >= v_now - interval '1 hour' then
        insert into public.reminders (business_id, studio_booking_id, frame_order_id, camera_rental_id, gift_order_id, kind, title, body, event_at, due_at, auto_generated)
        values (d.business_id, s.studio_booking_id, s.frame_order_id, s.camera_rental_id, s.gift_order_id, 'payment_due',
                'Payment due (' || private.offset_label(v_offset) || ') – ' || d.ref,
                coalesce(v_customer, 'Walk-in') || ' owes Rs. ' || to_char(d.outstanding, 'FM999,999,999,990.00'),
                d.due_date::timestamptz, v_due, true);
      end if;
    end loop;
  end if;

  if p_type = 'studio_booking' then
    select * into r from public.studio_bookings where id = p_id;
    if r.status in ('confirmed', 'in_progress') then
      foreach v_offset in array st.studio_reminder_days loop
        v_due := case when v_offset = 0 then ((r.shoot_date + time '07:00') at time zone 'Asia/Colombo')
                      else private.colombo_morning(r.shoot_date, v_offset) end;
        if v_due >= v_now - interval '1 hour' then
          insert into public.reminders (business_id, studio_booking_id, kind, title, body, event_at, due_at, auto_generated)
          values (r.business_id, r.id, 'studio_shoot',
                  case when v_offset = 0 then 'Shoot today – ' else 'Shoot in ' || v_offset || ' day' || case when v_offset > 1 then 's' else '' end || ' – ' end || r.ref,
                  r.package_name || ' for ' || v_customer || ' at ' || r.location || ', ' || to_char(r.start_time, 'HH24:MI'),
                  lower(r.shoot_period), v_due, true);
        end if;
      end loop;
    end if;

  elsif p_type = 'frame_order' then
    select * into r from public.frame_orders where id = p_id;
    if r.status in ('new', 'processing') and r.expected_completion_date is not null then
      foreach v_offset in array st.frame_reminder_days loop
        v_due := private.colombo_morning(r.expected_completion_date, v_offset);
        if v_due >= v_now - interval '1 hour' then
          insert into public.reminders (business_id, frame_order_id, kind, title, body, event_at, due_at, auto_generated)
          values (r.business_id, r.id, 'frame_completion', 'Frame due ' || private.offset_label(v_offset) || ' – ' || r.ref,
                  d.title || ' for ' || v_customer, r.expected_completion_date::timestamptz, v_due, true);
        end if;
      end loop;
    end if;

  elsif p_type = 'camera_rental' then
    select * into r from public.camera_rentals where id = p_id;
    if r.status in ('booked', 'ready_for_pickup') then
      foreach v_offset in array st.rental_pickup_reminder_hours loop
        v_due := r.pickup_at - make_interval(hours => v_offset);
        if v_due >= v_now - interval '1 hour' then
          insert into public.reminders (business_id, camera_rental_id, kind, title, body, event_at, due_at, auto_generated)
          values (r.business_id, r.id, 'rental_pickup', 'Pickup ' || private.offset_label(v_offset, 'hour') || ' – ' || r.ref,
                  v_customer || ': ' || d.title, r.pickup_at, v_due, true);
        end if;
      end loop;
    elsif r.status = 'rented_out' then
      foreach v_offset in array st.rental_return_reminder_hours loop
        v_due := r.expected_return_at - make_interval(hours => v_offset);
        if v_due >= v_now - interval '1 hour' then
          insert into public.reminders (business_id, camera_rental_id, kind, title, body, event_at, due_at, auto_generated)
          values (r.business_id, r.id, 'rental_return', 'Return due ' || private.offset_label(v_offset, 'hour') || ' – ' || r.ref,
                  v_customer || ': ' || d.title, r.expected_return_at, v_due, true);
        end if;
      end loop;
      insert into public.reminders (business_id, camera_rental_id, kind, title, body, event_at, due_at, auto_generated)
      values (r.business_id, r.id, 'rental_overdue', 'OVERDUE – ' || r.ref || ' not returned',
              v_customer || ' was due to return ' || d.title, r.expected_return_at,
              r.expected_return_at + make_interval(mins => st.rental_grace_minutes), true);
    end if;

  elsif p_type = 'gift_order' then
    select * into r from public.gift_orders where id = p_id;
    if r.status in ('new', 'processing', 'ready') and r.expected_delivery_date is not null then
      foreach v_offset in array st.gift_reminder_days loop
        v_due := private.colombo_morning(r.expected_delivery_date, v_offset);
        if v_due >= v_now - interval '1 hour' then
          insert into public.reminders (business_id, gift_order_id, kind, title, body, event_at, due_at, auto_generated)
          values (r.business_id, r.id, 'gift_delivery', 'Gift delivery ' || private.offset_label(v_offset) || ' – ' || r.ref,
                  d.title || coalesce(' for ' || v_customer, ''), r.expected_delivery_date::timestamptz, v_due, true);
        end if;
      end loop;
    end if;
  end if;
end;
$$;

create or replace function private.sync_reminders_from_document()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.sync_reminders(tg_argv[0]::public.source_type, new.id);
  return null;
end;
$$;
create trigger studio_bookings_reminders after insert or update on public.studio_bookings
  for each row execute function private.sync_reminders_from_document('studio_booking');
create trigger frame_orders_reminders after insert or update on public.frame_orders
  for each row execute function private.sync_reminders_from_document('frame_order');
create trigger camera_rentals_reminders after insert or update on public.camera_rentals
  for each row execute function private.sync_reminders_from_document('camera_rental');
create trigger gift_orders_reminders after insert or update on public.gift_orders
  for each row execute function private.sync_reminders_from_document('gift_order');

-- Payments/refunds/adjustments change what is owed → refresh payment reminders.
create or replace function private.sync_reminders_from_ledger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_type public.source_type;
begin
  if new.source_id is not null then
    select source_type into v_type from public.source_documents where source_id = new.source_id;
    perform private.sync_reminders(v_type, new.source_id);
  end if;
  return null;
end;
$$;
create trigger payments_reminders after insert or update on public.payments
  for each row execute function private.sync_reminders_from_ledger();
create trigger refunds_reminders after insert or update on public.refunds
  for each row execute function private.sync_reminders_from_ledger();
create trigger adjustments_reminders after insert or update on public.financial_adjustments
  for each row execute function private.sync_reminders_from_ledger();

-- Changing reminder settings rebuilds every open document's reminders.
create or replace function private.resync_all_reminders()
returns trigger language plpgsql security definer set search_path = '' as $$
declare d record;
begin
  for d in select source_type, source_id from public.source_documents where not is_closed loop
    perform private.sync_reminders(d.source_type, d.source_id);
  end loop;
  return null;
end;
$$;
create trigger system_settings_resync after update on public.system_settings
  for each row execute function private.resync_all_reminders();

-- Turns due reminders into notifications (once each). Safe to call repeatedly.
create or replace function public.generate_notifications()
returns int language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  perform private.require_admin();
  with due as (
    update public.reminders r set notified_at = now()
     where r.status = 'pending' and r.notified_at is null and r.due_at <= now()
     returning r.*
  ), ins as (
    insert into public.notifications (reminder_id, business_id, kind, title, body, link)
    select due.id, due.business_id, due.kind, due.title, due.body,
           case when due.source_id is not null
                then private.source_link((select source_type from public.source_documents sd where sd.source_id = due.source_id), due.source_id)
                else '/calendar' end
    from due
    on conflict (reminder_id) do nothing
    returning 1
  )
  select count(*) into v_count from ins;
  return v_count;
end;
$$;

-- Calendar feed: documents' key dates in a window, plus reminders.
create or replace function public.calendar_events(p_from date, p_to date)
returns table (event_key text, event_type text, business_id uuid, source_type public.source_type, source_id uuid,
               ref text, title text, starts_at timestamptz, ends_at timestamptz, all_day boolean, status text, link text)
language sql stable security invoker set search_path = '' as $$
  select 'sb:' || b.id, 'studio_shoot', b.business_id, 'studio_booking'::public.source_type, b.id, b.ref,
         b.package_name || ' – ' || c.full_name, lower(b.shoot_period), upper(b.shoot_period), false, b.status::text,
         private.source_link('studio_booking', b.id)
  from public.studio_bookings b join public.customers c on c.id = b.customer_id
  where b.status <> 'cancelled' and b.shoot_date between p_from and p_to
  union all
  select 'fo:' || f.id, 'frame_completion', f.business_id, 'frame_order', f.id, f.ref,
         'Frame due – ' || c.full_name, f.expected_completion_date::timestamptz, null, true, f.status::text,
         private.source_link('frame_order', f.id)
  from public.frame_orders f join public.customers c on c.id = f.customer_id
  where f.status in ('new', 'processing', 'ready') and f.expected_completion_date between p_from and p_to
  union all
  select 'crp:' || r.id, 'rental_pickup', r.business_id, 'camera_rental', r.id, r.ref,
         'Pickup – ' || c.full_name, r.pickup_at, null, false, r.status::text, private.source_link('camera_rental', r.id)
  from public.camera_rentals r join public.customers c on c.id = r.customer_id
  where r.status in ('booked', 'ready_for_pickup') and (r.pickup_at at time zone 'Asia/Colombo')::date between p_from and p_to
  union all
  select 'crr:' || r.id, 'rental_return', r.business_id, 'camera_rental', r.id, r.ref,
         'Return – ' || c.full_name, r.expected_return_at, null, false, r.status::text, private.source_link('camera_rental', r.id)
  from public.camera_rentals r join public.customers c on c.id = r.customer_id
  where r.status in ('booked', 'ready_for_pickup', 'rented_out')
    and (r.expected_return_at at time zone 'Asia/Colombo')::date between p_from and p_to
  union all
  select 'go:' || g.id, 'gift_delivery', g.business_id, 'gift_order', g.id, g.ref,
         'Gift delivery' || coalesce(' – ' || c.full_name, ''), g.expected_delivery_date::timestamptz, null, true, g.status::text,
         private.source_link('gift_order', g.id)
  from public.gift_orders g left join public.customers c on c.id = g.customer_id
  where g.status in ('new', 'processing', 'ready') and g.expected_delivery_date between p_from and p_to
  union all
  select 'pd:' || r.source_id, 'payment_due', r.business_id, r.source_type, r.source_id, r.ref,
         'Payment due Rs. ' || to_char(r.outstanding, 'FM999,999,999,990.00'), r.due_date::timestamptz, null, true, r.payment_status,
         private.source_link(r.source_type, r.source_id)
  from public.receivables r
  where not r.is_closed and r.outstanding > 0 and r.due_date between p_from and p_to
  union all
  select 'rm:' || m.id, 'reminder', m.business_id, null, null, null, m.title, m.due_at, null, false, m.status, '/calendar'
  from public.reminders m
  where not m.auto_generated and m.status = 'pending' and (m.due_at at time zone 'Asia/Colombo')::date between p_from and p_to;
$$;
