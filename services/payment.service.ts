import Stripe from "stripe";
import { env } from "../config/env";
import { supabaseAdmin } from "../config/supabase";
import type { Property, Reservation } from "../types";
import { AppError, assertNoError } from "../utils/errors";
import { toMinorUnits } from "../utils/tokens";
import { sendReservationEmail } from "./email.service";
import { logActivity } from "./log.service";

export const stripe = env.stripeSecretKey ? new Stripe(env.stripeSecretKey) : null;

export async function createGuestCheckout(reservation: Reservation, property: Property, token: string) {
  if (!stripe) throw new AppError(400, "Online payment is not configured.", "payments_disabled");

  const { data: payment, error } = await supabaseAdmin
    .from("payments")
    .insert({
      property_id: property.id,
      reservation_id: reservation.id,
      amount: reservation.total_amount,
      currency: reservation.currency,
      type: "guest_booking",
      status: "pending",
      provider: "stripe",
    })
    .select("*")
    .single();
  assertNoError(error);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: reservation.guest_email,
    success_url: `${env.bookingUrl}/h/${property.slug}/confirmation?code=${reservation.confirmation_code}&token=${token}`,
    cancel_url: `${env.bookingUrl}/h/${property.slug}?payment=cancelled`,
    metadata: { reservation_id: reservation.id, payment_id: payment.id, access_token: token },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: reservation.currency.toLowerCase(),
          unit_amount: toMinorUnits(Number(reservation.total_amount), reservation.currency),
          product_data: {
            name: `${property.name} · ${reservation.confirmation_code}`,
            description: `${reservation.check_in} to ${reservation.check_out}`,
          },
        },
      },
    ],
  });

  await supabaseAdmin.from("payments").update({ provider_ref: session.id }).eq("id", payment.id);
  if (!session.url) throw new AppError(502, "Payment provider did not return a checkout URL.", "payment_error");
  return { url: session.url, payment_id: payment.id as string };
}

export async function markCheckoutPaid(session: Stripe.Checkout.Session) {
  const reservationId = session.metadata?.reservation_id;
  const paymentId = session.metadata?.payment_id;
  if (!reservationId) return;

  const { data: reservation, error } = await supabaseAdmin.from("reservations").select("*").eq("id", reservationId).maybeSingle();
  assertNoError(error);
  if (!reservation || reservation.status === "cancelled") return;
  if (reservation.payment_status === "paid" && reservation.status === "confirmed") return;

  if (paymentId) {
    await supabaseAdmin.from("payments").update({ status: "paid", provider_ref: session.id }).eq("id", paymentId);
  }

  const { error: updateError } = await supabaseAdmin
    .from("reservations")
    .update({ status: "confirmed", payment_status: "paid", hold_expires_at: null })
    .eq("id", reservationId)
    .eq("status", "pending");
  assertNoError(updateError);

  const { data: property } = await supabaseAdmin.from("properties").select("name").eq("id", reservation.property_id).maybeSingle();
  await logActivity({
    propertyId: reservation.property_id,
    action: "payment.received",
    entityType: "reservation",
    entityId: reservationId,
    metadata: { provider_ref: session.id },
  });

  await sendReservationEmail({
    kind: "confirmed",
    to: reservation.guest_email,
    guestName: reservation.guest_name,
    propertyName: property?.name ?? "your hotel",
    confirmationCode: reservation.confirmation_code,
    checkIn: reservation.check_in,
    checkOut: reservation.check_out,
    total: String(reservation.total_amount),
    currency: reservation.currency,
    token: session.metadata?.access_token ?? "",
  }).catch((emailError) => console.error(emailError));
}
