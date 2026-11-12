import { env } from "../config/env";
import { supabaseAdmin } from "../config/supabase";
import type { Property, Reservation, RoomCategory, RoomRate } from "../types";
import { assertDateRange, eachNight, todayInTimeZone } from "../utils/dates";
import { AppError, assertNoError, mapDatabaseError } from "../utils/errors";
import { confirmationCode, guestToken, hashToken } from "../utils/tokens";
import { sendReservationEmail } from "./email.service";
import { publicCategoryFields } from "./catalog.service";
import { fieldChanges, logActivity } from "./log.service";
import { createGuestCheckout } from "./payment.service";
import { assertPropertyBookable } from "./property.service";

async function holdExtraRooms(categoryId: string, checkIn: string, checkOut: string, extra: number) {
  const { data, error } = await supabaseAdmin
    .from("room_inventory")
    .select("id, available_rooms")
    .eq("category_id", categoryId)
    .gte("date", checkIn)
    .lt("date", checkOut);
  assertNoError(error);
  const rows = data ?? [];
  if (rows.length === 0 || rows.some((row) => Number(row.available_rooms) < extra)) {
    throw new AppError(409, "Not enough rooms are left for that quantity.", "not_available");
  }
  for (const row of rows) {
    const updated = await supabaseAdmin.from("room_inventory").update({ available_rooms: Number(row.available_rooms) - extra }).eq("id", row.id);
    assertNoError(updated.error);
  }
}

async function releaseExtraRooms(reservation: { category_id: string; check_in: string; check_out: string; special_requests?: string | null }) {
  const match = reservation.special_requests?.match(/Rooms × (\d+)/);
  const extra = match ? Number(match[1]) - 1 : 0;
  if (extra < 1) return;
  const { data, error } = await supabaseAdmin
    .from("room_inventory")
    .select("id, available_rooms, total_rooms")
    .eq("category_id", reservation.category_id)
    .gte("date", reservation.check_in)
    .lt("date", reservation.check_out);
  assertNoError(error);
  for (const row of data ?? []) {
    const next = Math.min(Number(row.total_rooms), Number(row.available_rooms) + extra);
    const updated = await supabaseAdmin.from("room_inventory").update({ available_rooms: next }).eq("id", row.id);
    assertNoError(updated.error);
  }
}

const RESERVATION_COLUMNS =
  "id, property_id, category_id, room_id, confirmation_code, guest_name, guest_email, guest_phone, check_in, check_out, adults, children, status, total_amount, currency, special_requests, payment_status, hold_expires_at, created_at, updated_at";

function rateForDate(rates: RoomRate[], date: string) {
  const matches = rates.filter(
    (rate) => rate.is_active && (!rate.start_date || rate.start_date <= date) && (!rate.end_date || rate.end_date >= date),
  );
  matches.sort((a, b) => (b.start_date ?? "").localeCompare(a.start_date ?? ""));
  return matches[0] ?? null;
}

function priceForNight(category: RoomCategory, rates: RoomRate[], row: { price_override: number | null } | undefined, date: string) {
  if (row?.price_override != null) return Number(row.price_override);
  const rate = rateForDate(rates, date);
  if (rate) return Number(rate.price);
  return Number(category.base_price);
}

function publicWidgetSettings(settings: Property["widget_settings"]) {
  const { desk_access: _deskAccess, ...rest } = settings ?? {};
  return rest;
}

export function publicProperty(property: Property) {
  return {
    id: property.id,
    name: property.name,
    slug: property.slug,
    description: property.description,
    address: property.address,
    city: property.city,
    country: property.country,
    phone: property.phone,
    email: property.email,
    timezone: property.timezone,
    currency: property.currency,
    check_in_time: property.check_in_time,
    check_out_time: property.check_out_time,
    policies: property.policies,
    cover_image_url: property.cover_image_url || property.widget_settings?.cover_image_url || null,
    widget_settings: publicWidgetSettings(property.widget_settings),
    payments_enabled: env.paymentsEnabled,
  };
}

