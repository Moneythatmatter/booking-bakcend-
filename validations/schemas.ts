import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const money = z.coerce.number().min(0).max(1000000);
const uuid = z.string().uuid();

export const empty = z.object({
  body: z.object({}).passthrough().optional().default({}),
  query: z.object({}).passthrough().optional().default({}),
  params: z.object({}).passthrough().optional().default({}),
});

export const provisionSchema = z.object({
  body: z.object({
    full_name: z.string().trim().min(2).max(120),
    property_name: z.string().trim().min(2).max(160),
    city: z.string().trim().max(80).optional().default(""),
    country: z.string().trim().max(80).optional().default(""),
    phone: z.string().trim().max(30).optional().default(""),
    timezone: z.string().trim().max(80).optional().default("UTC"),
    currency: z.string().trim().length(3).optional().default("USD"),
  }),
  query: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
});

export const propertyParams = z.object({
  body: z.object({}).optional().default({}),
  query: z.object({}).passthrough().optional().default({}),
  params: z.object({ propertyId: uuid }),
});

export const propertyUpdateSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(160),
    description: z.string().max(4000).optional().default(""),
    address: z.string().max(240).optional().default(""),
    city: z.string().max(80).optional().default(""),
    country: z.string().max(80).optional().default(""),
    phone: z.string().max(30).nullable().optional(),
    email: z.union([z.string().email(), z.literal("")]).optional(),
    timezone: z.string().min(1).max(80),
    currency: z.string().length(3),
    check_in_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
    check_out_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
    policies: z.string().max(4000).optional().default(""),
  }),
  query: z.object({}).optional().default({}),
  params: z.object({ propertyId: uuid }),
});

export const categorySchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(80),
    description: z.string().max(2000).optional().default(""),
    max_occupancy: z.coerce.number().int().min(1).max(20),
    base_price: money,
    amenities: z.array(z.string().trim().min(1).max(40)).max(30).optional().default([]),
    images: z.array(z.string().min(8).max(2_000_000)).max(4).optional().default([]),
    booking_policy: z.string().max(2000).optional().default(""),
    is_active: z.boolean().optional().default(true),
    size_sqft: z.coerce.number().int().min(0).max(20000).optional().nullable(),
    beds: z.string().trim().max(120).optional().default(""),
    original_price: z.coerce.number().min(0).max(1000000).optional().nullable(),
    rate_plan: z.string().trim().max(80).optional().default("Room only"),
    rate_plan_note: z.string().trim().max(240).optional().default(""),
    refundable: z.boolean().optional().default(true),
    room_count: z.coerce.number().int().min(1).max(200).optional().default(1),
  }),
  query: z.object({}).optional().default({}),
  params: z.object({ propertyId: uuid }),
});

export const categoryPatchSchema = categorySchema.extend({
  params: z.object({ propertyId: uuid, categoryId: uuid }),
});

export const idParams = z.object({
  body: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
  params: z.object({ propertyId: uuid, categoryId: uuid }),
});

export const roomSchema = z.object({
  body: z.object({
    category_id: uuid,
    room_number: z.string().trim().min(1).max(20),
    floor: z.string().trim().max(20).optional().default(""),
    status: z.enum(["available", "maintenance", "out_of_order"]).optional().default("available"),
    notes: z.string().max(500).optional().default(""),
  }),
  query: z.object({}).optional().default({}),
  params: z.object({ propertyId: uuid }),
});

export const roomPatchSchema = roomSchema.extend({
  params: z.object({ propertyId: uuid, roomId: uuid }),
});

export const rateSchema = z.object({
  body: z.object({
    category_id: uuid,
    name: z.string().trim().min(2).max(80),
    price: money,
    start_date: date.nullable().optional(),
    end_date: date.nullable().optional(),
    min_stay: z.coerce.number().int().min(1).max(30).optional().default(1),
    is_active: z.boolean().optional().default(true),
  }),
  query: z.object({}).optional().default({}),
  params: z.object({ propertyId: uuid }),
});

export const ratePatchSchema = rateSchema.extend({
  params: z.object({ propertyId: uuid, rateId: uuid }),
});

