import type { NextFunction, Request, Response } from "express";
import { supabaseAdmin } from "../config/supabase";
import type { Property, PropertyUser } from "../types";
import { allows, hotelPageAccess, platformPageAccess, type AccessLevel } from "../utils/access";
import { asyncHandler } from "../utils/async";
import { AppError } from "../utils/errors";
import { permissionsFor } from "../utils/permissions";

export const requirePropertyAccess = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const propertyId = req.params.propertyId;
  if (!propertyId || !req.user) {
    throw new AppError(400, "A property is required.", "property_required");
  }

  const { data: membership, error: memberError } = await supabaseAdmin
    .from("property_users")
    .select("*")
    .eq("property_id", propertyId)
    .eq("user_id", req.user.id)
    .maybeSingle();

  if (memberError) throw new AppError(400, memberError.message, "database_error");
  if (!membership) {
    throw new AppError(403, "You do not have access to this property.", "property_forbidden");
  }

  const { data: property, error: propertyError } = await supabaseAdmin
    .from("properties")
    .select("*")
    .eq("id", propertyId)
    .maybeSingle();

  if (propertyError) throw new AppError(400, propertyError.message, "database_error");
  if (!property) throw new AppError(404, "Property not found.", "not_found");

  req.membership = membership as PropertyUser;
  req.property = property as Property;
  const member = membership as PropertyUser;
  const stored = (req.property?.widget_settings?.desk_access ?? {})[member.user_id];
  const pageAccess = hotelPageAccess({
    role: member.role,
    accessRole: member.access_role ?? stored?.access_role,
    pageAccess: member.page_access ?? stored?.page_access,
  });
  req.pageAccess = pageAccess;
  req.permissions = permissionsFor(req.membership.role);
  next();
});

export function requirePage(page: string, level: "read" | "write") {
  return (req: Request, _res: Response, next: NextFunction) => {
    const access = req.pageAccess?.[page] as AccessLevel | undefined;
    if (!allows(access, level)) {
      next(new AppError(403, "You do not have permission for this action.", "forbidden"));
      return;
    }
    next();
  };
}

export function attachPlatformAccess(req: Request, _res: Response, next: NextFunction) {
  const user = req.user as (typeof req.user & { access_role?: string | null; page_access?: Record<string, string> | null }) | undefined;
  req.pageAccess = platformPageAccess({ accessRole: user?.access_role, pageAccess: user?.page_access });
  next();
}

export function requirePlatformPage(page: string, level: "read" | "write") {
  return (req: Request, _res: Response, next: NextFunction) => {
    const access = req.pageAccess?.[page] as AccessLevel | undefined;
    if (!allows(access, level)) {
      next(new AppError(403, "You do not have permission for this action.", "forbidden"));
      return;
    }
    next();
  };
}

export function requirePermission(permission: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.permissions?.includes(permission)) {
      next(new AppError(403, "You do not have permission for this action.", "forbidden"));
      return;
    }
    next();
  };
}
