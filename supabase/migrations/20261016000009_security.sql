-- =============================================================================
-- RV BUSINESS HUB — privileges, RLS and auditing for the operations & finance
-- schema. Least privilege: money and document workflows can only be written
-- through the admin RPCs (which enforce the business rules); direct table
-- writes are limited to reference data and harmless fields.
-- =============================================================================

do $$
declare
  t text;
  all_tables text[] := array[
    'system_settings', 'customers', 'studio_packages', 'studio_resources', 'studio_bookings',
    'frame_orders', 'frame_order_items', 'camera_equipment', 'camera_rentals', 'camera_rental_items',
    'camera_condition_checks', 'camera_rental_id_handover_records', 'gift_products', 'gift_orders',
    'gift_order_items', 'inventory_movements', 'payments', 'refunds', 'financial_adjustments',
    'shared_expenses', 'expenses', 'reminders', 'notifications'];
  audited text[] := array[
    'system_settings', 'customers', 'studio_packages', 'studio_resources', 'studio_bookings',
    'frame_orders', 'frame_order_items', 'camera_equipment', 'camera_rentals', 'camera_rental_items',
    'camera_condition_checks', 'camera_rental_id_handover_records', 'gift_products', 'gift_orders',
    'gift_order_items', 'inventory_movements', 'payments', 'refunds', 'financial_adjustments',
    'shared_expenses', 'expenses', 'transaction_categories'];
begin
  foreach t in array all_tables loop
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "admin reads %s" on public.%I for select to authenticated using ((select private.is_admin()))', t, t);
  end loop;

  foreach t in array audited loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.write_audit_log()',
                   t || '_audit', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Reference data the admin edits directly
-- ---------------------------------------------------------------------------
grant insert (full_name, phone, whatsapp, email, address, notes, is_active),
      update (full_name, phone, whatsapp, email, address, notes, is_active), delete on public.customers to authenticated;
grant insert (name, description, base_price, duration_hours, is_active, sort_order),
      update (name, description, base_price, duration_hours, is_active, sort_order), delete on public.studio_packages to authenticated;
grant insert (name, kind, is_active), update (name, kind, is_active), delete on public.studio_resources to authenticated;
grant insert (name, category, brand, model, serial_number, daily_rate, default_deposit, included_accessories, status, condition_notes),
      update (name, category, brand, model, serial_number, daily_rate, default_deposit, included_accessories, status, condition_notes),
      delete on public.camera_equipment to authenticated;
-- stock_quantity is derived from inventory_movements and never written directly.
grant insert (sku, name, description, unit_price, cost_price, track_stock, reorder_level, is_active),
      update (sku, name, description, unit_price, cost_price, track_stock, reorder_level, is_active),
      delete on public.gift_products to authenticated;
grant insert (product_id, quantity, reason, unit_cost, note) on public.inventory_movements to authenticated;
grant update (studio_reminder_days, frame_reminder_days, gift_reminder_days, payment_due_reminder_days,
              rental_pickup_reminder_hours, rental_return_reminder_hours, default_advance_percent, late_fee_multiplier,
              rental_grace_minutes, gift_require_full_payment_before_delivery, gift_stock_deduction, receipt_footer)
      on public.system_settings to authenticated;
grant insert (business_id, title, body, due_at, kind), update (status, title, body, due_at), delete on public.reminders to authenticated;
grant update (read_at), delete on public.notifications to authenticated;

-- Only notes/references may be edited on ledger rows (amounts are immutable; void instead).
grant update (notes, reference) on public.payments to authenticated;
grant update (description, receipt_reference) on public.expenses to authenticated;
grant update (description, receipt_reference) on public.shared_expenses to authenticated;

-- Customisable categories.
grant insert (name, type, business_id, is_active, sort_order), update (name, is_active, sort_order)
  on public.transaction_categories to authenticated;
create policy "admin creates categories" on public.transaction_categories
  for insert to authenticated with check ((select private.is_admin()));
create policy "admin updates categories" on public.transaction_categories
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

do $$
declare t text;
begin
  foreach t in array array['customers', 'studio_packages', 'studio_resources', 'camera_equipment', 'gift_products'] loop
    execute format('create policy "admin inserts %s" on public.%I for insert to authenticated with check ((select private.is_admin()))', t, t);
    execute format('create policy "admin updates %s" on public.%I for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()))', t, t);
    execute format('create policy "admin deletes %s" on public.%I for delete to authenticated using ((select private.is_admin()))', t, t);
  end loop;
  foreach t in array array['payments', 'expenses', 'shared_expenses', 'system_settings', 'notifications'] loop
    execute format('create policy "admin updates %s" on public.%I for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()))', t, t);
  end loop;
end $$;

-- Manual stock movements only (sales are recorded by the order workflow).
create policy "admin records stock movements" on public.inventory_movements
  for insert to authenticated
  with check ((select private.is_admin()) and reason in ('purchase', 'adjustment', 'return', 'damage'));

-- Manual reminders only; automatic ones are managed by the system.
create policy "admin creates reminders" on public.reminders
  for insert to authenticated with check ((select private.is_admin()) and kind = 'custom');
create policy "admin updates reminders" on public.reminders
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin deletes manual reminders" on public.reminders
  for delete to authenticated using ((select private.is_admin()) and not auto_generated);
create policy "admin deletes notifications" on public.notifications
  for delete to authenticated using ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------
revoke all on public.source_documents, public.receivables, public.ledger_entries from public, anon, authenticated;
grant select on public.source_documents, public.receivables, public.ledger_entries to authenticated;

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------
do $$
declare f record;
begin
  -- Nothing in the private schema is callable by API roles unless granted below.
  for f in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'private'::regnamespace loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
  -- Public RPCs: authenticated only (each one checks the admin allowlist).
  for f in select p.oid::regprocedure as sig from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('save_studio_booking', 'save_frame_order', 'save_camera_rental', 'save_gift_order',
                               'set_document_status', 'cancel_document', 'record_payment', 'record_refund',
                               'record_adjustment', 'record_expense', 'create_shared_expense', 'void_entry',
                               'check_equipment_availability', 'camera_pickup', 'camera_return', 'camera_return_id',
                               'generate_notifications', 'calendar_events', 'report_business_summary', 'report_trend',
                               'report_payment_methods', 'dashboard_operations') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

-- Helpers evaluated with the caller's privileges (RLS policies, invoker views/functions).
grant execute on function private.is_admin() to authenticated;
grant execute on function private.today() to authenticated;
grant execute on function private.in_range(date, date, date) to authenticated;
grant execute on function private.source_link(public.source_type, uuid) to authenticated;
-- Used by CHECK constraints, which run with the caller's privileges.
grant execute on function private.valid_offsets(int[]) to authenticated;
