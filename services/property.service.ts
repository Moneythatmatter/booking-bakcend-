import { env } from "../config/env";
import { supabaseAdmin } from "../config/supabase";
import type { Profile, Property, Subscription, SubscriptionPlan, WidgetSettings } from "../types";
import { addDays, todayInTimeZone } from "../utils/dates";
import { hotelPageAccess } from "../utils/access";
import { permissionsFor } from "../utils/permissions";
import { AppError, assertNoError } from "../utils/errors";
import { uniqueSlug } from "../utils/slug";
import { listActivity } from "./activity.service";
import { fieldChanges, logActivity } from "./log.service";

export async function unusedSlug(name: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = uniqueSlug(name);
    const { data } = await supabaseAdmin.from("properties").select("id").eq("slug", slug).maybeSingle();
    if (!data) return slug;
  }
  throw new AppError(409, "Could not create a unique booking URL. Try a different property name.");
}

export async function getSubscription(propertyId: string) {
  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .select("*, plan:subscription_plans(*)")
    .eq("property_id", propertyId)
    .maybeSingle();
  assertNoError(error);
  if (!data) return null;

  const today = todayInTimeZone("UTC");
  const subscription = data as Subscription & { plan: SubscriptionPlan };
  if (["trialing", "active", "past_due"].includes(subscription.status) && subscription.current_period_end < today) {
    const { error: updateError } = await supabaseAdmin
      .from("subscriptions")
      .update({ status: "expired" })
      .eq("id", subscription.id);
    assertNoError(updateError);
    subscription.status = "expired";
  }
  return subscription;
}

export function subscriptionIsOpen(subscription: { status: string; current_period_end: string } | null) {
  if (!subscription) return false;
  return ["trialing", "active"].includes(subscription.status) && subscription.current_period_end >= todayInTimeZone("UTC");
}

export async function assertPropertyBookable(property: Property) {
  if (property.status !== "active") {
    throw new AppError(403, "This property is not accepting bookings.", "property_unavailable");
  }
  const subscription = await getSubscription(property.id);
  if (!subscriptionIsOpen(subscription)) {
    throw new AppError(403, "This property is not accepting bookings.", "subscription_inactive");
  }
  return subscription;
}

export async function assertOperational(property: Property) {
  if (property.status !== "active") {
    throw new AppError(403, "This property is not active.", "property_unavailable");
  }
  const subscription = await getSubscription(property.id);
  if (!subscription || !subscriptionIsOpen(subscription)) {
    throw new AppError(402, "The subscription for this property is not active.", "subscription_inactive");
  }
  return subscription;
}

export async function createPropertyForOwner(input: {
  owner: Profile;
  name: string;
  city?: string;
  country?: string;
  timezone?: string;
  currency?: string;
  actorId?: string;
}) {
  const slug = await unusedSlug(input.name);
  const { data: property, error } = await supabaseAdmin
    .from("properties")
    .insert({
      name: input.name,
      slug,
      city: input.city ?? "",
      country: input.country ?? "",
      timezone: input.timezone || "UTC",
      currency: (input.currency || "USD").toUpperCase(),
      created_by: input.owner.id,
      email: input.owner.email,
    })
    .select("*")
    .single();
  assertNoError(error);

  const { error: memberError } = await supabaseAdmin.from("property_users").insert({
    property_id: property.id,
    user_id: input.owner.id,
    role: "owner",
  });
  assertNoError(memberError);

  const { data: plan, error: planError } = await supabaseAdmin
    .from("subscription_plans")
    .select("*")
    .eq("name", "Starter")
    .eq("is_active", true)
    .maybeSingle();
  assertNoError(planError);
  if (!plan) {
    throw new AppError(500, "The Starter plan is missing. Run the seed migration before creating properties.");
  }

  const start = todayInTimeZone(property.timezone);
  const { error: subError } = await supabaseAdmin.from("subscriptions").insert({
    property_id: property.id,
    plan_id: plan.id,
    status: "trialing",
    billing_interval: "monthly",
    current_period_start: start,
    current_period_end: addDays(start, 14),
  });
  assertNoError(subError);

  await logActivity({
    actorId: input.actorId ?? input.owner.id,
    propertyId: property.id,
    action: "property.created",
    entityType: "property",
    entityId: property.id,
    metadata: { name: property.name, slug: property.slug },
  });

  return property as Property;
}

