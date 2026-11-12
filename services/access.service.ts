import { supabaseAdmin } from "../config/supabase";
import type { Profile, Property } from "../types";
import { HOTEL_PAGES, PLATFORM_PAGES, allWrite, hotelPageAccess, platformPageAccess, type AccessLevel, type AccessRole } from "../utils/access";
import { AppError, assertNoError } from "../utils/errors";
import { fieldChanges, logActivity } from "./log.service";

async function loadProperty(propertyId: string) {
  const { data, error } = await supabaseAdmin.from("properties").select("*").eq("id", propertyId).single();
  assertNoError(error);
  return data as Property;
}

async function rememberDeskAccess(property: Property, userId: string, accessRole: string, pageAccess: Record<string, AccessLevel>) {
  const current = await loadProperty(property.id);
  const deskAccess = { ...(current.widget_settings?.desk_access ?? {}), [userId]: { access_role: accessRole, page_access: pageAccess } };
  const { error } = await supabaseAdmin
    .from("properties")
    .update({ widget_settings: { ...(current.widget_settings ?? {}), desk_access: deskAccess } })
    .eq("id", property.id);
  assertNoError(error);
}

function pagesFor(role: AccessRole, pages: Record<string, string> | undefined, catalog: readonly { key: string }[]) {
  if (role === "administrator") return allWrite(catalog);
  const stored = pages ?? {};
  return Object.fromEntries(
    catalog.map((page) => {
      const value = stored[page.key];
      const level: AccessLevel = value === "read" || value === "write" ? value : "none";
      return [page.key, level];
    }),
  );
}

async function profileByEmail(email: string) {
  const { data, error } = await supabaseAdmin.from("profiles").select("*").ilike("email", email).maybeSingle();
  assertNoError(error);
  return (data as Profile | null) ?? null;
}

async function createLogin(input: { email: string; password: string; fullName: string }) {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.fullName },
  });
  if (error || !data.user) throw new AppError(409, error?.message ?? "Could not create that user.", "conflict");
  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .update({ full_name: input.fullName, status: "active" })
    .eq("id", data.user.id);
  assertNoError(profileError);
  const { data: profile, error: readError } = await supabaseAdmin.from("profiles").select("*").eq("id", data.user.id).single();
  assertNoError(readError);
  return profile as Profile;
}

export async function listPropertyUsers(propertyId: string) {
  const property = await loadProperty(propertyId);
  const first = await supabaseAdmin
    .from("property_users")
    .select("id, role, access_role, page_access, created_at, user_id, user:profiles(id, full_name, email, status)")
    .eq("property_id", propertyId)
    .order("created_at");
  const fallback = first.error && /access_role|page_access/.test(first.error.message)
    ? await supabaseAdmin
        .from("property_users")
        .select("id, role, created_at, user_id, user:profiles(id, full_name, email, status)")
        .eq("property_id", propertyId)
        .order("created_at")
    : null;
  const error = fallback ? fallback.error : first.error;
  assertNoError(error);
  const rows = (fallback ? fallback.data : first.data) ?? [];
  return rows.map((row) => {
    const record = row as {
      id: string;
      role: string;
      access_role?: string | null;
      page_access?: Record<string, string> | null;
      created_at: string;
      user_id: string;
      user: { id: string; full_name: string; email: string; status: string } | Array<{ id: string; full_name: string; email: string; status: string }> | null;
    };
    const stored = property.widget_settings?.desk_access?.[record.user_id];
    const accessRole = record.access_role ?? stored?.access_role ?? null;
    const resolved = record.role === "owner" || accessRole === "administrator" || (!accessRole && record.role === "manager") ? "administrator" : "user";
    const user = Array.isArray(record.user) ? record.user[0] : record.user;
    return {
      id: record.id,
      role: record.role,
      user,
      access_role: resolved,
      page_access: hotelPageAccess({
        role: record.role,
        accessRole,
        pageAccess: record.page_access ?? stored?.page_access,
      }),
    };
  });
}

