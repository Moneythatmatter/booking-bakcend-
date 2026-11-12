-- Multi-tenant hotel booking engine schema.
-- Run in the Supabase SQL editor, or with the Supabase CLI: supabase db push

create extension if not exists pgcrypto;

do $$ begin
  create type platform_role as enum ('super_admin', 'hotelier');
exception when duplicate_object then null; end $$;

do $$ begin
  create type account_status as enum ('active', 'blocked', 'suspended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type property_status as enum ('active', 'blocked', 'suspended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type property_user_role as enum ('owner', 'manager', 'staff');
exception when duplicate_object then null; end $$;

do $$ begin
  create type room_status as enum ('available', 'maintenance', 'out_of_order');
exception when duplicate_object then null; end $$;

do $$ begin
  create type reservation_status as enum ('pending', 'confirmed', 'cancelled', 'checked_in', 'checked_out', 'no_show');
exception when duplicate_object then null; end $$;

do $$ begin
  create type subscription_status as enum ('trialing', 'active', 'past_due', 'cancelled', 'expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type billing_interval as enum ('monthly', 'yearly');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_type as enum ('guest_booking', 'subscription');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_status as enum ('pending', 'paid', 'failed', 'refunded', 'waived');
exception when duplicate_object then null; end $$;

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  phone text,
  platform_role platform_role not null default 'hotelier',
  status account_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text not null default '',
  scope text not null check (scope in ('platform', 'property'))
);

create table if not exists permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  description text not null
);

create table if not exists role_permissions (
  role_id uuid not null references roles(id) on delete cascade,
  permission_id uuid not null references permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table if not exists properties (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text not null default '',
  address text not null default '',
  city text not null default '',
  country text not null default '',
  phone text,
  email text,
  timezone text not null default 'UTC',
  currency text not null default 'USD',
  check_in_time text not null default '15:00',
  check_out_time text not null default '11:00',
  policies text not null default '',
  status property_status not null default 'active',
  widget_settings jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint properties_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint properties_currency_format check (currency ~ '^[A-Z]{3}$')
);

create table if not exists property_users (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role property_user_role not null default 'owner',
  created_at timestamptz not null default now(),
  unique (property_id, user_id)
);

create table if not exists room_categories (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  name text not null,
  description text not null default '',
  max_occupancy integer not null default 2 check (max_occupancy > 0),
  base_price numeric(12,2) not null check (base_price >= 0),
  amenities jsonb not null default '[]'::jsonb,
  images jsonb not null default '[]'::jsonb,
  booking_policy text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, name)
);

create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  category_id uuid not null references room_categories(id) on delete restrict,
  room_number text not null,
  floor text,
  status room_status not null default 'available',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, room_number)
);

create table if not exists room_rates (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  category_id uuid not null references room_categories(id) on delete cascade,
  name text not null,
  price numeric(12,2) not null check (price >= 0),
  start_date date,
  end_date date,
  min_stay integer not null default 1 check (min_stay >= 1),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create table if not exists room_inventory (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  category_id uuid not null references room_categories(id) on delete cascade,
  date date not null,
  total_rooms integer not null default 0 check (total_rooms >= 0),
  available_rooms integer not null default 0 check (available_rooms >= 0),
  price_override numeric(12,2),
  stop_sell boolean not null default false,
  unique (category_id, date),
  check (available_rooms <= total_rooms)
);

create table if not exists reservations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete restrict,
  category_id uuid not null references room_categories(id) on delete restrict,
  room_id uuid references rooms(id) on delete set null,
  confirmation_code text not null unique,
  guest_name text not null,
  guest_email text not null,
  guest_phone text,
  check_in date not null,
  check_out date not null,
  adults integer not null default 1 check (adults > 0),
  children integer not null default 0 check (children >= 0),
  status reservation_status not null default 'confirmed',
  total_amount numeric(12,2) not null check (total_amount >= 0),
  currency text not null default 'USD',
  special_requests text not null default '',
  access_token_hash text not null unique,
  payment_status payment_status not null default 'waived',
  hold_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (check_out > check_in)
);

create table if not exists subscription_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  price_monthly numeric(12,2) not null default 0 check (price_monthly >= 0),
  price_yearly numeric(12,2) not null default 0 check (price_yearly >= 0),
  max_properties integer not null default 1 check (max_properties > 0),
  max_rooms integer not null default 20 check (max_rooms > 0),
  features jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null unique references properties(id) on delete cascade,
  plan_id uuid not null references subscription_plans(id),
  status subscription_status not null default 'trialing',
  billing_interval billing_interval not null default 'monthly',
  current_period_start date not null default current_date,
  current_period_end date not null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_period_end >= current_period_start)
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete set null,
  reservation_id uuid references reservations(id) on delete set null,
  subscription_id uuid references subscriptions(id) on delete set null,
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null default 'USD',
  type payment_type not null,
  status payment_status not null default 'pending',
  provider text,
  provider_ref text,
  created_at timestamptz not null default now()
);

create table if not exists activity_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id) on delete set null,
  property_id uuid references properties(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists email_logs (
  id uuid primary key default gen_random_uuid(),
  to_email text not null,
  subject text not null,
  body text not null,
  status text not null,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_property_users_user on property_users(user_id);
create index if not exists idx_categories_property on room_categories(property_id);
create index if not exists idx_rooms_category on rooms(category_id);
create index if not exists idx_rates_category on room_rates(category_id);
create index if not exists idx_inventory_property_date on room_inventory(property_id, date);
create index if not exists idx_inventory_category_date on room_inventory(category_id, date);
create index if not exists idx_reservations_property on reservations(property_id, check_in);
create index if not exists idx_reservations_email on reservations(guest_email);
create index if not exists idx_reservations_hold on reservations(status, hold_expires_at);
create index if not exists idx_logs_created on activity_logs(created_at desc);
create index if not exists idx_logs_property on activity_logs(property_id, created_at desc);
create index if not exists idx_payments_property on payments(property_id, created_at desc);

drop trigger if exists profiles_updated_at on profiles;
create trigger profiles_updated_at before update on profiles
for each row execute function set_updated_at();

drop trigger if exists properties_updated_at on properties;
create trigger properties_updated_at before update on properties
for each row execute function set_updated_at();

drop trigger if exists categories_updated_at on room_categories;
create trigger categories_updated_at before update on room_categories
for each row execute function set_updated_at();

drop trigger if exists rooms_updated_at on rooms;
create trigger rooms_updated_at before update on rooms
for each row execute function set_updated_at();

drop trigger if exists reservations_updated_at on reservations;
create trigger reservations_updated_at before update on reservations
for each row execute function set_updated_at();

drop trigger if exists subscriptions_updated_at on subscriptions;
create trigger subscriptions_updated_at before update on subscriptions
for each row execute function set_updated_at();

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function handle_new_user();

create or replace function protect_profile_sensitive()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  if new.platform_role is distinct from old.platform_role
     or new.status is distinct from old.status
     or new.email is distinct from old.email then
    raise exception 'forbidden_profile_update';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_sensitive on profiles;
create trigger profiles_protect_sensitive
before update on profiles
for each row execute function protect_profile_sensitive();