export async function listPropertiesForUser(userId: string) {
  const first = await supabaseAdmin
    .from("property_users")
    .select("role, access_role, page_access, property:properties(*)")
    .eq("user_id", userId);
  const fallback = first.error && /access_role|page_access/.test(first.error.message)
    ? await supabaseAdmin.from("property_users").select("role, property:properties(*)").eq("user_id", userId)
    : null;
  const error = fallback ? fallback.error : first.error;
  const data = fallback ? fallback.data : first.data;
  assertNoError(error);

  const rows = (data ?? []) as unknown as Array<{
    role: "owner" | "manager" | "staff";
    access_role?: string | null;
    page_access?: Record<string, string> | null;
    property: Property | Property[] | null;
  }>;
  const properties = [];
  for (const row of rows) {
    const property = Array.isArray(row.property) ? row.property[0] : row.property;
    if (!property) continue;
    const subscription = await getSubscription(property.id);
    const stored = property.widget_settings?.desk_access?.[userId];
    const pageAccess = hotelPageAccess({
      role: row.role,
      accessRole: row.access_role ?? stored?.access_role,
      pageAccess: row.page_access ?? stored?.page_access,
    });
    properties.push({
      ...property,
      cover_image_url: property.cover_image_url || property.widget_settings?.cover_image_url || null,
      role: row.role,
      page_access: pageAccess,
      permissions: permissionsFor(row.role),
      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            billing_interval: subscription.billing_interval,
            current_period_start: subscription.current_period_start,
            current_period_end: subscription.current_period_end,
            plan: subscription.plan,
          }
        : null,
    });
  }
  return properties;
}

export async function assertCanAddProperty(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("property_users")
    .select("property_id")
    .eq("user_id", userId)
    .eq("role", "owner");
  assertNoError(error);
  const owned = data ?? [];
  if (!owned.length) return;

  const { data: subs, error: subError } = await supabaseAdmin
    .from("subscriptions")
    .select("status, current_period_end, plan:subscription_plans(max_properties)")
    .in(
      "property_id",
      owned.map((row) => row.property_id),
    );
  assertNoError(subError);

  let maxProperties = 0;
  const today = todayInTimeZone("UTC");
  for (const sub of subs ?? []) {
    const plan = sub.plan as unknown as { max_properties: number } | null;
    if (["trialing", "active"].includes(sub.status) && sub.current_period_end >= today) {
      maxProperties = Math.max(maxProperties, plan?.max_properties ?? 0);
    }
  }
  if (owned.length >= maxProperties) {
    throw new AppError(402, "Your current plan does not include another property.", "plan_limit");
  }
}

export async function updateProperty(property: Property, input: Partial<Property> & { email?: string | null }, actorId: string) {
  if (property.status !== "active") {
    throw new AppError(403, "This property cannot be edited while it is blocked or suspended.", "property_unavailable");
  }
  const { data, error } = await supabaseAdmin
    .from("properties")
    .update({
      name: input.name,
      description: input.description ?? "",
      address: input.address ?? "",
      city: input.city ?? "",
      country: input.country ?? "",
      phone: input.phone || null,
      email: input.email || null,
      timezone: input.timezone,
      currency: input.currency?.toUpperCase(),
      check_in_time: String(input.check_in_time).slice(0, 5),
      check_out_time: String(input.check_out_time).slice(0, 5),
      policies: input.policies ?? "",
    })
    .eq("id", property.id)
    .select("*")
    .single();
  assertNoError(error);
  const saved = data as Property;
  await logActivity({
    actorId,
    propertyId: property.id,
    action: "property.updated",
    entityType: "property",
    entityId: property.id,
    metadata: {
      name: saved.name,
      changes: fieldChanges(property, saved, [
        "name",
        "description",
        "address",
        "city",
        "country",
        "phone",
        "email",
        "timezone",
        "currency",
        "check_in_time",
        "check_out_time",
        "policies",
      ]),
    },
  });
  return saved;
}

