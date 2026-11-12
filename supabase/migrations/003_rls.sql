-- Row Level Security is defense in depth.
-- The Express API uses the service role and enforces authorization itself.
-- These policies protect the database if a user JWT is ever used directly.

create or replace function is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and platform_role = 'super_admin'
      and status = 'active'
  );
$$;

create or replace function is_property_member(p_property uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from property_users
    where property_id = p_property and user_id = auth.uid()
  );
$$;

revoke all on function is_super_admin() from public, anon;
revoke all on function is_property_member(uuid) from public, anon;
grant execute on function is_super_admin() to authenticated, service_role;
grant execute on function is_property_member(uuid) to authenticated, service_role;

alter table profiles enable row level security;
alter table roles enable row level security;
alter table permissions enable row level security;
alter table role_permissions enable row level security;
alter table properties enable row level security;
alter table property_users enable row level security;
alter table room_categories enable row level security;
alter table rooms enable row level security;
alter table room_rates enable row level security;
alter table room_inventory enable row level security;
alter table reservations enable row level security;
alter table subscription_plans enable row level security;
alter table subscriptions enable row level security;
alter table payments enable row level security;
alter table activity_logs enable row level security;
alter table email_logs enable row level security;

alter table profiles force row level security;
alter table roles force row level security;
alter table permissions force row level security;
alter table role_permissions force row level security;
alter table properties force row level security;
alter table property_users force row level security;
alter table room_categories force row level security;
alter table rooms force row level security;
alter table room_rates force row level security;
alter table room_inventory force row level security;
alter table reservations force row level security;
alter table subscription_plans force row level security;
alter table subscriptions force row level security;
alter table payments force row level security;
alter table activity_logs force row level security;
alter table email_logs force row level security;

drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles
for select to authenticated
using (id = auth.uid() or is_super_admin());

drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists roles_select on roles;
create policy roles_select on roles for select to authenticated using (true);

drop policy if exists permissions_select on permissions;
create policy permissions_select on permissions for select to authenticated using (true);

drop policy if exists role_permissions_select on role_permissions;
create policy role_permissions_select on role_permissions for select to authenticated using (true);

drop policy if exists plans_select on subscription_plans;
create policy plans_select on subscription_plans for select to authenticated using (true);

drop policy if exists properties_select on properties;
create policy properties_select on properties
for select to authenticated
using (is_super_admin() or is_property_member(id));

drop policy if exists property_users_select on property_users;
create policy property_users_select on property_users
for select to authenticated
using (is_super_admin() or user_id = auth.uid() or is_property_member(property_id));

drop policy if exists categories_select on room_categories;
create policy categories_select on room_categories
for select to authenticated
using (is_super_admin() or is_property_member(property_id));

drop policy if exists rooms_select on rooms;
create policy rooms_select on rooms
for select to authenticated
using (is_super_admin() or is_property_member(property_id));

drop policy if exists rates_select on room_rates;
create policy rates_select on room_rates
for select to authenticated
using (is_super_admin() or is_property_member(property_id));

drop policy if exists inventory_select on room_inventory;
create policy inventory_select on room_inventory
for select to authenticated
using (is_super_admin() or is_property_member(property_id));

drop policy if exists reservations_select on reservations;
create policy reservations_select on reservations
for select to authenticated
using (is_super_admin() or is_property_member(property_id));

drop policy if exists subscriptions_select on subscriptions;
create policy subscriptions_select on subscriptions
for select to authenticated
using (is_super_admin() or is_property_member(property_id));

drop policy if exists payments_select on payments;
create policy payments_select on payments
for select to authenticated
using (is_super_admin() or (property_id is not null and is_property_member(property_id)));

drop policy if exists logs_select on activity_logs;
create policy logs_select on activity_logs
for select to authenticated
using (
  is_super_admin()
  or (property_id is not null and is_property_member(property_id))
);

-- email_logs has RLS enabled and no policies, so only the service role can read it.
-- Writes for operational tables go through the Express service role, which bypasses RLS.
-- There are intentionally no anon policies: public booking uses the API.
