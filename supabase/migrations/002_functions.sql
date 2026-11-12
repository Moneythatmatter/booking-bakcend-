-- Atomic inventory and reservation operations.
-- Lock order is always: room category, then reservation rows, then inventory rows.

create or replace function release_expired_holds()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec reservations;
begin
  for rec in
    select * from reservations
    where status = 'pending'
      and hold_expires_at is not null
      and hold_expires_at < now()
    for update skip locked
  loop
    update room_inventory
      set available_rooms = least(total_rooms, available_rooms + 1)
      where category_id = rec.category_id
        and date >= rec.check_in
        and date < rec.check_out;
    update reservations
      set status = 'cancelled'
      where id = rec.id;
  end loop;
end;
$$;

create or replace function sync_room_inventory(p_category uuid, p_days integer default 540)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property uuid;
  v_total integer;
  d date;
  v_booked integer;
  v_end date := current_date + p_days;
begin
  perform 1 from room_categories where id = p_category for update;
  select property_id into v_property from room_categories where id = p_category;
  if v_property is null then
    raise exception 'category_unavailable';
  end if;

  select count(*) into v_total
  from rooms
  where category_id = p_category and status = 'available';

  for d in select generate_series(current_date, v_end, interval '1 day')::date
  loop
    select count(*) into v_booked
    from reservations r
    where r.category_id = p_category
      and r.status in ('pending', 'confirmed', 'checked_in')
      and r.check_in <= d
      and r.check_out > d;

    insert into room_inventory (property_id, category_id, date, total_rooms, available_rooms)
    values (v_property, p_category, d, v_total, greatest(v_total - v_booked, 0))
    on conflict (category_id, date) do update
      set total_rooms = excluded.total_rooms,
          available_rooms = greatest(excluded.available_rooms, 0);
  end loop;
end;
$$;

create or replace function create_reservation(
  p_property_id uuid,
  p_category_id uuid,
  p_guest_name text,
  p_guest_email text,
  p_guest_phone text,
  p_check_in date,
  p_check_out date,
  p_adults integer,
  p_children integer,
  p_special_requests text,
  p_token_hash text,
  p_confirmation_code text,
  p_payment_status payment_status,
  p_status reservation_status,
  p_hold_minutes integer
)
returns reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_currency text;
  v_base numeric(12,2);
  v_occupancy integer;
  v_total numeric(12,2) := 0;
  v_price numeric(12,2);
  v_nights integer;
  v_locked integer := 0;
  v_inv room_inventory;
  v_hold reservations;
  result reservations;
begin
  if p_check_out <= p_check_in then
    raise exception 'invalid_dates';
  end if;

  perform 1 from room_categories where id = p_category_id and property_id = p_property_id for update;

  for v_hold in
    select * from reservations
    where category_id = p_category_id
      and status = 'pending'
      and hold_expires_at is not null
      and hold_expires_at < now()
    for update
  loop
    update room_inventory
      set available_rooms = least(total_rooms, available_rooms + 1)
      where category_id = p_category_id
        and date >= v_hold.check_in
        and date < v_hold.check_out;
    update reservations set status = 'cancelled' where id = v_hold.id;
  end loop;

  select currency into v_currency
  from properties
  where id = p_property_id and status = 'active';
  if v_currency is null then
    raise exception 'property_unavailable';
  end if;

  if not exists (
    select 1 from subscriptions s
    where s.property_id = p_property_id
      and s.status in ('trialing', 'active')
      and s.current_period_end >= current_date
  ) then
    raise exception 'subscription_inactive';
  end if;

  select base_price, max_occupancy into v_base, v_occupancy
  from room_categories
  where id = p_category_id and property_id = p_property_id and is_active = true;
  if v_base is null then
    raise exception 'category_unavailable';
  end if;

  if p_adults + coalesce(p_children, 0) > v_occupancy then
    raise exception 'occupancy_exceeded';
  end if;

  v_nights := p_check_out - p_check_in;

  for v_inv in
    select * from room_inventory
    where category_id = p_category_id
      and date >= p_check_in
      and date < p_check_out
    order by date
    for update
  loop
    if v_inv.stop_sell or v_inv.available_rooms < 1 then
      raise exception 'not_available';
    end if;

    select coalesce(v_inv.price_override, (
      select price from room_rates
      where category_id = p_category_id
        and is_active = true
        and (start_date is null or start_date <= v_inv.date)
        and (end_date is null or end_date >= v_inv.date)
      order by start_date desc nulls last
      limit 1
    ), v_base) into v_price;

    v_total := v_total + v_price;
    v_locked := v_locked + 1;
  end loop;

  if v_locked <> v_nights then
    raise exception 'not_available';
  end if;

  update room_inventory
    set available_rooms = available_rooms - 1
    where category_id = p_category_id
      and date >= p_check_in
      and date < p_check_out;

  insert into reservations (
    property_id, category_id, confirmation_code, guest_name, guest_email, guest_phone,
    check_in, check_out, adults, children, status, total_amount, currency,
    special_requests, access_token_hash, payment_status, hold_expires_at
  ) values (
    p_property_id, p_category_id, p_confirmation_code, p_guest_name, p_guest_email, nullif(p_guest_phone, ''),
    p_check_in, p_check_out, p_adults, coalesce(p_children, 0), p_status, v_total, v_currency,
    coalesce(p_special_requests, ''), p_token_hash, p_payment_status,
    case when p_status = 'pending' then now() + make_interval(mins => p_hold_minutes) else null end
  ) returning * into result;

  return result;