export async function saveCoverImage(property: Property, dataUrl: string, actorId: string) {
  const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!match) throw new AppError(400, "Upload a JPEG or PNG image.", "validation");
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (buffer.length < 32 || buffer.length > 1_500_000) {
    throw new AppError(400, "Use an image under 1.5 MB.", "validation");
  }
  const size = imageSize(buffer, match[1]);
  if (!size || size.width <= size.height) {
    throw new AppError(400, "Use a landscape photo, wider than it is tall.", "validation");
  }

  const path = `${property.id}/cover.${match[1] === "image/png" ? "png" : "jpg"}`;
  const bucket = supabaseAdmin.storage.from("property-covers");
  const existing = await supabaseAdmin.storage.getBucket("property-covers");
  if (!existing.data) {
    const created = await supabaseAdmin.storage.createBucket("property-covers", { public: true });
    if (created.error && !/already exists/i.test(created.error.message)) {
      throw new AppError(500, created.error.message, "storage_error");
    }
  }
  const uploaded = await bucket.upload(path, buffer, { contentType: match[1], upsert: true });
  if (uploaded.error) throw new AppError(500, uploaded.error.message, "storage_error");
  const publicUrl = bucket.getPublicUrl(path).data.publicUrl;
  const versioned = `${publicUrl}?v=${Date.now()}`;
  const settings = { ...(property.widget_settings ?? {}), cover_image_url: versioned };
  let { error } = await supabaseAdmin.from("properties").update({ cover_image_url: versioned, widget_settings: settings }).eq("id", property.id);
  if (error && /cover_image_url/.test(error.message)) {
    ({ error } = await supabaseAdmin.from("properties").update({ widget_settings: settings }).eq("id", property.id));
  }
  assertNoError(error);
  await logActivity({
    actorId,
    propertyId: property.id,
    action: "property.cover_updated",
    entityType: "property",
    entityId: property.id,
    metadata: { name: property.name },
  });
  return { cover_image_url: versioned };
}

function imageSize(buffer: Buffer, mime: string) {
  if (mime === "image/png" && buffer.toString("ascii", 1, 4) === "PNG") {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (mime !== "image/jpeg" || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

export function widgetPayload(property: Property) {
  const bookingUrl = `${env.bookingUrl}/h/${property.slug}`;
  const embed = `<iframe src="${bookingUrl}?embed=1" style="width:100%;min-height:820px;border:0;" title="Book ${property.name}"></iframe>`;
  const { desk_access: _deskAccess, ...settings } = property.widget_settings ?? {};
  return {
    booking_url: bookingUrl,
    embed_code: embed,
    settings,
    payments_enabled: env.paymentsEnabled,
  };
}

export async function updateWidget(property: Property, settings: WidgetSettings, actorId: string) {
  await assertOperational(property);
  const next = { ...(property.widget_settings ?? {}), ...settings };
  const { data, error } = await supabaseAdmin
    .from("properties")
    .update({ widget_settings: next })
    .eq("id", property.id)
    .select("*")
    .single();
  assertNoError(error);
  await logActivity({
    actorId,
    propertyId: property.id,
    action: "widget.updated",
    entityType: "property",
    entityId: property.id,
  });
  return widgetPayload(data as Property);
}

export async function propertyDashboard(property: Property) {
  const today = todayInTimeZone(property.timezone);
  const { data, error } = await supabaseAdmin.rpc("property_dashboard", {
    p_property: property.id,
    p_today: today,
  });
  assertNoError(error);

  const { data: recent, error: recentError } = await supabaseAdmin
    .from("reservations")
    .select("id, confirmation_code, guest_name, check_in, check_out, status, total_amount, currency, category:room_categories(name)")
    .eq("property_id", property.id)
    .order("created_at", { ascending: false })
    .limit(6);
  assertNoError(recentError);

  const subscription = await getSubscription(property.id);
  const recentActivity = await listActivity({ propertyId: property.id, limit: 8 });
  return {
    stats: data,
    recent_bookings: recent ?? [],
    recent_activity: recentActivity,
    subscription,
    property,
  };
}
