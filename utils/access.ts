export type AccessLevel = "none" | "read" | "write";
export type AccessRole = "administrator" | "user";

export const HOTEL_PAGES = [
  { key: "dashboard", label: "Dashboard" },
  { key: "property", label: "Property" },
  { key: "categories", label: "Room categories" },
  { key: "rooms", label: "Rooms" },
  { key: "extras", label: "Extras" },
  { key: "pricing", label: "Pricing" },
  { key: "availability", label: "Availability" },
  { key: "bookings", label: "Bookings" },
  { key: "guests", label: "Guests" },
  { key: "subscription", label: "Subscription" },
  { key: "widget", label: "Booking widget" },
  { key: "activity", label: "Activity" },
  { key: "users", label: "Users" },
] as const;

export const PLATFORM_PAGES = [
  { key: "overview", label: "Overview" },
  { key: "hoteliers", label: "Hoteliers" },
  { key: "properties", label: "Properties" },
  { key: "plans", label: "Plans" },
  { key: "subscriptions", label: "Subscriptions" },
  { key: "bookings", label: "Bookings" },
  { key: "reports", label: "Reports" },
  { key: "activity", label: "Activity" },
  { key: "users", label: "Users" },
] as const;

export type HotelPageKey = (typeof HOTEL_PAGES)[number]["key"];
export type PlatformPageKey = (typeof PLATFORM_PAGES)[number]["key"];

const STAFF_PAGES: HotelPageKey[] = ["dashboard", "property", "bookings", "guests", "subscription", "activity"];

export function allWrite<T extends string>(pages: readonly { key: T }[]): Record<T, AccessLevel> {
  return Object.fromEntries(pages.map((page) => [page.key, "write"])) as Record<T, AccessLevel>;
}

export function hotelPageAccess(input: {
  role: string;
  accessRole?: string | null;
  pageAccess?: Record<string, string> | null;
}): Record<HotelPageKey, AccessLevel> {
  if (input.role === "owner" || input.accessRole === "administrator") return allWrite(HOTEL_PAGES);
  if (input.accessRole === "user") return normalize(HOTEL_PAGES, input.pageAccess, []);
  if (input.role === "manager") return allWrite(HOTEL_PAGES);
  return normalize(HOTEL_PAGES, null, STAFF_PAGES);
}

export function platformPageAccess(input: {
  accessRole?: string | null;
  pageAccess?: Record<string, string> | null;
}): Record<PlatformPageKey, AccessLevel> {
  if (input.accessRole !== "user") return allWrite(PLATFORM_PAGES);
  return normalize(PLATFORM_PAGES, input.pageAccess, []);
}

function normalize<T extends string>(
  pages: readonly { key: T }[],
  stored: Record<string, string> | null | undefined,
  defaults: readonly T[],
): Record<T, AccessLevel> {
  const result = {} as Record<T, AccessLevel>;
  for (const page of pages) {
    const value = stored?.[page.key];
    if (value === "read" || value === "write" || value === "none") result[page.key] = value;
    else result[page.key] = defaults.includes(page.key) ? "read" : "none";
  }
  return result;
}

export function allows(level: AccessLevel | undefined, required: "read" | "write") {
  if (required === "read") return level === "read" || level === "write";
  return level === "write";
}
