import type { Request, Response } from "express";
import {
  createCategory,
  createRoom,
  deleteCategory,
  deleteRate,
  deleteRoom,
  listCategories,
  listInventory,
  listRates,
  listRooms,
  saveExtras,
  saveRate,
  subscriptionView,
  updateCategory,
  updateInventory,
  updateRoom,
} from "../services/catalog.service";
import { listPropertyUsers, savePropertyUser } from "../services/access.service";
import { listActivity } from "../services/activity.service";
import { propertyDashboard, saveCoverImage, updateProperty, updateWidget, widgetPayload } from "../services/property.service";
import { listGuests, listReservations, updateReservation } from "../services/reservation.service";
import { asyncHandler } from "../utils/async";

const property = (req: Request) => req.property!;
const actor = (req: Request) => req.user!.id;

export const dashboard = asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await propertyDashboard(property(req)) });
});

export const showProperty = asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: property(req) });
});

export const patchProperty = asyncHandler(async (req: Request, res: Response) => {
  const data = await updateProperty(property(req), req.validated!.body as never, actor(req));
  res.json({ data });
});

export const extras = asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: property(req).widget_settings?.extras ?? [] });
});

export const putExtras = asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await saveExtras(property(req), req.validated!.body.extras as never, actor(req)) });
});

export const categories = asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await listCategories(property(req).id) });
});

export const postCategory = asyncHandler(async (req: Request, res: Response) => {
  const data = await createCategory(property(req), req.validated!.body, actor(req));
  res.status(201).json({ data });
});

export const patchCategory = asyncHandler(async (req: Request, res: Response) => {
  const data = await updateCategory(property(req), String(req.params.categoryId), req.validated!.body, actor(req));
  res.json({ data });
});

export const removeCategory = asyncHandler(async (req: Request, res: Response) => {
  await deleteCategory(property(req), String(req.params.categoryId), actor(req));
  res.json({ data: { deleted: true } });
});

export const rooms = asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await listRooms(property(req).id) });
});

export const postRoom = asyncHandler(async (req: Request, res: Response) => {
  const data = await createRoom(property(req), req.validated!.body, actor(req));
  res.status(201).json({ data });
});

export const patchRoom = asyncHandler(async (req: Request, res: Response) => {
  const data = await updateRoom(property(req), String(req.params.roomId), req.validated!.body, actor(req));
  res.json({ data });
});

export const removeRoom = asyncHandler(async (req: Request, res: Response) => {
  await deleteRoom(property(req), String(req.params.roomId), actor(req));
  res.json({ data: { deleted: true } });
});

export const rates = asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await listRates(property(req).id) });
});

export const postRate = asyncHandler(async (req: Request, res: Response) => {
  const data = await saveRate(property(req), req.validated!.body, actor(req));
  res.status(201).json({ data });
});

export const patchRate = asyncHandler(async (req: Request, res: Response) => {
  const data = await saveRate(property(req), req.validated!.body, actor(req), String(req.params.rateId));
  res.json({ data });
});

export const removeRate = asyncHandler(async (req: Request, res: Response) => {
  await deleteRate(property(req), String(req.params.rateId), actor(req));
  res.json({ data: { deleted: true } });
});

export const inventory = asyncHandler(async (req: Request, res: Response) => {
  const query = req.validated!.query as { category_id?: string; start_date: string; end_date: string };
  res.json({ data: await listInventory(property(req).id, query.category_id, query.start_date, query.end_date) });
});

export const patchInventory = asyncHandler(async (req: Request, res: Response) => {
  const data = await updateInventory(property(req), req.validated!.body as never, actor(req));
  res.json({ data });
});

export const bookings = asyncHandler(async (req: Request, res: Response) => {
  const data = await listReservations(property(req).id, req.validated!.query as never);
  res.json({ data });
});

export const patchBooking = asyncHandler(async (req: Request, res: Response) => {
  const data = await updateReservation(property(req), String(req.params.bookingId), req.validated!.body as never, actor(req));
  res.json({ data });
});

export const guests = asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await listGuests(property(req).id) });
});

export const subscription = asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: await subscriptionView(property(req).id) });
});

export const widget = asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: widgetPayload(property(req)) });
});

export const patchWidget = asyncHandler(async (req: Request, res: Response) => {
  const data = await updateWidget(property(req), req.validated!.body, actor(req));
  res.json({ data });
});

export const postCover = asyncHandler(async (req: Request, res: Response) => {
  const body = req.validated!.body as { image: string };
  const data = await saveCoverImage(property(req), body.image, actor(req));
  res.json({ data });
});

export const activity = asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: { logs: await listActivity({ propertyId: property(req).id, limit: 100 }) } });
});

export const users = asyncHandler(async (req: Request, res: Response) => {
  res.json({ data: { users: await listPropertyUsers(property(req).id) } });
});

export const postUser = asyncHandler(async (req: Request, res: Response) => {
  const data = await savePropertyUser(property(req), actor(req), req.validated!.body as never);
  res.status(201).json({ data });
});

export const patchUser = asyncHandler(async (req: Request, res: Response) => {
  const data = await savePropertyUser(property(req), actor(req), { ...(req.validated!.body as object), userId: String(req.params.userId) } as never);
  res.json({ data });
});
