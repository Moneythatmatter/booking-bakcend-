import { randomUUID } from "crypto";
import { supabaseAdmin } from "../config/supabase";
import type { Property, RoomCategory, RoomRate, StayExtra } from "../types";
import { assertNoError, AppError } from "../utils/errors";
import { fieldChanges, logActivity } from "./log.service";
import { assertOperational, getSubscription } from "./property.service";

interface CategoryInput {
  name: string;
  description?: string;
  max_occupancy: number;
  base_price: number;
  amenities?: string[];
  images?: string[];
  booking_policy?: string;
  is_active?: boolean;
  size_sqft?: number | null;
  beds?: string;
  original_price?: number | null;
  rate_plan?: string;
  rate_plan_note?: string;
  refundable?: boolean;
  room_count?: number;
}

function unpackDetails(amenities: unknown) {
  if (Array.isArray(amenities)) {
    return { items: amenities.map(String), size_sqft: null as number | null, beds: "", original_price: null as number | null, rate_plan: "Room only", rate_plan_note: "", refundable: true, room_count: 0 };
  }
  const record = (amenities ?? {}) as Record<string, unknown>;
  return {
    items: Array.isArray(record.items) ? record.items.map(String) : [],
    size_sqft: record.size_sqft == null ? null : Number(record.size_sqft),
    beds: String(record.beds ?? ""),
    original_price: record.original_price == null ? null : Number(record.original_price),
    rate_plan: String(record.rate_plan ?? "Room only"),
    rate_plan_note: String(record.rate_plan_note ?? ""),
    refundable: record.refundable !== false,
    room_count: Number(record.room_count ?? 0),
  };
}

export function publicCategoryFields(category: RoomCategory) {
  const details = unpackDetails(category.amenities);
  return {
    amenities: details.items,
    size_sqft: details.size_sqft,
    beds: details.beds,
    original_price: details.original_price,
    rate_plan: details.rate_plan,
    rate_plan_note: details.rate_plan_note,
    refundable: details.refundable,
  };
}

function presentCategory(row: RoomCategory, roomCount?: number) {
  const details = unpackDetails(row.amenities);
  return {
    ...row,
    amenities: details.items,
    size_sqft: details.size_sqft,
    beds: details.beds,
    original_price: details.original_price,
    rate_plan: details.rate_plan,
    rate_plan_note: details.rate_plan_note,
    refundable: details.refundable,
    room_count: details.room_count || roomCount || 0,
  };
}

function packAmenities(input: CategoryInput) {
  return {
    items: input.amenities ?? [],
    size_sqft: input.size_sqft || null,
    beds: input.beds ?? "",
    original_price: input.original_price || null,
    rate_plan: input.rate_plan || "Room only",
    rate_plan_note: input.rate_plan_note ?? "",
    refundable: input.refundable !== false,
    room_count: input.room_count ?? 1,
  };
}

async function uploadRoomPhoto(propertyId: string, dataUrl: string) {
  const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!match) throw new AppError(400, "Upload a JPEG or PNG image.", "validation");
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (buffer.length < 32 || buffer.length > 1_500_000) throw new AppError(400, "Use an image under 1.5 MB.", "validation");
  const bucket = supabaseAdmin.storage.from("property-covers");
  const existing = await supabaseAdmin.storage.getBucket("property-covers");
  if (!existing.data) {
    const created = await supabaseAdmin.storage.createBucket("property-covers", { public: true });
    if (created.error && !/already exists/i.test(created.error.message)) throw new AppError(500, created.error.message, "storage_error");
  }
  const path = `${propertyId}/rooms/${randomUUID()}.${match[1] === "image/png" ? "png" : "jpg"}`;
  const uploaded = await bucket.upload(path, buffer, { contentType: match[1], upsert: true });
  if (uploaded.error) throw new AppError(500, uploaded.error.message, "storage_error");
  return bucket.getPublicUrl(path).data.publicUrl;
}

