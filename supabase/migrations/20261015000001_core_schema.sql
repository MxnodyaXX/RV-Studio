-- =============================================================================
-- RV BUSINESS HUB — Phase 1 core schema, security model and audit trail
-- -----------------------------------------------------------------------------
-- Safe to run once in the Supabase SQL Editor or via `supabase db push`.
-- Technical timestamps are timestamptz (stored UTC). Business dates
-- (transactions.transaction_date) are plain DATEs interpreted in Asia/Colombo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Private schema (NOT exposed through the Data API)
-- -----------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
-- RLS policies evaluated as `authenticated` need to call private.is_admin().
grant usage on schema private to authenticated;

-- -----------------------------------------------------------------------------
-- 1. Enumerated types
-- -----------------------------------------------------------------------------
create type public.transaction_type as enum ('income', 'expense');
create type public.payment_method   as enum ('cash', 'bank_transfer', 'card', 'other');

-- -----------------------------------------------------------------------------
-- 2. Administrator allowlist (established during deployment, never by clients)
-- -----------------------------------------------------------------------------
create table private.admin_allowlist (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  added_at   timestamptz not null default now(),
  note       text
);

-- Phase 1 is a single-administrator system. This index allows at most ONE row.
-- To support more administrators/roles in a future phase, drop this index in a
-- reviewed migration (policies keep working unchanged).
create unique index admin_allowlist_single_admin on private.admin_allowlist ((true));

revoke all on private.admin_allowlist from public, anon, authenticated;

-- Returns true when the caller's JWT belongs to the allowlisted administrator.
-- SECURITY DEFINER so it can read the allowlist the caller has no access to.
create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.admin_allowlist a
    where a.user_id = (select auth.uid())
  );
$$;
revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;

-- Deployment helper: run as the database owner in the SQL Editor ONLY.
--   select private.grant_admin('owner@example.com', 'Administrator');
create or replace function private.grant_admin(p_email text, p_display_name text default 'Administrator')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  select id into v_user_id from auth.users where lower(email) = lower(btrim(p_email));
  if v_user_id is null then
    raise exception 'No auth user with email %. Create the user in Authentication > Users first.', p_email;
  end if;

  insert into private.admin_allowlist (user_id, note)
  values (v_user_id, 'Granted via private.grant_admin')
  on conflict (user_id) do nothing;

  insert into public.admin_profiles (id, display_name)
  values (v_user_id, coalesce(nullif(btrim(p_display_name), ''), 'Administrator'))
  on conflict (id) do nothing;

  return v_user_id;
end;
$$;
revoke all on function private.grant_admin(text, text) from public, anon, authenticated;

