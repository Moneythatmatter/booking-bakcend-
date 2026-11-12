-- Catalog data. The first super admin is created with: npm run seed:admin

insert into roles (key, name, description, scope)
values
  ('super_admin', 'Super Admin', 'Platform operator', 'platform'),
  ('owner', 'Owner', 'Full access to a property', 'property'),
  ('manager', 'Manager', 'Operates a property', 'property'),
  ('staff', 'Staff', 'Reads bookings and guest details', 'property')
on conflict (key) do nothing;

insert into permissions (key, description)
values
  ('property.read', 'View property profile'),
  ('property.update', 'Update property profile'),
  ('rooms.manage', 'Manage room categories and rooms'),
  ('rates.manage', 'Manage prices'),
  ('inventory.manage', 'Manage availability and stop-sell'),
  ('bookings.read', 'View reservations'),
  ('bookings.manage', 'Update reservation status and room assignment'),
  ('guests.read', 'View guest details'),
  ('subscription.read', 'View subscription'),
  ('widget.manage', 'Update booking widget settings'),
  ('platform.manage', 'Manage hoteliers, plans, and subscriptions')
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on (
  (r.key in ('owner', 'manager') and p.key in (
    'property.read', 'property.update', 'rooms.manage', 'rates.manage', 'inventory.manage',
    'bookings.read', 'bookings.manage', 'guests.read', 'subscription.read', 'widget.manage'
  ))
  or (r.key = 'staff' and p.key in ('property.read', 'bookings.read', 'guests.read', 'subscription.read'))
  or (r.key = 'super_admin' and p.key = 'platform.manage')
)
on conflict do nothing;

insert into subscription_plans (name, description, price_monthly, price_yearly, max_properties, max_rooms, features)
values
  (
    'Starter',
    'For an independent hotel',
    49, 490, 1, 20,
    '["Public booking page","Email confirmations","1 property","20 rooms"]'::jsonb
  ),
  (
    'Growth',
    'For a small hotel group',
    99, 990, 3, 80,
    '["Everything in Starter","3 properties","80 rooms"]'::jsonb
  ),
  (
    'Pro',
    'For a growing group',
    199, 1990, 10, 300,
    '["Everything in Growth","10 properties","300 rooms"]'::jsonb
  )
on conflict (name) do nothing;