export const inventorySchema = z.object({
  body: z.object({
    category_id: uuid,
    start_date: date,
    end_date: date,
    price_override: money.nullable().optional(),
    stop_sell: z.boolean(),
    clear_price_override: z.boolean().optional().default(false),
  }),
  query: z.object({}).optional().default({}),
  params: z.object({ propertyId: uuid }),
});

export const inventoryQuerySchema = z.object({
  body: z.object({}).optional().default({}),
  query: z.object({
    category_id: uuid.optional(),
    start_date: date,
    end_date: date,
  }),
  params: z.object({ propertyId: uuid }),
});

export const bookingListSchema = z.object({
  body: z.object({}).optional().default({}),
  query: z.object({
    status: z.enum(["pending", "confirmed", "cancelled", "checked_in", "checked_out", "no_show"]).optional(),
    q: z.string().max(120).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(25),
    offset: z.coerce.number().int().min(0).optional().default(0),
  }),
  params: z.object({ propertyId: uuid }),
});

export const bookingPatchSchema = z.object({
  body: z.object({
    status: z.enum(["confirmed", "cancelled", "checked_in", "checked_out", "no_show"]).optional(),
    room_id: uuid.nullable().optional(),
  }),
  query: z.object({}).optional().default({}),
  params: z.object({ propertyId: uuid, bookingId: uuid }),
});

export const extrasSchema = z.object({
  body: z.object({
    extras: z.array(z.object({
      id: z.string().uuid().optional(),
      name: z.string().trim().min(2).max(80),
      description: z.string().trim().max(300).optional().default(""),
      price: money,
      charge: z.enum(["per_night", "per_stay"]).optional().default("per_night"),
      is_active: z.boolean().optional().default(true),
    })).max(30),
  }),
  query: z.object({}).optional().default({}),
  params: z.object({ propertyId: uuid }),
});

export const widgetSchema = z.object({
  body: z.object({
    primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    button_label: z.string().trim().min(2).max(40).optional(),
    show_policies: z.boolean().optional(),
  }),
  query: z.object({}).optional().default({}),
  params: z.object({ propertyId: uuid }),
});

export const availabilityQuery = z.object({
  body: z.object({}).optional().default({}),
  query: z.object({
    check_in: date,
    check_out: date,
    guests: z.coerce.number().int().min(1).max(20),
  }),
  params: z.object({ slug: z.string().min(2).max(80) }),
});

export const publicReservationSchema = z.object({
  body: z.object({
    category_id: uuid,
    guest_name: z.string().trim().min(2).max(120),
    guest_email: z.string().trim().email().max(160),
    guest_phone: z.string().trim().max(30).optional().default(""),
    check_in: date,
    check_out: date,
    adults: z.coerce.number().int().min(1).max(20),
    children: z.coerce.number().int().min(0).max(10).optional().default(0),
    special_requests: z.string().max(1000).optional().default(""),
    pay_now: z.boolean().optional().default(false),
    rooms: z.coerce.number().int().min(1).max(10).optional().default(1),
    extras: z
      .array(z.object({ id: z.string().uuid(), quantity: z.coerce.number().int().min(1).max(10) }))
      .max(12)
      .optional()
      .default([]),
  }),
  query: z.object({}).optional().default({}),
  params: z.object({ slug: z.string().min(2).max(80) }),
});

export const slugParams = z.object({
  body: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
  params: z.object({ slug: z.string().min(2).max(80) }),
});

export const tokenParams = z.object({
  body: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
  params: z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }),
});

export const userCreateSchema = z.object({
  body: z.object({
    full_name: z.string().trim().min(2).max(120),
    email: z.string().trim().email(),
    password: z.string().min(8).max(72),
    phone: z.string().max(30).optional().default(""),
    property_name: z.string().trim().min(2).max(160).optional(),
    city: z.string().max(80).optional().default(""),
    country: z.string().max(80).optional().default(""),
  }),
  query: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
});

export const userPatchSchema = z.object({
  body: z.object({
    full_name: z.string().trim().min(2).max(120).optional(),
    phone: z.string().max(30).nullable().optional(),
    status: z.enum(["active", "blocked", "suspended"]).optional(),
  }),
  query: z.object({}).optional().default({}),
  params: z.object({ userId: uuid }),
});