export async function savePropertyUser(
  property: Property,
  actorId: string,
  input: { full_name: string; email: string; password?: string; access_role: AccessRole; page_access?: Record<string, string>; userId?: string },
) {
  const pageAccess = pagesFor(input.access_role, input.page_access, HOTEL_PAGES);
  let profile = input.userId ? null : await profileByEmail(input.email);

  if (input.userId) {
    const { data, error } = await supabaseAdmin.from("profiles").select("*").eq("id", input.userId).maybeSingle();
    assertNoError(error);
    if (!data) throw new AppError(404, "User not found.", "not_found");
    profile = data as Profile;
  }

  if (profile?.platform_role === "super_admin") {
    throw new AppError(409, "That email belongs to a platform admin.", "conflict");
  }

  if (!profile) {
    if (!input.password || input.password.length < 8) throw new AppError(400, "A password of at least 8 characters is required.", "validation");
    profile = await createLogin({ email: input.email, password: input.password, fullName: input.full_name });
    const { error } = await supabaseAdmin.from("profiles").update({ platform_role: "hotelier", full_name: input.full_name }).eq("id", profile.id);
    assertNoError(error);
  } else if (input.full_name) {
    const { error } = await supabaseAdmin.from("profiles").update({ full_name: input.full_name }).eq("id", profile.id);
    assertNoError(error);
  }

  const rich = await supabaseAdmin
    .from("property_users")
    .select("id, role, access_role, page_access")
    .eq("property_id", property.id)
    .eq("user_id", profile.id)
    .maybeSingle();
  const basic = rich.error
    ? await supabaseAdmin.from("property_users").select("id, role").eq("property_id", property.id).eq("user_id", profile.id).maybeSingle()
    : null;
  const existingError = basic ? basic.error : rich.error;
  const existing = (basic ? basic.data : rich.data) as { id: string; role: string; access_role?: string | null; page_access?: Record<string, string> | null } | null;
  assertNoError(existingError);

  const role = existing?.role === "owner" ? "owner" : input.access_role === "administrator" ? "manager" : "staff";
  const accessRole = existing?.role === "owner" ? "administrator" : input.access_role;
  const row = { access_role: accessRole, page_access: pageAccess, role };
  const membership = existing
    ? await supabaseAdmin.from("property_users").update(row).eq("id", existing.id)
    : await supabaseAdmin.from("property_users").insert({ property_id: property.id, user_id: profile.id, ...row });
  if (membership.error && /access_role|page_access/.test(membership.error.message)) {
    const basic = existing
      ? await supabaseAdmin.from("property_users").update({ role }).eq("id", existing.id)
      : await supabaseAdmin.from("property_users").insert({ property_id: property.id, user_id: profile.id, role });
    assertNoError(basic.error);
    await rememberDeskAccess(property, profile.id, accessRole, pageAccess);
  } else {
    assertNoError(membership.error);
  }

  const previousRole = !existing ? "" : existing.access_role === "user" || existing.role === "staff" ? "user" : "administrator";
  const previousAccess = existing
    ? hotelPageAccess({
        role: existing.role,
        accessRole: existing.access_role ?? property.widget_settings?.desk_access?.[profile.id]?.access_role ?? previousRole,
        pageAccess: existing.page_access ?? property.widget_settings?.desk_access?.[profile.id]?.page_access,
      })
    : null;
  const pageChanges = previousAccess
    ? HOTEL_PAGES.flatMap((page) => {
        const from = previousAccess[page.key];
        const to = pageAccess[page.key] ?? "none";
        return from === to ? [] : [{ field: page.label, from, to }];
      })
    : [];
  const profileChanges = existing
    ? fieldChanges(
        { name: profile.full_name, email: profile.email, access_role: previousRole },
        { name: input.full_name, email: input.email, access_role: accessRole },
        ["name", "email", "access_role"],
      )
    : [];
  await logActivity({
    actorId,
    propertyId: property.id,
    action: existing ? "user.access_updated" : "user.created",
    entityType: "profile",
    entityId: profile.id,
    metadata: {
      email: input.email,
      name: input.full_name,
      access_role: accessRole,
      changes: [...profileChanges, ...pageChanges],
      previous: existing
        ? {
            Name: profile.full_name,
            Email: profile.email,
            Role: previousRole,
            ...Object.fromEntries(HOTEL_PAGES.map((page) => [page.label, previousAccess?.[page.key] ?? "none"])),
          }
        : undefined,
      snapshot: {
        Name: input.full_name,
        Email: input.email,
        Role: accessRole,
        ...Object.fromEntries(HOTEL_PAGES.map((page) => [page.label, pageAccess[page.key]])),
      },
      added: existing
        ? undefined
        : { Name: input.full_name, Email: input.email, Role: accessRole, ...Object.fromEntries(HOTEL_PAGES.map((page) => [page.label, pageAccess[page.key]])) },
    },
  });

  return { id: profile.id, email: profile.email, full_name: input.full_name, access_role: row.access_role, page_access: pageAccess };
}

export async function listPlatformStaff() {
  const first = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, email, status, access_role, page_access, created_at")
    .eq("platform_role", "super_admin")
    .order("created_at");
  if (!first.error) {
    return (first.data ?? []).map((row) => ({
      ...row,
      access_role: row.access_role === "user" ? "user" : "administrator",
      page_access: row.access_role === "user" ? row.page_access : allWrite(PLATFORM_PAGES),
    }));
  }
  if (!/access_role|page_access/.test(first.error.message)) assertNoError(first.error);
  const { data: profiles, error } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, email, status, created_at")
    .eq("platform_role", "super_admin")
    .order("created_at");
  assertNoError(error);
  const listed = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const metadata = new Map((listed.data.users ?? []).map((user) => [user.id, user.user_metadata ?? {}]));
  return (profiles ?? []).map((row) => {
    const meta = metadata.get(row.id) ?? {};
    const accessRole = meta.access_role === "user" ? "user" : "administrator";
    return {
      ...row,
      access_role: accessRole,
      page_access: accessRole === "user" ? (meta.page_access ?? {}) : allWrite(PLATFORM_PAGES),
    };
  });
}

