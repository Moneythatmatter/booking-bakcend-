import { supabaseAdmin } from "../config/supabase";
import type { SubscriptionPlan } from "../types";
import { AppError, assertNoError } from "../utils/errors";
import { activityDetail, fillPreviousChanges, logActivity, summarizeActivity } from "./log.service";

function safeSearch(value?: string) {
  return (value ?? "").replace(/[%_,.()]/g, "").trim();
}

export async function platformStats() {
  const { data, error } = await supabaseAdmin.rpc("platform_stats");
  assertNoError(error);
  return data;
}

export async function platformReports() {
  const { data, error } = await supabaseAdmin.rpc("platform_reports");
  assertNoError(error);
  return data;
}

export async function listHoteliers(query: { q?: string; status?: string; limit: number; offset: number }) {
  let request = supabaseAdmin
    .from("profiles")
    .select("*", { count: "exact" })
    .eq("platform_role", "hotelier")
    .order("created_at", { ascending: false })
    .range(query.offset, query.offset + query.limit - 1);
  if (query.status) request = request.eq("status", query.status);
  const q = safeSearch(query.q);
  if (q) request = request.or(`email.ilike.%${q}%,full_name.ilike.%${q}%`);
  const { data, error, count } = await request;
  assertNoError(error);
  return { users: data ?? [], count: count ?? 0 };
}

export async function getHotelier(userId: string) {
  const { data: profile, error } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .eq("platform_role", "hotelier")
    .maybeSingle();
  assertNoError(error);
  if (!profile) throw new AppError(404, "Hotelier not found.", "not_found");

  const { data: memberships, error: memberError } = await supabaseAdmin
    .from("property_users")
    .select("role, property:properties(*, subscription:subscriptions(*, plan:subscription_plans(name, price_monthly, price_yearly, max_rooms, max_properties)))")
    .eq("user_id", userId);
  assertNoError(memberError);
  return { profile, memberships: memberships ?? [] };
}