async function propertyBySlug(slug: string) {
  const { data, error } = await supabaseAdmin.from("properties").select("*").eq("slug", slug).maybeSingle();
  assertNoError(error);
  if (!data) throw new AppError(404, "Hotel not found.", "not_found");
  return data as Property;
}

export async function getPublicProperty(slug: string) {
  const property = await propertyBySlug(slug);
  await assertPropertyBookable(property);
  const { data: categories, error } = await supabaseAdmin
    .from("room_categories")
    .select("id, name, description, max_occupancy, base_price, amenities, images, booking_policy")
    .eq("property_id", property.id)
    .eq("is_active", true)
    .order("base_price");
  assertNoError(error);
  return { property: publicProperty(property), categories: categories ?? [] };
}

export async function searchAvailability(slug: string, checkIn: string, checkOut: string, guests: number) {
  const property = await propertyBySlug(slug);
  await assertPropertyBookable(property);
  const nights = assertDateRange(checkIn, checkOut);
  if (checkIn < todayInTimeZone(property.timezone)) {
    throw new AppError(400, "Check-in cannot be in the past.", "invalid_dates");
  }

  await supabaseAdmin.rpc("release_expired_holds");

  const { data: categories, error: categoryError } = await supabaseAdmin
    .from("room_categories")
    .select("*")
    .eq("property_id", property.id)
    .eq("is_active", true)
    .gte("max_occupancy", guests);
  assertNoError(categoryError);

  const categoryRows = (categories ?? []) as RoomCategory[];
  const ids = categoryRows.map((category) => category.id);
  if (!ids.length) {
    return { property: publicProperty(property), nights, payments_enabled: env.paymentsEnabled, categories: [] };
  }

  const { data: inventory, error: inventoryError } = await supabaseAdmin
    .from("room_inventory")
    .select("*")
    .in("category_id", ids)
    .gte("date", checkIn)
    .lt("date", checkOut);
  assertNoError(inventoryError);

  const { data: rates, error: rateError } = await supabaseAdmin.from("room_rates").select("*").in("category_id", ids).eq("is_active", true);
  assertNoError(rateError);

  const nightList = eachNight(checkIn, checkOut);
  const results = categoryRows.map((category) => {
    const rows = (inventory ?? []).filter((row) => row.category_id === category.id);
    const rateRows = (rates ?? []) as RoomRate[];
    const categoryRates = rateRows.filter((rate) => rate.category_id === category.id);
    const byDate = new Map(rows.map((row) => [row.date, row]));
    let available = true;
    let reason = "";
    let roomsLeft = Number.POSITIVE_INFINITY;
    let total = 0;

    for (const night of nightList) {
      const row = byDate.get(night);
      if (!row || row.stop_sell || Number(row.available_rooms) < 1) {
        available = false;
        roomsLeft = 0;
        reason = !row ? "Not open for these dates" : row.stop_sell ? "Closed for these dates" : "Sold out for these dates";
      } else {
        roomsLeft = Math.min(roomsLeft, Number(row.available_rooms));
      }
      total += priceForNight(category, categoryRates, row, night);
    }

    const stayRate = rateForDate(categoryRates, checkIn);
    if (available && stayRate && stayRate.min_stay > nights) {
      available = false;
      reason = `Minimum stay is ${stayRate.min_stay} nights`;
    }

    return {
      id: category.id,
      name: category.name,
      description: category.description,
      max_occupancy: category.max_occupancy,
      ...publicCategoryFields(category),
      images: category.images,
      booking_policy: category.booking_policy,
      available,
      reason,
      rooms_left: available ? roomsLeft : 0,
      nights,
      total_price: Math.round(total * 100) / 100,
      average_nightly: Math.round((total / nights) * 100) / 100,
      currency: property.currency,
    };
  });

  return { property: publicProperty(property), nights, payments_enabled: env.paymentsEnabled, categories: results };
}

