import type { Request, Response } from "express";
import { env } from "../config/env";
import { markCheckoutPaid, stripe } from "../services/payment.service";
import { asyncHandler } from "../utils/async";
import { AppError } from "../utils/errors";

export const stripeWebhook = asyncHandler(async (req: Request, res: Response) => {
  if (!stripe || !env.stripeWebhookSecret) {
    throw new AppError(400, "Stripe webhooks are not configured.", "payments_disabled");
  }
  const signature = req.headers["stripe-signature"];
  if (!signature || typeof signature !== "string") {
    throw new AppError(400, "Missing Stripe signature.", "validation_error");
  }
  const event = stripe.webhooks.constructEvent(req.body, signature, env.stripeWebhookSecret);
  if (event.type === "checkout.session.completed") {
    await markCheckoutPaid(event.data.object);
  }
  res.json({ received: true });
});
