import type { NextFunction, Request, Response } from "express";
import { supabaseAdmin } from "../config/supabase";
import type { PlatformRole, Profile } from "../types";
import { asyncHandler } from "../utils/async";
import { AppError } from "../utils/errors";

export const requireAuth = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new AppError(401, "Sign in is required.", "unauthorized");
  }

  const token = header.slice("Bearer ".length).trim();
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) {
    throw new AppError(401, "Your session is no longer valid.", "unauthorized");
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profileError) throw new AppError(400, profileError.message, "database_error");
  if (!profile) throw new AppError(403, "This account is not set up yet.", "profile_missing");

  const typed = profile as Profile;
  const metadata = data.user.user_metadata ?? {};
  if (!typed.access_role && (metadata.access_role === "administrator" || metadata.access_role === "user")) {
    typed.access_role = metadata.access_role;
    typed.page_access = metadata.page_access ?? null;
  }
  if (typed.status === "blocked") {
    throw new AppError(403, "This account has been blocked.", "account_blocked");
  }
  if (typed.status === "suspended" && req.method !== "GET") {
    throw new AppError(403, "This account is suspended. You can view data but cannot make changes.", "account_suspended");
  }

  req.user = typed;
  next();
});

export function requirePlatformRole(role: PlatformRole) {
  return (_req: Request, _res: Response, next: NextFunction) => {
    if (_req.user?.platform_role !== role) {
      next(new AppError(403, "You do not have access to this area.", "forbidden"));
      return;
    }
    next();
  };
}