async function assertMinStay(categoryId: string, checkIn: string, nights: number) {
  const { data, error } = await supabaseAdmin.from("room_rates").select("*").eq("category_id", categoryId).eq("is_active", true);
  assertNoError(error);
  const rate = rateForDate((data ?? []) as RoomRate[], checkIn);
  if (rate && rate.min_stay > nights) {
    throw new AppError(400, `Minimum stay is ${rate.min_stay} nights.`, "min_stay");
  }
}

export async function createPublicReservation(slug: string, input: {
  category_id: string;
  guest_name: string;
  guest_email: string;
  guest_phone: string;
  check_in: string;
  check_out: string;
  adults: number;
  children: number;
  special_requests: string;
  pay_now: boolean;
  rooms?: number;
  extras?: Array<{ id: string; quantity: number }>;
}) {
  const property = await propertyBySlug(slug);
  await assertPropertyBookable(property);
  const nights = assertDateRange(input.check_in, input.check_out);
  if (input.check_in < todayInTimeZone(property.timezone)) {
    throw new AppError(400, "Check-in cannot be in the past.", "invalid_dates");
  }
  if (input.adults + input.children < 1) {
    throw new AppError(400, "At least one guest is required.", "validation_error");
  }
  if (input.pay_now && !env.paymentsEnabled) {
    throw new AppError(400, "Online payment is not available. Choose pay at the property.", "payments_disabled");
  }

  const { data: category, error: categoryError } = await supabaseAdmin
    .from("room_categories")
    .select("id, property_id")
    .eq("id", input.category_id)
    .eq("property_id", property.id)
    .eq("is_active", true)
    .maybeSingle();
  assertNoError(categoryError);
  if (!category) throw new AppError(404, "Room category not found.", "not_found");
  await assertMinStay(category.id, input.check_in, nights);

  const token = guestToken();
  const tokenHash = hashToken(token);
  let reservation: Reservation | null = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await supabaseAdmin.rpc("create_reservation", {
      p_property_id: property.id,
      p_category_id: category.id,
      p_guest_name: input.guest_name,
      p_guest_email: input.guest_email,
      p_guest_phone: input.guest_phone,
      p_check_in: input.check_in,
      p_check_out: input.check_out,
      p_adults: input.adults,
      p_children: input.children,
      p_special_requests: input.special_requests,
      p_token_hash: tokenHash,
      p_confirmation_code: confirmationCode(),
      p_payment_status: input.pay_now ? "pending" : "waived",
      p_status: input.pay_now ? "pending" : "confirmed",
      p_hold_minutes: 30,
    });
    if (!error) {
      reservation = (Array.isArray(data) ? data[0] : data) as Reservation;
      break;
    }
    if (error.code === "23505" && (error.message ?? "").includes("confirmation_code")) continue;
    throw mapDatabaseError(error) ?? new AppError(400, error.message);
  }

  if (!reservation) throw new AppError(409, "Could not create the reservation. Try again.", "conflict");

  try {
    const rooms = Math.max(1, input.rooms ?? 1);
    if (rooms > 1) {
      await holdExtraRooms(category.id, input.check_in, input.check_out, rooms - 1);
      const roomTotal = Math.round(Number(reservation.total_amount) * rooms * 100) / 100;
      const note = [`Rooms × ${rooms}`, reservation.special_requests].filter(Boolean).join("\n");
      const scaled = await supabaseAdmin.from("reservations").update({ total_amount: roomTotal, special_requests: note }).eq("id", reservation.id).select(RESERVATION_COLUMNS).single();
      assertNoError(scaled.error);
      reservation = scaled.data as Reservation;
    }
    const catalog = (property.widget_settings?.extras ?? []).filter((item) => item.is_active);
    let extraTotal = 0;
    const lines: string[] = [];
    for (const pick of input.extras ?? []) {
      const extra = catalog.find((item) => item.id === pick.id);
      if (!extra) throw new AppError(400, "That extra is no longer available.", "validation");
      extraTotal += extra.charge === "per_stay" ? Number(extra.price) * pick.quantity : Number(extra.price) * pick.quantity * nights;
      lines.push(`${extra.name} × ${pick.quantity}`);
    }
    if (lines.length) {
      const total = Math.round((Number(reservation.total_amount) + extraTotal) * 100) / 100;
      const note = [reservation.special_requests, `Extras: ${lines.join(", ")}`].filter(Boolean).join("\n");
      const updated = await supabaseAdmin.from("reservations").update({ total_amount: total, special_requests: note }).eq("id", reservation.id).select(RESERVATION_COLUMNS).single();
      assertNoError(updated.error);
      reservation = updated.data as Reservation;
    }
  } catch (error) {
    await releaseExtraRooms(reservation);
    await supabaseAdmin.rpc("cancel_reservation", { p_id: reservation.id });
    throw error;
  }

  await logActivity({
    propertyId: property.id,
    action: "reservation.created",
    entityType: "reservation",
    entityId: reservation.id,
    metadata: { confirmation_code: reservation.confirmation_code, status: reservation.status },
  });

  if (input.pay_now) {
    try {
      const checkout = await createGuestCheckout(reservation, property, token);
      await sendReservationEmail({
        kind: "hold",
        to: reservation.guest_email,
        guestName: reservation.guest_name,
        propertyName: property.name,
        confirmationCode: reservation.confirmation_code,
        checkIn: reservation.check_in,
        checkOut: reservation.check_out,
        total: String(reservation.total_amount),
        currency: reservation.currency,
        token,
        checkoutUrl: checkout.url,
      });
      return { reservation: stripSecret(reservation), access_token: token, checkout_url: checkout.url };
    } catch (error) {
      await releaseExtraRooms(reservation);
      await supabaseAdmin.rpc("cancel_reservation", { p_id: reservation.id });
      throw error;
    }
  }

  await sendReservationEmail({
    kind: "confirmed",
    to: reservation.guest_email,
    guestName: reservation.guest_name,
    propertyName: property.name,
    confirmationCode: reservation.confirmation_code,
    checkIn: reservation.check_in,
    checkOut: reservation.check_out,
    total: String(reservation.total_amount),
    currency: reservation.currency,
    token,
  });

  return { reservation: stripSecret(reservation), access_token: token, checkout_url: null };
}