-- Public RPC so the app can tell "signed in but not authorised" apart from
-- "signed in administrator". Reveals nothing beyond the caller's own status.
create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.is_admin();
$$;
revoke all on function public.current_user_is_admin() from public, anon;
grant execute on function public.current_user_is_admin() to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Shared trigger helpers
-- -----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Tables
-- -----------------------------------------------------------------------------
create table public.admin_profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 80),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.businesses (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  code        text not null unique check (code ~ '^B[0-9]{2}$'),
  name        text not null unique check (length(btrim(name)) between 1 and 120),
  category    text not null check (length(btrim(category)) between 1 and 120),
  description text check (description is null or length(description) <= 1000),
  sort_order  smallint not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.transaction_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 80),
  type        public.transaction_type not null,
  business_id uuid references public.businesses (id) on delete restrict, -- null = shared by all businesses
  is_active   boolean not null default true,
  sort_order  smallint not null default 0,
  created_at  timestamptz not null default now(),
  -- Target of the composite FK that guarantees category type == transaction type.
  constraint transaction_categories_id_type_key unique (id, type)
);
create unique index transaction_categories_unique_name
  on public.transaction_categories (lower(name), type, coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table public.transactions (
  id                uuid primary key default gen_random_uuid(),
  -- Human-friendly sequential reference shown in the UI as TXN-000123.
  txn_number        bigint generated always as identity unique,
  business_id       uuid not null references public.businesses (id) on delete restrict,
  category_id       uuid not null,
  type              public.transaction_type not null,
  amount            numeric(14, 2) not null check (amount > 0),
  currency          char(3) not null default 'LKR' check (currency = 'LKR'),
  transaction_date  date not null check (transaction_date between date '2000-01-01' and date '2100-12-31'),
  payment_method    public.payment_method,
  reference         text check (reference is null or length(reference) <= 200),
  description       text check (description is null or length(description) <= 1000),
  -- Idempotency key generated per form submission: a double-click or network
  -- retry cannot create the same transaction twice.
  client_request_id uuid unique,
  created_by        uuid references auth.users (id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- Database-enforced: the category must have the same type (income/expense).
  constraint transactions_category_type_fkey
    foreign key (category_id, type) references public.transaction_categories (id, type)
    on update restrict on delete restrict
);

create table public.audit_logs (
  id             uuid primary key default gen_random_uuid(),
  actor_id       uuid,
  entity_type    text not null,
  entity_id      uuid not null,
  action         text not null check (action in ('insert', 'update', 'delete')),
  changed_at     timestamptz not null default now(),
  change_summary jsonb not null default '{}'::jsonb
);

-- -----------------------------------------------------------------------------
-- 5. Indexes for frequent filters
-- -----------------------------------------------------------------------------
create index transactions_date_idx           on public.transactions (transaction_date desc, created_at desc);
create index transactions_business_date_idx  on public.transactions (business_id, transaction_date desc);
create index transactions_type_date_idx      on public.transactions (type, transaction_date desc);
create index transactions_category_idx       on public.transactions (category_id);
create index transactions_created_by_idx     on public.transactions (created_by);
create index transaction_categories_business_idx on public.transaction_categories (business_id);
create index audit_logs_entity_idx           on public.audit_logs (entity_type, entity_id, changed_at desc);
create index audit_logs_changed_at_idx       on public.audit_logs (changed_at desc);

-- -----------------------------------------------------------------------------
-- 6. Integrity triggers
-- -----------------------------------------------------------------------------
create trigger admin_profiles_set_updated_at before update on public.admin_profiles
  for each row execute function private.set_updated_at();
create trigger businesses_set_updated_at before update on public.businesses
  for each row execute function private.set_updated_at();
create trigger transactions_set_updated_at before update on public.transactions
  for each row execute function private.set_updated_at();

-- Validates business-scoped categories, inactive records and ownership fields.
create or replace function private.validate_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cat record;
  v_business_active boolean;
begin
  select c.business_id, c.is_active into v_cat
  from public.transaction_categories c where c.id = new.category_id;

  if v_cat.business_id is not null and v_cat.business_id <> new.business_id then
    raise exception 'Category does not belong to the selected business'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' or new.category_id is distinct from old.category_id then
    if not v_cat.is_active then
      raise exception 'Category is inactive' using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'INSERT' or new.business_id is distinct from old.business_id then
    select b.is_active into v_business_active from public.businesses b where b.id = new.business_id;
    if not coalesce(v_business_active, false) then
      raise exception 'Business is inactive' using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'INSERT' then
    -- The creator is always the authenticated caller; it cannot be spoofed.
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
    new.currency := 'LKR';
  else
    -- Immutable after creation.
    new.created_by        := old.created_by;
    new.created_at        := old.created_at;
    new.client_request_id := old.client_request_id;
  end if;

  return new;
end;
$$;

create trigger transactions_validate before insert or update on public.transactions
  for each row execute function private.validate_transaction();

-- -----------------------------------------------------------------------------
-- 7. Audit trail (written only by triggers; clients cannot write it)
-- -----------------------------------------------------------------------------
create or replace function private.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_summary jsonb;
  v_old jsonb;
  v_new jsonb;
  v_key text;
begin
  if tg_op = 'INSERT' then
    v_summary := jsonb_build_object('new', to_jsonb(new));
  elsif tg_op = 'DELETE' then
    v_summary := jsonb_build_object('old', to_jsonb(old));
  else
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_summary := '{}'::jsonb;
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key <> 'updated_at' and (v_new -> v_key) is distinct from (v_old -> v_key) then
        v_summary := v_summary || jsonb_build_object(v_key, jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key));
      end if;
    end loop;
    if v_summary = '{}'::jsonb then
      return new; -- no-op update; nothing to audit
    end if;
    v_summary := jsonb_build_object('changes', v_summary);
  end if;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, change_summary)
  values (
    auth.uid(),
    tg_table_name,
    coalesce((case when tg_op = 'DELETE' then old.id else new.id end)),
    lower(tg_op),
    v_summary
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger transactions_audit after insert or update or delete on public.transactions
  for each row execute function private.write_audit_log();
create trigger businesses_audit after insert or update or delete on public.businesses
  for each row execute function private.write_audit_log();

-- Trigger-only functions must not be callable directly.
revoke all on function private.set_updated_at()        from public, anon, authenticated;
revoke all on function private.validate_transaction()  from public, anon, authenticated;
revoke all on function private.write_audit_log()       from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8. Privileges (least privilege; RLS below is the second layer)
-- -----------------------------------------------------------------------------
revoke all on public.admin_profiles, public.businesses, public.transaction_categories,
              public.transactions, public.audit_logs
  from public, anon, authenticated;

grant select                               on public.admin_profiles to authenticated;
grant insert (id, display_name)            on public.admin_profiles to authenticated;
grant update (display_name)                on public.admin_profiles to authenticated;

grant select                               on public.businesses to authenticated;
grant update (name, category, description) on public.businesses to authenticated;

grant select                               on public.transaction_categories to authenticated;

grant select, delete                       on public.transactions to authenticated;
grant insert (business_id, category_id, type, amount, transaction_date, payment_method,
              reference, description, client_request_id)
                                           on public.transactions to authenticated;
grant update (business_id, category_id, type, amount, transaction_date, payment_method,
              reference, description)      on public.transactions to authenticated;

grant select                               on public.audit_logs to authenticated; -- read-only

-- -----------------------------------------------------------------------------
-- 9. Row Level Security — every table, admin-only
-- -----------------------------------------------------------------------------
alter table public.admin_profiles         enable row level security;
alter table public.businesses             enable row level security;
alter table public.transaction_categories enable row level security;
alter table public.transactions           enable row level security;
alter table public.audit_logs             enable row level security;
alter table private.admin_allowlist       enable row level security; -- no policies: deny all

-- admin_profiles: the administrator can only see/edit their own profile.
create policy "admin reads own profile" on public.admin_profiles
  for select to authenticated using ((select private.is_admin()) and id = (select auth.uid()));
create policy "admin creates own profile" on public.admin_profiles
  for insert to authenticated with check ((select private.is_admin()) and id = (select auth.uid()));
create policy "admin updates own profile" on public.admin_profiles
  for update to authenticated
  using ((select private.is_admin()) and id = (select auth.uid()))
  with check ((select private.is_admin()) and id = (select auth.uid()));

-- businesses
create policy "admin reads businesses" on public.businesses
  for select to authenticated using ((select private.is_admin()));
create policy "admin updates businesses" on public.businesses
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

-- transaction_categories (read-only for the client in Phase 1)
create policy "admin reads categories" on public.transaction_categories
  for select to authenticated using ((select private.is_admin()));

-- transactions
create policy "admin reads transactions" on public.transactions
  for select to authenticated using ((select private.is_admin()));
create policy "admin inserts transactions" on public.transactions
  for insert to authenticated with check ((select private.is_admin()));
create policy "admin updates transactions" on public.transactions
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin deletes transactions" on public.transactions
  for delete to authenticated using ((select private.is_admin()));

-- audit_logs: read-only for the administrator; written only by SECURITY DEFINER triggers.
create policy "admin reads audit logs" on public.audit_logs
  for select to authenticated using ((select private.is_admin()));