export async function savePlatformStaff(
  actorId: string,
  input: { full_name: string; email: string; password?: string; access_role: AccessRole; page_access?: Record<string, string>; userId?: string },
) {
  if (input.userId === actorId && input.access_role === "user") {
    throw new AppError(400, "You cannot remove your own administrator access.", "forbidden");
  }
  const pageAccess = pagesFor(input.access_role, input.page_access, PLATFORM_PAGES);
  let profile = input.userId ? null : await profileByEmail(input.email);

  if (input.userId) {
    const { data, error } = await supabaseAdmin.from("profiles").select("*").eq("id", input.userId).maybeSingle();
    assertNoError(error);
    if (!data) throw new AppError(404, "User not found.", "not_found");
    profile = data as Profile;
    if (profile.platform_role !== "super_admin") throw new AppError(409, "That account is not a platform user.", "conflict");
  }

  if (profile && profile.platform_role === "hotelier") {
    throw new AppError(409, "That email already belongs to a hotelier.", "conflict");
  }

  const created = !profile;
  if (!profile) {
    if (!input.password || input.password.length < 8) throw new AppError(400, "A password of at least 8 characters is required.", "validation");
    profile = await createLogin({ email: input.email, password: input.password, fullName: input.full_name });
  }

  const { error } = await supabaseAdmin
    .from("profiles")
    .update({
      full_name: input.full_name,
      platform_role: "super_admin",
      status: "active",
      access_role: input.access_role,
      page_access: pageAccess,
    })
    .eq("id", profile.id);
  if (error && /access_role|page_access/.test(error.message)) {
    const basic = await supabaseAdmin
      .from("profiles")
      .update({ full_name: input.full_name, platform_role: "super_admin", status: "active" })
      .eq("id", profile.id);
    assertNoError(basic.error);
  } else {
    assertNoError(error);
  }
  const { error: metaError } = await supabaseAdmin.auth.admin.updateUserById(profile.id, {
    user_metadata: { full_name: input.full_name, access_role: input.access_role, page_access: pageAccess },
  });
  if (metaError) throw new AppError(400, metaError.message, "auth_error");

  const previousPlatform = created ? null : platformPageAccess({ accessRole: profile.access_role, pageAccess: profile.page_access });
  const platformChanges = previousPlatform
    ? PLATFORM_PAGES.flatMap((page) =>
        previousPlatform[page.key] === pageAccess[page.key] ? [] : [{ field: page.label, from: previousPlatform[page.key], to: pageAccess[page.key] }],
      )
    : [];
  await logActivity({
    actorId,
    action: created ? "user.created" : "user.access_updated",
    entityType: "profile",
    entityId: profile.id,
    metadata: {
      email: profile.email,
      name: input.full_name,
      access_role: input.access_role,
      changes: created
        ? []
        : [
            ...fieldChanges(
              { name: profile.full_name, email: profile.email, access_role: profile.access_role || "administrator" },
              { name: input.full_name, email: profile.email, access_role: input.access_role },
              ["name", "email", "access_role"],
            ),
            ...platformChanges,
          ],
      previous: created
        ? undefined
        : {
            Name: profile.full_name,
            Email: profile.email,
            Role: profile.access_role || "administrator",
            ...Object.fromEntries(PLATFORM_PAGES.map((page) => [page.label, previousPlatform?.[page.key] ?? "none"])),
          },
      snapshot: {
        Name: input.full_name,
        Email: profile.email,
        Role: input.access_role,
        ...Object.fromEntries(PLATFORM_PAGES.map((page) => [page.label, pageAccess[page.key]])),
      },
      added: created ? { Name: input.full_name, Email: profile.email, Role: input.access_role, ...Object.fromEntries(PLATFORM_PAGES.map((page) => [page.label, pageAccess[page.key]])) } : undefined,
    },
  });

  return { id: profile.id, email: profile.email, full_name: input.full_name, access_role: input.access_role, page_access: pageAccess };
}

function missingColumn(message: string) {
  if (/access_role|page_access|cover_image_url/.test(message)) {
    return new AppError(500, "Run the database migration 005_access_and_cover.sql in Supabase, then try again.", "migration_required");
  }
  return new AppError(400, message, "database_error");
}