function stripSecret<T extends { access_token_hash?: string }>(reservation: T) {
  const copy = { ...reservation };
  delete copy.access_token_hash;
  return copy;
}

export async function getGuestBooking(token: string) {
  const { data, error } = await supabaseAdmin
    .from("reservations")
    .select(`${RESERVATION_COLUMNS}, property:properties(name, slug, city, country, phone, email, check_in_time, check_out_time, policies, currency), category:room_categories(name, booking_policy), room:rooms(room_number)`)
    .eq("access_token_hash", hashToken(token))
    .maybeSingle();
  assertNoError(error);
  if (!data) throw new AppError(404, "Booking not found.", "not_found");
  return data;
}

export async function listReservations(propertyId: string, query: { status?: string; q?: string; limit: number; offset: number }) {
  let request = supabaseAdmin
    .from("reservations")
    .select(`${RESERVATION_COLUMNS}, category:room_categories(name), room:rooms(room_number)`, { count: "exact" })
    .eq("property_id", propertyId)
    .order("created_at", { ascending: false })
    .range(query.offset, query.offset + query.limit - 1);

  if (query.status) request = request.eq("status", query.status);
  if (query.q) {
    const safe = query.q.replace(/[%_,.()]/g, "").trim();
    if (safe) {
      request = request.or(`guest_name.ilike.%${safe}%,guest_email.ilike.%${safe}%,confirmation_code.ilike.%${safe}%`);
    }
  }

  const { data, error, count } = await request;
  assertNoError(error);
  return { bookings: data ?? [], count: count ?? 0 };
}

