alter table properties add column if not exists cover_image_url text;

alter table property_users add column if not exists access_role text;
alter table property_users add column if not exists page_access jsonb not null default '{}'::jsonb;

alter table profiles add column if not exists access_role text;
alter table profiles add column if not exists page_access jsonb not null default '{}'::jsonb;

alter table property_users drop constraint if exists property_users_access_role_check;
alter table property_users
  add constraint property_users_access_role_check
  check (access_role is null or access_role in ('administrator', 'user'));

alter table profiles drop constraint if exists profiles_access_role_check;
alter table profiles
  add constraint profiles_access_role_check
  check (access_role is null or access_role in ('administrator', 'user'));
