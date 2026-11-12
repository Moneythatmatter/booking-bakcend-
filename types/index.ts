export type PlatformRole = "super_admin" | "hotelier";
export type AccountStatus = "active" | "blocked" | "suspended";
export type PropertyStatus = "active" | "blocked" | "suspended";
export type PropertyUserRole = "owner" | "manager" | "staff";
export type RoomStatus = "available" | "maintenance" | "out_of_order";
export type ReservationStatus =
  | "pending"
  | "confirmed"
  | "cancelled"
  | "checked_in"
  | "checked_out"
  | "no_show";
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "cancelled" | "expired";
export type BillingInterval = "monthly" | "yearly";
export type PaymentStatus = "pending" | "paid" | "failed" | "refunded" | "waived";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  platform_role: PlatformRole;
  status: AccountStatus;
  access_role?: "administrator" | "user" | null;
  page_access?: Record<string, "none" | "read" | "write"> | null;
  created_at: string;
  updated_at: string;
}

export interface Property {
  id: string;
  name: string;
  slug: string;
  description: string;
  address: string;
  city: string;
  country: string;
  phone: string | null;
  email: string | null;
  timezone: string;
  currency: string;
  check_in_time: string;
  check_out_time: string;
  policies: string;
  cover_image_url?: string | null;
  status: PropertyStatus;
  widget_settings: WidgetSettings;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WidgetSettings {
  primary_color?: string;
  button_label?: string;
  show_policies?: boolean;
  cover_image_url?: string;
  desk_access?: Record<string, { access_role?: string; page_access?: Record<string, string> }>;
  extras?: StayExtra[];
}

export interface StayExtra {
  id: string;
  name: string;
  description: string;
  price: number;
  charge: "per_night" | "per_stay";
  is_active: boolean;
}

export interface PropertyUser {
  id: string;
  property_id: string;
  user_id: string;
  role: PropertyUserRole;
  access_role?: "administrator" | "user" | null;
  page_access?: Record<string, "none" | "read" | "write"> | null;
  created_at: string;
}

export interface RoomCategory {
  id: string;
  property_id: string;
  name: string;
  description: string;
  max_occupancy: number;
  base_price: number;
  amenities: string[];
  images: string[];
  booking_policy: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Room {
  id: string;
  property_id: string;
  category_id: string;
  room_number: string;
  floor: string | null;
  status: RoomStatus;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface RoomRate {
  id: string;
  property_id: string;
  category_id: string;
  name: string;
  price: number;
  start_date: string | null;
  end_date: string | null;
  min_stay: number;
  is_active: boolean;
  created_at: string;
}

export interface RoomInventory {
  id: string;
  property_id: string;
  category_id: string;
  date: string;
  total_rooms: number;
  available_rooms: number;
  price_override: number | null;
  stop_sell: boolean;
}

export interface Reservation {
  id: string;
  property_id: string;
  category_id: string;
  room_id: string | null;
  confirmation_code: string;
  guest_name: string;
  guest_email: string;
  guest_phone: string | null;
  check_in: string;
  check_out: string;
  adults: number;
  children: number;
  status: ReservationStatus;
  total_amount: number;
  currency: string;
  special_requests: string;
  access_token_hash: string;
  payment_status: PaymentStatus;
  hold_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  description: string;
  price_monthly: number;
  price_yearly: number;
  max_properties: number;
  max_rooms: number;
  features: string[];
  is_active: boolean;
  created_at: string;
}

export interface Subscription {
  id: string;
  property_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  billing_interval: BillingInterval;
  current_period_start: string;
  current_period_end: string;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ValidatedRequest {
  body: Record<string, unknown>;
  query: Record<string, unknown>;
  params: Record<string, unknown>;
}