export async function updateReservation(
  property: Property,
  bookingId: string,
  input: { status?: string; room_id?: string | null },
  actorId: string,
) {
  const { data: existing, error } = await supabaseAdmin
    .from("reservations")
    .select(RESERVATION_COLUMNS)
    .eq("id", bookingId)
    .eq("property_id", property.id)
    .maybeSingle();
  assertNoError(error);
  if (!existing) throw new AppError(404, "Reservation not found.", "not_found");

  if (input.status === "cancelled") {
    await releaseExtraRooms(existing as Reservation);
    const { data, error: cancelError } = await supabaseAdmin.rpc("cancel_reservation", { p_id: bookingId });
    assertNoError(cancelError);
    await logActivity({
      actorId,
      propertyId: property.id,
      action: "reservation.cancelled",
      entityType: "reservation",
      entityId: bookingId,
    });
    return stripSecret((Array.isArray(data) ? data[0] : data) as Reservation);
  }

  if (input.room_id) {
    const { data: room, error: roomError } = await supabaseAdmin
      .from("rooms")
      .select("id, category_id, status")
      .eq("id", input.room_id)
      .eq("property_id", property.id)
      .maybeSingle();
    assertNoError(roomError);
    if (!room || room.category_id !== existing.category_id) {
      throw new AppError(400, "That room is not in this reservation's category.", "validation_error");
    }
    if (room.status !== "available") {
      throw new AppError(409, "That room is not available to assign.", "conflict");
    }
    const { data: conflicts, error: conflictError } = await supabaseAdmin
      .from("reservations")
      .select("id")
      .eq("room_id", input.room_id)
      .in("status", ["pending", "confirmed", "checked_in"])
      .lt("check_in", existing.check_out)
      .gt("check_out", existing.check_in)
      .neq("id", existing.id);
    assertNoError(conflictError);
    if (conflicts?.length) {
      throw new AppError(409, "That room is already assigned for overlapping dates.", "conflict");
    }
  }

  if (input.status) {
    const allowed: Record<string, string[]> = {
      pending: ["confirmed"],
      confirmed: ["checked_in", "no_show"],
      checked_in: ["checked_out"],
    };
    if (!allowed[existing.status]?.includes(input.status)) {
      throw new AppError(409, `Cannot change a ${existing.status} reservation to ${input.status}.`, "conflict");
    }
  }

  const patch: Record<string, unknown> = {};
  if (input.status) patch.status = input.status;
  if (input.room_id !== undefined) patch.room_id = input.room_id;
  if (!Object.keys(patch).length) return existing;

  const { data, error: updateError } = await supabaseAdmin
    .from("reservations")
    .update(patch)
    .eq("id", bookingId)
    .eq("property_id", property.id)
    .select(RESERVATION_COLUMNS)
    .single();
  assertNoError(updateError);
  await logActivity({
    actorId,
    propertyId: property.id,
    action: "reservation.updated",
    entityType: "reservation",
    entityId: bookingId,
    metadata: {
      confirmation_code: existing.confirmation_code,
      changes: fieldChanges(existing, { ...existing, ...patch }, Object.keys(patch)),
    },
  });
  return data;
}

export async function listGuests(propertyId: string) {
  const { data, error } = await supabaseAdmin
    .from("reservations")
    .select("guest_name, guest_email, guest_phone, check_in, status")
    .eq("property_id", propertyId)
    .order("check_in", { ascending: false })
    .limit(1000);
  assertNoError(error);

  const guests = new Map<string, { guest_name: string; guest_email: string; guest_phone: string | null; stays: number; last_stay: string }>();
  for (const row of data ?? []) {
    const key = row.guest_email.toLowerCase();
    const current = guests.get(key);
    if (!current) {
      guests.set(key, {
        guest_name: row.guest_name,
        guest_email: row.guest_email,
        guest_phone: row.guest_phone,
        stays: 1,
        last_stay: row.check_in,
      });
    } else {
      current.stays += 1;
      if (row.check_in > current.last_stay) {
        current.last_stay = row.check_in;
        current.guest_name = row.guest_name;
        current.guest_phone = row.guest_phone;
      }
    }
  }
  return Array.from(guests.values());
}