export const planSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(80),
    description: z.string().max(500).optional().default(""),
    price_monthly: money,
    price_yearly: money,
    max_properties: z.coerce.number().int().min(1).max(1000),
    max_rooms: z.coerce.number().int().min(1).max(100000),
    features: z.array(z.string().trim().min(1).max(80)).max(20).optional().default([]),
    is_active: z.boolean().optional().default(true),
  }),
  query: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
});

export const planPatchSchema = planSchema.extend({
  params: z.object({ planId: uuid }),
});

export const subscriptionUpsertSchema = z.object({
  body: z.object({
    property_id: uuid,
    plan_id: uuid,
    status: z.enum(["trialing", "active", "past_due", "cancelled", "expired"]),
    billing_interval: z.enum(["monthly", "yearly"]),
    current_period_start: date,
    current_period_end: date,
    record_payment: z.boolean().optional().default(false),
  }),
  query: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
});

export const subscriptionPatchSchema = z.object({
  body: z.object({
    plan_id: uuid.optional(),
    status: z.enum(["trialing", "active", "past_due", "cancelled", "expired"]).optional(),
    billing_interval: z.enum(["monthly", "yearly"]).optional(),
    current_period_start: date.optional(),
    current_period_end: date.optional(),
    record_payment: z.boolean().optional().default(false),
  }),
  query: z.object({}).optional().default({}),
  params: z.object({ subscriptionId: uuid }),
});

export const propertyStatusSchema = z.object({
  body: z.object({
    status: z.enum(["active", "blocked", "suspended"]),
  }),
  query: z.object({}).optional().default({}),
  params: z.object({ propertyId: uuid }),
});

export const listQuery = z.object({
  body: z.object({}).optional().default({}),
  query: z.object({
    q: z.string().max(120).optional(),
    status: z.string().max(40).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(25),
    offset: z.coerce.number().int().min(0).optional().default(0),
  }),
  params: z.object({}).optional().default({}),
});

const pageLevel = z.enum(["none", "read", "write"]);

export const coverSchema = z.object({
  body: z.object({
    image: z.string().min(32).max(2_200_000),
  }),
  query: z.object({}).optional().default({}),
  params: z.object({ propertyId: uuid }),
});

export const memberSchema = z.object({
  body: z.object({
    full_name: z.string().trim().min(2).max(120),
    email: z.string().trim().email(),
    password: z.string().min(8).max(72),
    access_role: z.enum(["administrator", "user"]),
    page_access: z.record(z.string(), pageLevel).optional(),
  }),
  query: z.object({}).optional().default({}),
  params: z.object({ propertyId: uuid }),
});

export const memberPatchSchema = z.object({
  body: z.object({
    full_name: z.string().trim().min(2).max(120),
    email: z.string().trim().email(),
    access_role: z.enum(["administrator", "user"]),
    page_access: z.record(z.string(), pageLevel).optional(),
  }),
  query: z.object({}).optional().default({}),
  params: z.object({ propertyId: uuid, userId: uuid }),
});

export const staffSchema = z.object({
  body: z.object({
    full_name: z.string().trim().min(2).max(120),
    email: z.string().trim().email(),
    password: z.string().min(8).max(72),
    access_role: z.enum(["administrator", "user"]),
    page_access: z.record(z.string(), pageLevel).optional(),
  }),
  query: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
});

export const staffPatchSchema = z.object({
  body: z.object({
    full_name: z.string().trim().min(2).max(120),
    email: z.string().trim().email(),
    access_role: z.enum(["administrator", "user"]),
    page_access: z.record(z.string(), pageLevel).optional(),
  }),
  query: z.object({}).optional().default({}),
  params: z.object({ userId: uuid }),
});

export const additionalPropertySchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(160),
    city: z.string().max(80).optional().default(""),
    country: z.string().max(80).optional().default(""),
    timezone: z.string().max(80).optional().default("UTC"),
    currency: z.string().length(3).optional().default("USD"),
  }),
  query: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
});
