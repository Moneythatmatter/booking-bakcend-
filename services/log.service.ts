import { supabaseAdmin } from "../config/supabase";

interface LogInput {
  actorId?: string | null;
  propertyId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function logActivity(input: LogInput) {
  const { error } = await supabaseAdmin.from("activity_logs").insert({
    actor_id: input.actorId ?? null,
    property_id: input.propertyId ?? null,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    metadata: input.metadata ?? {},
  });
  if (error) console.error("activity log failed", error.message);
}

export function fieldChanges(before: object, after: object, fields: string[]) {
  const left = before as Record<string, unknown>;
  const right = after as Record<string, unknown>;
  return fields.flatMap((field) => {
    const from = left[field] ?? "";
    const to = right[field] ?? "";
    if (String(from) === String(to)) return [];
    return [{ field, from: String(from), to: String(to) }];
  });
}

const ACTION_LABELS: Record<string, string> = {
  "property.created": "Added a property",
  "property.updated": "Updated a property",
  "property.cover_updated": "Updated the property photo",
  "property.status_changed": "Changed a property status",
  "widget.updated": "Updated the booking widget",
  "profile.provisioned": "Opened a hotel desk",
  "hotelier.created": "Added a hotelier",
  "profile.status_changed": "Changed an account status",
  "user.created": "Added a user",
  "user.access_updated": "Changed user access",
  "category.created": "Added a room category",
  "category.updated": "Updated a room category",
  "category.deleted": "Removed a room category",
  "room.created": "Added a room",
  "room.updated": "Updated a room",
  "room.deleted": "Removed a room",
  "rate.created": "Added a rate",
  "rate.updated": "Updated a rate",
  "rate.deleted": "Removed a rate",
  "inventory.updated": "Updated availability",
  "reservation.created": "Added a booking",
  "reservation.updated": "Updated a booking",
  "reservation.cancelled": "Cancelled a booking",
  "payment.received": "Recorded a payment",
  "subscription.updated": "Updated a subscription",
  "plan.created": "Added a plan",
  "plan.updated": "Updated a plan",
};

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  description: "Description",
  address: "Address",
  city: "City",
  country: "Country",
  phone: "Phone",
  email: "Email",
  timezone: "Timezone",
  currency: "Currency",
  check_in_time: "Check-in",
  check_out_time: "Check-out",
  policies: "Booking policy",
  base_price: "Price",
  max_occupancy: "Occupancy",
  room_number: "Room number",
  floor: "Floor",
  status: "Status",
  notes: "Notes",
  access_role: "Role",
};

function fieldLabel(field: string) {
  return FIELD_LABELS[field] ?? field.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayValue(value: unknown) {
  if (value == null || value === "") return "Empty";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function snapshotFields(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry == null || ["string", "number", "boolean"].includes(typeof entry))
    .map(([field, entry]) => ({ field: fieldLabel(field), value: displayValue(entry) }));
}

export function fillPreviousChanges<T extends { action: string; entity_id?: string | null; metadata?: Record<string, unknown> | null }>(rows: T[]) {
  return rows.map((row, index) => {
    const metadata = { ...(row.metadata ?? {}) };
    const stored = Array.isArray(metadata.changes) ? metadata.changes : [];
    if (stored.length || !/updated|changed/.test(row.action)) return { ...row, metadata };
    const older = rows.slice(index + 1).find((item) => item.entity_id && item.entity_id === row.entity_id);
    if (!older?.metadata) return { ...row, metadata };
    return {
      ...row,
      metadata: {
        ...metadata,
        changes: fieldChanges(older.metadata, metadata, ["name", "email", "access_role", "status", "room_number", "confirmation_code"]),
      },
    };
  });
}

export function activityDetail(action: string, metadata: Record<string, unknown> = {}) {
  const kind: "added" | "updated" | "removed" = /deleted|cancelled/.test(action) ? "removed" : /updated|changed/.test(action) ? "updated" : "added";
  const changes = (Array.isArray(metadata.changes) ? metadata.changes : []).map((change) => {
    const row = change as { field?: string; from?: unknown; to?: unknown };
    return { field: fieldLabel(String(row.field ?? "Field")), from: displayValue(row.from), to: displayValue(row.to) };
  });
  const recorded = snapshotFields(kind === "removed" ? metadata.removed : metadata.added);
  const fields = recorded.length
    ? recorded
    : snapshotFields(Object.fromEntries(Object.entries(metadata).filter(([key]) => !["changes", "added", "removed", "snapshot", "previous"].includes(key))));
  const current = snapshotFields(metadata.snapshot);
  const previous = snapshotFields(metadata.previous);
  const rows = current.length
    ? mergeRows(changes, previous, current)
    : kind === "updated"
      ? mergeRows(changes, [], fields.map((field) => ({ field: field.field, value: field.value })))
      : fields.map((field) => ({ field: field.field, from: "", to: field.value, value: field.value }));
  return { kind, title: ACTION_LABELS[action] ?? action.replaceAll(".", " ").replaceAll("_", " "), changes, fields, rows };
}

function mergeRows(
  changes: Array<{ field: string; from: string; to: string }>,
  previous: Array<{ field: string; value: string }>,
  current: Array<{ field: string; value: string }>,
) {
  const previousValues = new Map(previous.map((row) => [row.field, row.value]));
  const changeValues = new Map(changes.map((row) => [row.field, row]));
  const seen = new Set<string>();
  const rows = current.map((row) => {
    seen.add(row.field);
    const change = changeValues.get(row.field);
    if (change) return { field: row.field, from: change.from, to: change.to, value: change.to };
    return { field: row.field, from: previousValues.get(row.field) ?? row.value, to: row.value, value: row.value };
  });
  for (const change of changes) {
    if (seen.has(change.field)) continue;
    rows.push({ field: change.field, from: change.from, to: change.to, value: change.to });
  }
  return rows;
}

export function summarizeActivity(action: string, metadata: Record<string, unknown> = {}) {
  const label = ACTION_LABELS[action] ?? action.replaceAll(".", " ").replaceAll("_", " ");
  const detail = ["name", "email", "room_number", "confirmation_code", "status"]
    .map((key) => (typeof metadata[key] === "string" || typeof metadata[key] === "number" ? String(metadata[key]) : ""))
    .find(Boolean);
  return detail ? `${label}: ${detail}` : label;
}
