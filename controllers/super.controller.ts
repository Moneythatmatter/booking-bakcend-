import type { Request, Response } from "express";
import { listPlatformStaff, savePlatformStaff } from "../services/access.service";
import { createHotelierAccount, setAccountStatus } from "../services/account.service";
import {
  getHotelier,
  listHoteliers,
  listLogs,
  listPlans,
  listPlatformBookings,
  listProperties,
  listSubscriptions,
  patchSubscription,
  platformReports,
  platformStats,
  savePlan,
  setPropertyStatus,
  upsertSubscription,
} from "../services/platform.service";
import { asyncHandler } from "../utils/async";

const actor = (req: Request) => req.user!.id;

export const stats = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ data: await platformStats() });
});

export const reports = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ data: await platformReports() });
});

export const users = asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await listHoteliers(req.validated!.query as never) });
});

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const data = await createHotelierAccount({ ...(req.validated!.body as object), actorId: actor(req) } as never);
  res.status(201).json({ data });
});

export const showUser = asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await getHotelier(String(req.params.userId)) });
});

export const patchUser = asyncHandler(async (req: Request, res: Response) => {
  const body = req.validated!.body as { full_name?: string; phone?: string | null; status?: "active" | "blocked" | "suspended" };
  const data = await setAccountStatus({
    userId: String(req.params.userId),
    status: body.status,
    fullName: body.full_name,
    phone: body.phone,
    actorId: actor(req),
  });
  res.json({ data });
});

export const properties = asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await listProperties(req.validated!.query as never) });
});

export const patchProperty = asyncHandler(async (req: Request, res: Response) => {
  const body = req.validated!.body as { status: "active" | "blocked" | "suspended" };
  const data = await setPropertyStatus(String(req.params.propertyId), body.status, actor(req));
  res.json({ data });
});

export const plans = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ data: await listPlans() });
});

export const postPlan = asyncHandler(async (req: Request, res: Response) => {
  const data = await savePlan(req.validated!.body, actor(req));
  res.status(201).json({ data });
});

export const patchPlan = asyncHandler(async (req: Request, res: Response) => {
  const data = await savePlan(req.validated!.body, actor(req), String(req.params.planId));
  res.json({ data });
});

export const subscriptions = asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await listSubscriptions(req.validated!.query as never) });
});

export const postSubscription = asyncHandler(async (req: Request, res: Response) => {
  const data = await upsertSubscription(req.validated!.body as never, actor(req));
  res.status(201).json({ data });
});

export const patchSubscriptionHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = await patchSubscription(String(req.params.subscriptionId), req.validated!.body as never, actor(req));
  res.json({ data });
});

export const bookings = asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await listPlatformBookings(req.validated!.query as never) });
});

export const logs = asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await listLogs(req.validated!.query as never) });
});

export const staff = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ data: { users: await listPlatformStaff() } });
});

export const postStaff = asyncHandler(async (req: Request, res: Response) => {
  const data = await savePlatformStaff(actor(req), req.validated!.body as never);
  res.status(201).json({ data });
});

export const patchStaff = asyncHandler(async (req: Request, res: Response) => {
  const data = await savePlatformStaff(actor(req), { ...(req.validated!.body as object), userId: String(req.params.userId) } as never);
  res.json({ data });
});
