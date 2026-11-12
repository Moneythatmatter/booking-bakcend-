import { supabaseAdmin } from "../config/supabase";
import type { Profile } from "../types";
import { AppError, assertNoError } from "../utils/errors";
import { platformPageAccess } from "../utils/access";
import { permissionsFor } from "../utils/permissions";
import { logActivity } from "./log.service";
import { assertCanAddProperty, createPropertyForOwner, listPropertiesForUser } from "./property.service";

export async function sessionContext(user: Profile) {
  if (user.platform_role === "super_admin") {
    return {
      profile: user,
      properties: [],
      permissions: ["platform.manage"],
      page_access: platformPageAccess({ accessRole: user.access_role, pageAccess: user.page_access }),
    };
  }
  const properties = await listPropertiesForUser(user.id);
  const role = properties[0]?.role;
  return {
    profile: user,
    properties,
    permissions: role ? permissionsFor(role) : [],
  };
}

export async function provisionHotelier(
  user: Profile,
  input: {
    full_name: string;
    property_name: string;
    city: string;
    country: string;
    phone: string;
    timezone: string;
    currency: string;
  },
) {
  if (user.platform_role !== "hotelier") {
    throw new AppError(403, "This account cannot create a hotel.", "forbidden");
  }

  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .update({ full_name: input.full_name, phone: input.phone || null })
    .eq("id", user.id);
  assertNoError(profileError);

  const existing = await listPropertiesForUser(user.id);
  if (existing.length) {
    return { profile: { ...user, full_name: input.full_name }, property: existing[0], created: false };
  }

  const property = await createPropertyForOwner({
    owner: { ...user, full_name: input.full_name },
    name: input.property_name,
    city: input.city,
    country: input.country,
    timezone: input.timezone,
    currency: input.currency,
  });

  await logActivity({
    actorId: user.id,
    propertyId: property.id,
    action: "profile.provisioned",
    entityType: "profile",
    entityId: user.id,
  });

  return { profile: { ...user, full_name: input.full_name }, property, created: true };
}

export async function createAdditionalProperty(
  user: Profile,
  input: { name: string; city: string; country: string; timezone: string; currency: string },
) {
  await assertCanAddProperty(user.id);
  return createPropertyForOwner({
    owner: user,
    name: input.name,
    city: input.city,
    country: input.country,
    timezone: input.timezone,
    currency: input.currency,
  });
}

export async function createHotelierAccount(input: {
  full_name: string;
  email: string;
  password: string;
  phone?: string;
  property_name?: string;
  city?: string;
  country?: string;
  actorId: string;
}) {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.full_name },
  });
  if (error || !data.user) {
    throw new AppError(409, error?.message ?? "Could not create the hotelier.", "conflict");
  }

  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .update({ full_name: input.full_name, phone: input.phone || null, platform_role: "hotelier", status: "active" })
    .eq("id", data.user.id);
  assertNoError(profileError);

  const { data: profile, error: readError } = await supabaseAdmin.from("profiles").select("*").eq("id", data.user.id).single();
  assertNoError(readError);

  let property = null;
  if (input.property_name) {
    property = await createPropertyForOwner({
      owner: profile as Profile,
      name: input.property_name,
      city: input.city,
      country: input.country,
      actorId: input.actorId,
    });
  }

  await logActivity({
    actorId: input.actorId,
    propertyId: property?.id,
    action: "hotelier.created",
    entityType: "profile",
    entityId: data.user.id,
    metadata: { email: input.email },
  });

  return { profile, property };
}

export async function setAccountStatus(input: {
  userId: string;
  status?: "active" | "blocked" | "suspended";
  fullName?: string;
  phone?: string | null;
  actorId: string;
}) {
  if (input.userId === input.actorId) {
    throw new AppError(400, "You cannot change your own account status.", "forbidden");
  }

  const { data: profile, error } = await supabaseAdmin.from("profiles").select("*").eq("id", input.userId).maybeSingle();
  assertNoError(error);
  if (!profile) throw new AppError(404, "User not found.", "not_found");
  if (profile.platform_role === "super_admin") {
    throw new AppError(403, "Super admin accounts are managed outside this action.", "forbidden");
  }

  const patch: Record<string, unknown> = {};
  if (input.fullName) patch.full_name = input.fullName;
  if (input.phone !== undefined) patch.phone = input.phone || null;
  if (input.status) patch.status = input.status;

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("profiles")
    .update(patch)
    .eq("id", input.userId)
    .select("*")
    .single();
  assertNoError(updateError);

  if (input.status) {
    const ban = input.status === "blocked" ? "876000h" : "none";
    const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(input.userId, { ban_duration: ban });
    if (banError) throw new AppError(400, banError.message, "auth_error");

    const { data: owned, error: ownedError } = await supabaseAdmin
      .from("property_users")
      .select("property_id")
      .eq("user_id", input.userId)
      .eq("role", "owner");
    assertNoError(ownedError);
    const ids = (owned ?? []).map((row) => row.property_id);
    if (ids.length) {
      const { error: propertyError } = await supabaseAdmin.from("properties").update({ status: input.status }).in("id", ids);
      assertNoError(propertyError);
    }
  }

  await logActivity({
    actorId: input.actorId,
    action: "profile.status_changed",
    entityType: "profile",
    entityId: input.userId,
    metadata: { status: input.status ?? profile.status },
  });

  return updated as Profile;
}
