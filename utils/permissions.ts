import type { PropertyUserRole } from "../types";

export const PROPERTY_PERMISSIONS = [
  "property.read",
  "property.update",
  "rooms.manage",
  "rates.manage",
  "inventory.manage",
  "bookings.read",
  "bookings.manage",
  "guests.read",
  "subscription.read",
  "widget.manage",
] as const;

const STAFF_PERMISSIONS = ["property.read", "bookings.read", "guests.read", "subscription.read"];

export function permissionsFor(role: PropertyUserRole) {
  if (role === "staff") return [...STAFF_PERMISSIONS];
  return [...PROPERTY_PERMISSIONS];
}

export function hasPermission(role: PropertyUserRole, permission: string) {
  return permissionsFor(role).includes(permission);
}