end;
$$;

create or replace function cancel_reservation(p_id uuid)
returns reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category uuid;
  result reservations;
begin
  select category_id into v_category from reservations where id = p_id;
  if v_category is null then
    raise exception 'not_available';
  end if;

  perform 1 from room_categories where id = v_category for update;
  select * into result from reservations where id = p_id for update;

  if result.status not in ('pending', 'confirmed') then
    raise exception 'cannot_cancel';
  end if;

  update room_inventory
    set available_rooms = least(total_rooms, available_rooms + 1)
    where category_id = result.category_id
      and date >= result.check_in
      and date < result.check_out;

  update reservations
    set status = 'cancelled', hold_expires_at = null
    where id = p_id
    returning * into result;

  return result;
end;
$$;

create or replace function property_dashboard(p_property uuid, p_today date)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'arrivals_today', (
      select count(*) from reservations
      where property_id = p_property and check_in = p_today and status in ('confirmed', 'checked_in')
    ),
    'departures_today', (
      select count(*) from reservations
      where property_id = p_property and check_out = p_today and status in ('confirmed', 'checked_in', 'checked_out')
    ),
    'in_house', (
      select count(*) from reservations
      where property_id = p_property and check_in <= p_today and check_out > p_today and status in ('confirmed', 'checked_in')
    ),
    'upcoming', (
      select count(*) from reservations
      where property_id = p_property and check_in > p_today and status in ('pending', 'confirmed')
    ),
    'month_revenue', (
      select coalesce(sum(total_amount), 0) from reservations
      where property_id = p_property
        and status not in ('cancelled', 'pending')
        and created_at >= date_trunc('month', now())
    ),
    'occupancy_today', (
      select case when coalesce(sum(total_rooms), 0) = 0 then 0
        else round((100.0 * sum(total_rooms - available_rooms) / sum(total_rooms))::numeric, 1)
      end
      from room_inventory
      where property_id = p_property and date = p_today
    ),
    'open_bookings', (
      select count(*) from reservations
      where property_id = p_property and status in ('pending', 'confirmed', 'checked_in')
    )
  );
$$;

create or replace function platform_stats()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'users', (select count(*) from profiles),
    'hoteliers', (select count(*) from profiles where platform_role = 'hotelier'),
    'hotels', (select count(*) from properties),
    'bookings', (select count(*) from reservations),
    'active_subscriptions', (
      select count(*) from subscriptions
      where status in ('trialing', 'active') and current_period_end >= current_date
    ),
    'subscription_revenue', (
      select coalesce(sum(amount), 0) from payments where type = 'subscription' and status = 'paid'
    )
  );
$$;

create or replace function platform_reports()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'bookings_by_status', (
      select coalesce(json_object_agg(status, total), '{}'::json)
      from (select status::text as status, count(*) as total from reservations group by status) s
    ),
    'properties_by_status', (
      select coalesce(json_object_agg(status, total), '{}'::json)
      from (select status::text as status, count(*) as total from properties group by status) s
    ),
    'subscriptions_by_status', (
      select coalesce(json_object_agg(status, total), '{}'::json)
      from (select status::text as status, count(*) as total from subscriptions group by status) s
    ),
    'monthly', (
      select coalesce(json_agg(row_to_json(m) order by m.month), '[]'::json)
      from (
        select to_char(date_trunc('month', created_at), 'YYYY-MM') as month,
               count(*) filter (where status <> 'cancelled') as bookings,
               coalesce(sum(total_amount) filter (where status not in ('cancelled', 'pending')), 0) as guest_volume
        from reservations
        where created_at >= date_trunc('month', now()) - interval '5 months'
        group by 1
      ) m
    ),
    'subscription_revenue', (
      select coalesce(sum(amount), 0) from payments where type = 'subscription' and status = 'paid'
    ),
    'guest_payment_volume', (
      select coalesce(sum(amount), 0) from payments where type = 'guest_booking' and status = 'paid'
    )
  );
$$;

revoke all on function release_expired_holds() from public, anon, authenticated;
revoke all on function sync_room_inventory(uuid, integer) from public, anon, authenticated;
revoke all on function create_reservation(uuid, uuid, text, text, text, date, date, integer, integer, text, text, text, payment_status, reservation_status, integer) from public, anon, authenticated;
revoke all on function cancel_reservation(uuid) from public, anon, authenticated;
revoke all on function property_dashboard(uuid, date) from public, anon, authenticated;
revoke all on function platform_stats() from public, anon, authenticated;
revoke all on function platform_reports() from public, anon, authenticated;

grant execute on function release_expired_holds() to service_role;
grant execute on function sync_room_inventory(uuid, integer) to service_role;
grant execute on function create_reservation(uuid, uuid, text, text, text, date, date, integer, integer, text, text, text, payment_status, reservation_status, integer) to service_role;
grant execute on function cancel_reservation(uuid) to service_role;
grant execute on function property_dashboard(uuid, date) to service_role;
grant execute on function platform_stats() to service_role;
grant execute on function platform_reports() to service_role;
