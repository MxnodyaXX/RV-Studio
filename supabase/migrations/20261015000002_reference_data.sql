-- =============================================================================
-- RV BUSINESS HUB — reference data (businesses + standard categories)
-- Idempotent. Contains NO financial records.
-- =============================================================================

insert into public.businesses (slug, code, name, category, description, sort_order) values
  ('rv-camera-rent',  'B01', 'RV Camera Rent',  'Camera Rental Services',            'Camera, lens and equipment rentals.',        1),
  ('studio-of-rv',    'B02', 'Studio Of RV',    'Photography and Studio Services',   'Photography sessions and studio bookings.', 2),
  ('gift-park',       'B03', 'Gift Park',       'Gifts and Products',                'Gift items and product sales.',             3),
  ('the-frame-house', 'B04', 'The Frame House', 'Custom Frames and Framing Services','Custom frames and framing services.',       4)
on conflict (slug) do nothing;

-- Shared categories (business_id is null => available to every business).
insert into public.transaction_categories (name, type, sort_order)
select v.name, v.type::public.transaction_type, v.sort_order
from (values
  ('Camera Rental Income',  'income',  1),
  ('Photography Services',  'income',  2),
  ('Studio Booking',        'income',  3),
  ('Gift Sales',            'income',  4),
  ('Frame Sales',           'income',  5),
  ('Other Income',          'income', 99),
  ('Equipment Purchase',    'expense', 1),
  ('Equipment Maintenance', 'expense', 2),
  ('Transport',             'expense', 3),
  ('Electricity',           'expense', 4),
  ('Rent',                  'expense', 5),
  ('Salaries',              'expense', 6),
  ('Marketing',             'expense', 7),
  ('Supplies',              'expense', 8),
  ('Other Expenses',        'expense', 99)
) as v(name, type, sort_order)
where not exists (
  select 1 from public.transaction_categories c
  where lower(c.name) = lower(v.name) and c.type = v.type::public.transaction_type and c.business_id is null
);
