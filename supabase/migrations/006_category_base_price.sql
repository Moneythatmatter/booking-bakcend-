-- Seasonal rates need at least one date; otherwise booking uses room_categories.base_price.

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
        and (start_date is not null or end_date is not null)
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