export async function listProperties(query: { q?: string; status?: string; limit: number; offset: number }) {
  let request = supabaseAdmin
    .from("properties")
    .select("*, subscription:subscriptions(*, plan:subscription_plans(name, price_monthly, max_rooms))", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(query.offset, query.offset + query.limit - 1);
  if (query.status) request = request.eq("status", query.status);
  const q = safeSearch(query.q);
  if (q) request = request.or(`name.ilike.%${q}%,slug.ilike.%${q}%,city.ilike.%${q}%`);
  const { data, error, count } = await request;
  assertNoError(error);
  return { properties: data ?? [], count: count ?? 0 };
}

export async function setPropertyStatus(propertyId: string, status: "active" | "blocked" | "suspended", actorId: string) {
  const { data, error } = await supabaseAdmin.from("properties").update({ status }).eq("id", propertyId).select("*").maybeSingle();
  assertNoError(error);
  if (!data) throw new AppError(404, "Property not found.", "not_found");
  await logActivity({
    actorId,
    propertyId,
    action: "property.status_changed",
    entityType: "property",
    entityId: propertyId,
    metadata: { status },
  });
  return data;
}

export async function listPlans() {
  const { data, error } = await supabaseAdmin.from("subscription_plans").select("*").order("price_monthly");
  assertNoError(error);
  return data ?? [];
}

export async function savePlan(input: Record<string, unknown>, actorId: string, planId?: string) {
  const query = planId
    ? supabaseAdmin.from("subscription_plans").update(input).eq("id", planId)
    : supabaseAdmin.from("subscription_plans").insert(input);
  const { data, error } = await query.select("*").single();
  assertNoError(error);
  await logActivity({
    actorId,
    action: planId ? "plan.updated" : "plan.created",
    entityType: "subscription_plan",
    entityId: (data as SubscriptionPlan).id,
    metadata: { name: data.name },
  });
  return data;
}

async function idsFor(table: "properties" | "subscription_plans" | "room_categories", column: "name" | "city", value: string) {
  const request = supabaseAdmin.from(table).select("id");
  const filtered = column === "city" ? request.or(`name.ilike.%${value}%,city.ilike.%${value}%`) : request.ilike("name", `%${value}%`);
  const { data, error } = await filtered;
  assertNoError(error);
  return (data ?? []).map((row) => row.id as string);
}

export async function listSubscriptions(query: { q?: string; status?: string; limit: number; offset: number }) {
  let request = supabaseAdmin
    .from("subscriptions")
    .select("*, plan:subscription_plans(name, price_monthly, price_yearly), property:properties(id, name, slug, status)", { count: "exact" })
    .order("current_period_end")
    .range(query.offset, query.offset + query.limit - 1);
  if (query.status) request = request.eq("status", query.status);
  const q = safeSearch(query.q);
  if (q) {
    const [propertyIds, planIds] = await Promise.all([idsFor("properties", "city", q), idsFor("subscription_plans", "name", q)]);
    const parts = [
      ...(propertyIds.length ? [`property_id.in.(${propertyIds.join(",")})`] : []),
      ...(planIds.length ? [`plan_id.in.(${planIds.join(",")})`] : []),
    ];
    if (parts.length === 0) return { subscriptions: [], count: 0 };
    request = request.or(parts.join(","));
  }
  const { data, error, count } = await request;
  assertNoError(error);
  return { subscriptions: data ?? [], count: count ?? 0 };
}

export async function upsertSubscription(
  input: {
    property_id: string;
    plan_id: string;
    status: string;
    billing_interval: "monthly" | "yearly";
    current_period_start: string;
    current_period_end: string;
    record_payment: boolean;
  },
  actorId: string,
) {
  if (input.current_period_end < input.current_period_start) {
    throw new AppError(400, "Expiry must be on or after the period start.", "invalid_dates");
  }
  const { data: plan, error: planError } = await supabaseAdmin.from("subscription_plans").select("*").eq("id", input.plan_id).maybeSingle();
  assertNoError(planError);
  if (!plan) throw new AppError(404, "Plan not found.", "not_found");

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("subscriptions")
    .select("id")
    .eq("property_id", input.property_id)
    .maybeSingle();
  assertNoError(existingError);

  const payload = {
    property_id: input.property_id,
    plan_id: input.plan_id,
    status: input.status,
    billing_interval: input.billing_interval,
    current_period_start: input.current_period_start,
    current_period_end: input.current_period_end,
    cancelled_at: input.status === "cancelled" ? new Date().toISOString() : null,
  };

  const query = existing
    ? supabaseAdmin.from("subscriptions").update(payload).eq("id", existing.id)
    : supabaseAdmin.from("subscriptions").insert(payload);
  const { data, error } = await query.select("*").single();
  assertNoError(error);

  if (input.record_payment) {
    const amount = input.billing_interval === "yearly" ? plan.price_yearly : plan.price_monthly;
    const { error: paymentError } = await supabaseAdmin.from("payments").insert({
      property_id: input.property_id,
      subscription_id: data.id,
      amount,
      currency: "USD",
      type: "subscription",
      status: "paid",
      provider: "manual",
    });
    assertNoError(paymentError);
  }

  await logActivity({
    actorId,
    propertyId: input.property_id,
    action: "subscription.updated",
    entityType: "subscription",
    entityId: data.id,
    metadata: { status: input.status, plan_id: input.plan_id },
  });
  return data;
}

export async function patchSubscription(
  subscriptionId: string,
  input: {
    plan_id?: string;
    status?: string;
    billing_interval?: "monthly" | "yearly";
    current_period_start?: string;
    current_period_end?: string;
    record_payment: boolean;
  },
  actorId: string,
) {
  const { data: existing, error } = await supabaseAdmin
    .from("subscriptions")
    .select("*, plan:subscription_plans(*)")
    .eq("id", subscriptionId)
    .maybeSingle();
  assertNoError(error);
  if (!existing) throw new AppError(404, "Subscription not found.", "not_found");

  const planId = input.plan_id ?? existing.plan_id;
  const interval = input.billing_interval ?? existing.billing_interval;
  const start = input.current_period_start ?? existing.current_period_start;
  const end = input.current_period_end ?? existing.current_period_end;
  return upsertSubscription(
    {
      property_id: existing.property_id,
      plan_id: planId,
      status: input.status ?? existing.status,
      billing_interval: interval,
      current_period_start: start,
      current_period_end: end,
      record_payment: input.record_payment,
    },
    actorId,
  );
}

function stayNights(checkIn: string, checkOut: string) {
  const ms = new Date(`${checkOut}T00:00:00Z`).getTime() - new Date(`${checkIn}T00:00:00Z`).getTime();
  return Math.max(1, Math.round(ms / 86_400_000));
}

function presentPlatformBooking(row: Record<string, unknown>) {
  const total = Number(row.total_amount);
  const nights = stayNights(String(row.check_in), String(row.check_out));
  const payments = (row.payments ?? []) as Array<{ amount: number; status: string; type: string }>;
  const paid = payments
    .filter((payment) => payment.type === "guest_booking" && payment.status === "paid")
    .reduce((sum, payment) => sum + Number(payment.amount), 0);
  const advance = paid > 0 ? paid : row.payment_status === "paid" ? total : 0;
  const category = row.category as { name?: string } | { name?: string }[] | null;
  const categoryName = Array.isArray(category) ? category[0]?.name : category?.name;
  return {
    ...row,
    category_name: categoryName || "Room",
    nights,
    nightly_price: Math.round((total / nights) * 100) / 100,
    advance: Math.round(advance * 100) / 100,
    remaining: Math.round(Math.max(0, total - advance) * 100) / 100,
  };
}

export async function listPlatformBookings(query: { q?: string; status?: string; limit: number; offset: number }) {
  let request = supabaseAdmin
    .from("reservations")
    .select(
      "id, confirmation_code, guest_name, guest_email, check_in, check_out, status, total_amount, currency, payment_status, created_at, property:properties(name, slug), category:room_categories(name), payments(amount, status, type)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(query.offset, query.offset + query.limit - 1);
  if (query.status) request = request.eq("status", query.status);
  const q = safeSearch(query.q);
  if (q) {
    const [propertyIds, categoryIds] = await Promise.all([idsFor("properties", "city", q), idsFor("room_categories", "name", q)]);
    const parts = [
      `guest_name.ilike.%${q}%`,
      `guest_email.ilike.%${q}%`,
      `confirmation_code.ilike.%${q}%`,
      ...(propertyIds.length ? [`property_id.in.(${propertyIds.join(",")})`] : []),
      ...(categoryIds.length ? [`category_id.in.(${categoryIds.join(",")})`] : []),
    ];
    request = request.or(parts.join(","));
  }
  const { data, error, count } = await request;
  assertNoError(error);
  return { bookings: (data ?? []).map((row) => presentPlatformBooking(row as Record<string, unknown>)), count: count ?? 0 };
}

function logType(log: { summary?: string; detail?: { kind?: string } }) {
  if (log.detail?.kind === "updated") return "Update";
  if (/^Cancelled/.test(log.summary || "")) return "Cancel";
  if (log.detail?.kind === "removed") return "Delete";
  return "Create";
}

export async function listLogs(query: { q?: string; status?: string; limit: number; offset: number }) {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 365);
  const searching = Boolean(safeSearch(query.q) || query.status);
  const { data, error, count } = await supabaseAdmin
    .from("activity_logs")
    .select("id, actor_id, property_id, action, entity_type, entity_id, metadata, created_at, actor:profiles(full_name, email), property:properties(name)", {
      count: "exact",
    })
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .range(searching ? 0 : query.offset, searching ? 399 : query.offset + query.limit - 1);
  assertNoError(error);
  let logs = fillPreviousChanges(data ?? []).map((row) => ({
    ...row,
    summary: summarizeActivity(row.action, (row.metadata ?? {}) as Record<string, unknown>),
    detail: activityDetail(row.action, (row.metadata ?? {}) as Record<string, unknown>),
  }));
  const q = safeSearch(query.q).toLowerCase();
  if (q) {
    logs = logs.filter((log) => {
      const actor = log.actor as { full_name?: string; email?: string } | { full_name?: string; email?: string }[] | null;
      const person = Array.isArray(actor) ? actor[0] : actor;
      const property = log.property as { name?: string } | { name?: string }[] | null;
      const hotel = Array.isArray(property) ? property[0]?.name : property?.name;
      return [person?.full_name, person?.email, hotel, log.summary, log.action].some((value) => String(value ?? "").toLowerCase().includes(q));
    });
  }
  if (query.status) logs = logs.filter((log) => logType(log) === query.status);
  const matched = logs.length;
  if (searching) logs = logs.slice(query.offset, query.offset + query.limit);
  return { logs, count: searching ? matched : count ?? 0 };
}
