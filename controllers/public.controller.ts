import type { Request, Response } from "express";
import { createPublicReservation, getGuestBooking, getPublicProperty, searchAvailability } from "../services/reservation.service";
import { asyncHandler } from "../utils/async";

export const showProperty = asyncHandler(async (req: Request, res: Response) => {
  const data = await getPublicProperty(String(req.validated!.params.slug));
  res.json({ data });
});

export const availability = asyncHandler(async (req: Request, res: Response) => {
  const query = req.validated!.query as { check_in: string; check_out: string; guests: number };
  const data = await searchAvailability(String(req.validated!.params.slug), query.check_in, query.check_out, query.guests);
  res.json({ data });
});

export const book = asyncHandler(async (req: Request, res: Response) => {
  const data = await createPublicReservation(String(req.validated!.params.slug), req.validated!.body as never);
  res.status(201).json({ data });
});

export const guestBooking = asyncHandler(async (req: Request, res: Response) => {
  const data = await getGuestBooking(String(req.validated!.params.token));
  res.json({ data });
});
