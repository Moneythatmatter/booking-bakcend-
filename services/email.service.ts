import nodemailer from "nodemailer";
import { env } from "../config/env";
import { supabaseAdmin } from "../config/supabase";

interface Message {
  to: string;
  subject: string;
  text: string;
}

function transport() {
  if (!env.smtpHost) return null;
  return nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpPort === 465,
    auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
  });
}

export async function sendEmail(message: Message) {
  const mailer = transport();
  let status = "logged";
  let errorText: string | null = null;

  if (!mailer) {
    console.log(`\n[email:logged] To: ${message.to}\nSubject: ${message.subject}\n${message.text}\n`);
  } else {
    try {
      await mailer.sendMail({
        from: env.smtpFrom,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
      status = "sent";
    } catch (error) {
      status = "failed";
      errorText = error instanceof Error ? error.message : "Email failed";
      console.error("email send failed", errorText);
    }
  }

  await supabaseAdmin.from("email_logs").insert({
    to_email: message.to,
    subject: message.subject,
    body: message.text,
    status,
    error: errorText,
  });

  return status;
}

export function bookingLink(token: string) {
  return `${env.bookingUrl}/booking/${token}`;
}

export async function sendReservationEmail(input: {
  kind: "confirmed" | "hold";
  to: string;
  guestName: string;
  propertyName: string;
  confirmationCode: string;
  checkIn: string;
  checkOut: string;
  total: string;
  currency: string;
  token: string;
  checkoutUrl?: string | null;
}) {
  const link = bookingLink(input.token);
  const subject =
    input.kind === "confirmed"
      ? `Reservation confirmed — ${input.propertyName}`
      : `Complete your booking — ${input.propertyName}`;

  const lines = [
    `Hello ${input.guestName},`,
    "",
    input.kind === "confirmed"
      ? `Your stay at ${input.propertyName} is confirmed.`
      : `Your room at ${input.propertyName} is held for 30 minutes. Complete payment to confirm it.`,
    "",
    `Confirmation code: ${input.confirmationCode}`,
    `Check-in: ${input.checkIn}`,
    `Check-out: ${input.checkOut}`,
    `Total: ${input.currency} ${input.total}`,
  ];
  if (input.token) {
    lines.push("", `View this booking without an account: ${link}`);
  }
  if (input.checkoutUrl) {
    lines.push("", `Pay now: ${input.checkoutUrl}`);
  }
  lines.push("", "If you did not make this request, you can ignore this email.");

  return sendEmail({ to: input.to, subject, text: lines.join("\n") });
}
