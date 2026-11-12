import type { Request, Response } from "express";
import { createAdditionalProperty, provisionHotelier, sessionContext } from "../services/account.service";
import { asyncHandler } from "../utils/async";

export const me = asyncHandler(async (req: Request, res: Response) => {
  const data = await sessionContext(req.user!);
  res.json({ data });
});

export const provision = asyncHandler(async (req: Request, res: Response) => {
  const data = await provisionHotelier(req.user!, req.validated!.body as never);
  res.status(data.created ? 201 : 200).json({ data });
});

export const createProperty = asyncHandler(async (req: Request, res: Response) => {
  const property = await createAdditionalProperty(req.user!, req.validated!.body as never);
  res.status(201).json({ data: property });
});