async function publishImages(propertyId: string, images: string[] = []) {
  const urls: string[] = [];
  for (const image of images) {
    if (image.startsWith("data:")) urls.push(await uploadRoomPhoto(propertyId, image));
    else if (/^https?:\/\//.test(image)) urls.push(image);
  }
  return urls;
}

async function syncCategoryRooms(property: Property, categoryId: string, count: number) {
  const { data, error } = await supabaseAdmin.from("rooms").select("id, room_number").eq("category_id", categoryId).order("room_number");
  assertNoError(error);
  const existing = data ?? [];
  if (existing.length < count) {
    const subscription = await assertOperational(property);
    const { count: propertyRooms, error: countError } = await supabaseAdmin.from("rooms").select("id", { count: "exact", head: true }).eq("property_id", property.id);
    assertNoError(countError);
    if ((propertyRooms ?? 0) + (count - existing.length) > subscription.plan.max_rooms) {
      throw new AppError(402, `The ${subscription.plan.name} plan allows ${subscription.plan.max_rooms} rooms.`, "plan_limit");
    }
    const rows = Array.from({ length: count - existing.length }, (_, index) => ({
      property_id: property.id,
      category_id: categoryId,
      room_number: `${categoryId.slice(0, 8)}-${existing.length + index + 1}`,
      status: "available",
      notes: "",
    }));
    const inserted = await supabaseAdmin.from("rooms").insert(rows);
    assertNoError(inserted.error);
  } else if (existing.length > count) {
    const extra = existing.slice(count);
    for (const room of extra) {
      const reserved = await supabaseAdmin.from("reservations").select("id", { count: "exact", head: true }).eq("room_id", room.id);
      if ((reserved.count ?? 0) > 0) continue;
      const removed = await supabaseAdmin.from("rooms").delete().eq("id", room.id);
      assertNoError(removed.error);
    }
  }
  await syncInventory(categoryId);
}

async function syncInventory(categoryId: string) {
  const { error } = await supabaseAdmin.rpc("sync_room_inventory", { p_category: categoryId, p_days: 540 });
  assertNoError(error);
}

async function categoryForProperty(propertyId: string, categoryId: string) {
  const { data, error } = await supabaseAdmin
    .from("room_categories")
    .select("*")
    .eq("id", categoryId)
    .eq("property_id", propertyId)
    .maybeSingle();
  assertNoError(error);
  if (!data) throw new AppError(404, "Room category not found.", "not_found");
  return data as RoomCategory;
}

export async function listCategories(propertyId: string) {
  const { data, error } = await supabaseAdmin
    .from("room_categories")
    .select("*")
    .eq("property_id", propertyId)
    .order("name");
  assertNoError(error);
  const rooms = await supabaseAdmin.from("rooms").select("category_id").eq("property_id", propertyId);
  assertNoError(rooms.error);
  const counts = new Map<string, number>();
  for (const room of rooms.data ?? []) counts.set(room.category_id, (counts.get(room.category_id) ?? 0) + 1);
  return (data ?? []).map((row) => presentCategory(row as RoomCategory, counts.get(row.id) ?? 0));
}

export async function createCategory(property: Property, raw: Record<string, unknown>, actorId: string) {
  const input = raw as unknown as CategoryInput;
  await assertOperational(property);
  const images = await publishImages(property.id, input.images);
  const { data, error } = await supabaseAdmin
    .from("room_categories")
    .insert({
      property_id: property.id,
      name: input.name,
      description: input.description ?? "",
      max_occupancy: input.max_occupancy,
      base_price: input.base_price,
      amenities: packAmenities(input),
      images,
      booking_policy: input.booking_policy ?? "",
      is_active: input.is_active !== false,
    })
    .select("*")
    .single();
  assertNoError(error);
  await syncCategoryRooms(property, data.id, input.room_count ?? 1);
  await logActivity({
    actorId,
    propertyId: property.id,
    action: "category.created",
    entityType: "room_category",
    entityId: data.id,
    metadata: { name: data.name },
  });
  return presentCategory(data as RoomCategory, input.room_count ?? 1);
}

export async function updateCategory(property: Property, categoryId: string, raw: Record<string, unknown>, actorId: string) {
  const input = raw as unknown as CategoryInput;
  await assertOperational(property);
  const previous = await categoryForProperty(property.id, categoryId);
  const images = await publishImages(property.id, input.images);
  const { data, error } = await supabaseAdmin
    .from("room_categories")
    .update({
      name: input.name,
      description: input.description ?? "",
      max_occupancy: input.max_occupancy,
      base_price: input.base_price,
      amenities: packAmenities(input),
      images,
      booking_policy: input.booking_policy ?? "",
      is_active: input.is_active !== false,
    })
    .eq("id", categoryId)
    .eq("property_id", property.id)
    .select("*")
    .single();
  assertNoError(error);
  await syncCategoryRooms(property, categoryId, input.room_count ?? 1);
  await logActivity({
    actorId,
    propertyId: property.id,
    action: "category.updated",
    entityType: "room_category",
    entityId: categoryId,
    metadata: {
      name: data.name,
      changes: fieldChanges(previous, data, ["name", "description", "max_occupancy", "base_price", "booking_policy", "is_active"]),
    },
  });
  return presentCategory(data as RoomCategory, input.room_count ?? 1);
}

export async function deleteCategory(property: Property, categoryId: string, actorId: string) {
  await assertOperational(property);
  const previous = await categoryForProperty(property.id, categoryId);
  const { count, error: countError } = await supabaseAdmin
    .from("reservations")
    .select("id", { count: "exact", head: true })
    .eq("category_id", categoryId);
  assertNoError(countError);
  if ((count ?? 0) > 0) {
    throw new AppError(409, "This category has reservations and cannot be deleted.", "conflict");
  }
  const { error: roomError } = await supabaseAdmin.from("rooms").delete().eq("category_id", categoryId);
  assertNoError(roomError);
  const { error } = await supabaseAdmin.from("room_categories").delete().eq("id", categoryId).eq("property_id", property.id);
  assertNoError(error);
  await logActivity({
    actorId,
    propertyId: property.id,
    action: "category.deleted",
    entityType: "room_category",
    entityId: categoryId,
    metadata: { name: previous.name, removed: { Name: previous.name, Description: previous.description, Price: previous.base_price, Occupancy: previous.max_occupancy } },
  });
}

async function assertRoomCapacity(property: Property) {
  const subscription = await assertOperational(property);
  const { count, error } = await supabaseAdmin
    .from("rooms")
    .select("id", { count: "exact", head: true })
    .eq("property_id", property.id);
  assertNoError(error);
  if ((count ?? 0) >= subscription.plan.max_rooms) {
    throw new AppError(402, `The ${subscription.plan.name} plan allows ${subscription.plan.max_rooms} rooms.`, "plan_limit");
  }
}

export async function listRooms(propertyId: string) {
  const { data, error } = await supabaseAdmin
    .from("rooms")
    .select("*, category:room_categories(name)")
    .eq("property_id", propertyId)
    .order("room_number");
  assertNoError(error);
  return data ?? [];
}

export async function createRoom(property: Property, input: Record<string, unknown>, actorId: string) {
  await assertRoomCapacity(property);
  const category = await categoryForProperty(property.id, String(input.category_id));
  const { data, error } = await supabaseAdmin
    .from("rooms")
    .insert({
      property_id: property.id,
      category_id: category.id,
      room_number: input.room_number,
      floor: input.floor || null,
      status: input.status,
      notes: input.notes ?? "",
    })
    .select("*")
    .single();
  assertNoError(error);
  await syncInventory(category.id);
  await logActivity({
    actorId,
    propertyId: property.id,
    action: "room.created",
    entityType: "room",
    entityId: data.id,
    metadata: { room_number: data.room_number },
  });
  return data;
}

export async function updateRoom(property: Property, roomId: string, input: Record<string, unknown>, actorId: string) {
  await assertOperational(property);
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("rooms")
    .select("*")
    .eq("id", roomId)
    .eq("property_id", property.id)
    .maybeSingle();
  assertNoError(existingError);
  if (!existing) throw new AppError(404, "Room not found.", "not_found");
  await categoryForProperty(property.id, String(input.category_id));

  const { data, error } = await supabaseAdmin
    .from("rooms")
    .update({
      category_id: input.category_id,
      room_number: input.room_number,
      floor: input.floor || null,
      status: input.status,
      notes: input.notes ?? "",
    })
    .eq("id", roomId)
    .select("*")
    .single();
  assertNoError(error);
  await syncInventory(String(existing.category_id));
  if (existing.category_id !== input.category_id) await syncInventory(String(input.category_id));
  await logActivity({
    actorId,
    propertyId: property.id,
    action: "room.updated",
    entityType: "room",
    entityId: roomId,
    metadata: {
      room_number: data.room_number,
      changes: fieldChanges(existing, data, ["room_number", "floor", "status", "notes", "category_id"]),
    },
  });
  return data;
}

export async function deleteRoom(property: Property, roomId: string, actorId: string) {
  await assertOperational(property);
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("rooms")
    .select("*")
    .eq("id", roomId)
    .eq("property_id", property.id)
    .maybeSingle();
  assertNoError(existingError);
  if (!existing) throw new AppError(404, "Room not found.", "not_found");
  const { error } = await supabaseAdmin.from("rooms").delete().eq("id", roomId);
  assertNoError(error);
  await syncInventory(existing.category_id);
  await logActivity({
    actorId,
    propertyId: property.id,
    action: "room.deleted",
    entityType: "room",
    entityId: roomId,
    metadata: { room_number: existing.room_number, removed: { "Room number": existing.room_number, Floor: existing.floor, Status: existing.status, Notes: existing.notes } },
  });
}

export async function listRates(propertyId: string) {
  const { data, error } = await supabaseAdmin
    .from("room_rates")
    .select("*, category:room_categories(name)")
    .eq("property_id", propertyId)
    .order("created_at", { ascending: false });
  assertNoError(error);
  return data ?? [];
}

export async function saveRate(property: Property, input: Record<string, unknown>, actorId: string, rateId?: string) {
  await assertOperational(property);
  await categoryForProperty(property.id, String(input.category_id));
  if (input.start_date && input.end_date && String(input.end_date) < String(input.start_date)) {
    throw new AppError(400, "Rate end date must be on or after the start date.", "invalid_dates");
  }
  const payload = {
    property_id: property.id,
    category_id: input.category_id,
    name: input.name,
    price: input.price,
    start_date: input.start_date || null,
    end_date: input.end_date || null,
    min_stay: input.min_stay,
    is_active: input.is_active,
  };
  const query = rateId
    ? supabaseAdmin.from("room_rates").update(payload).eq("id", rateId).eq("property_id", property.id)
    : supabaseAdmin.from("room_rates").insert(payload);
  const { data, error } = await query.select("*").single();
  assertNoError(error);
  await logActivity({
    actorId,
    propertyId: property.id,
    action: rateId ? "rate.updated" : "rate.created",
    entityType: "room_rate",
    entityId: (data as RoomRate).id,
  });
  return data;
}

export async function deleteRate(property: Property, rateId: string, actorId: string) {
  await assertOperational(property);
  const { error } = await supabaseAdmin.from("room_rates").delete().eq("id", rateId).eq("property_id", property.id);
  assertNoError(error);
  await logActivity({
    actorId,
    propertyId: property.id,
    action: "rate.deleted",
    entityType: "room_rate",
    entityId: rateId,
  });
}

export async function listInventory(propertyId: string, categoryId: string | undefined, start: string, end: string) {
  let query = supabaseAdmin
    .from("room_inventory")
    .select("*")
    .eq("property_id", propertyId)
    .gte("date", start)
    .lte("date", end)
    .order("date");
  if (categoryId) query = query.eq("category_id", categoryId);
  const { data, error } = await query.limit(500);
  assertNoError(error);
  return data ?? [];
}

export async function updateInventory(
  property: Property,
  input: {
    category_id: string;
    start_date: string;
    end_date: string;
    stop_sell: boolean;
    price_override?: number | null;
    clear_price_override: boolean;
  },
  actorId: string,
) {
  await assertOperational(property);
  if (input.end_date < input.start_date) {
    throw new AppError(400, "End date must be on or after the start date.", "invalid_dates");
  }
  await categoryForProperty(property.id, input.category_id);
  const patch: Record<string, unknown> = { stop_sell: input.stop_sell };
  if (input.clear_price_override) patch.price_override = null;
  else if (input.price_override !== undefined) patch.price_override = input.price_override;

  const { data, error } = await supabaseAdmin
    .from("room_inventory")
    .update(patch)
    .eq("property_id", property.id)
    .eq("category_id", input.category_id)
    .gte("date", input.start_date)
    .lte("date", input.end_date)
    .select("id");
  assertNoError(error);
  if (!data?.length) {
    throw new AppError(404, "No inventory exists for that range. Add an available room first.", "not_found");
  }
  await logActivity({
    actorId,
    propertyId: property.id,
    action: "inventory.updated",
    entityType: "room_inventory",
    metadata: { category_id: input.category_id, start_date: input.start_date, end_date: input.end_date, stop_sell: input.stop_sell },
  });
  return { updated: data.length };
}

export async function subscriptionView(propertyId: string) {
  const subscription = await getSubscription(propertyId);
  const { count, error } = await supabaseAdmin
    .from("rooms")
    .select("id", { count: "exact", head: true })
    .eq("property_id", propertyId);
  assertNoError(error);
  return { subscription, rooms_used: count ?? 0 };
}

export async function saveExtras(property: Property, extras: Array<Omit<StayExtra, "id"> & { id?: string }>, actorId: string) {
  const next: StayExtra[] = extras.map((item) => ({
    id: item.id || randomUUID(),
    name: item.name,
    description: item.description ?? "",
    price: Number(item.price),
    charge: item.charge === "per_stay" ? "per_stay" : "per_night",
    is_active: item.is_active !== false,
  }));
  const { error } = await supabaseAdmin
    .from("properties")
    .update({ widget_settings: { ...(property.widget_settings ?? {}), extras: next } })
    .eq("id", property.id);
  assertNoError(error);
  await logActivity({
    actorId,
    propertyId: property.id,
    action: "extras.updated",
    entityType: "property",
    entityId: property.id,
    metadata: { name: property.name, added: { Extras: next.map((item) => item.name).join(", ") || "None" } },
  });
  return next;
}
