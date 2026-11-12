import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const schema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  CLIENT_ORIGINS: z.string().default("http://localhost:3000,http://localhost:3001"),
  APP_BOOKING_URL: z.string().url().default("http://localhost:3000"),
  APP_ADMIN_URL: z.string().url().default("http://localhost:3001"),
  SMTP_HOST: z.string().optional().default(""),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASS: z.string().optional().default(""),
  SMTP_FROM: z.string().default("Bookings <bookings@example.com>"),
  STRIPE_SECRET_KEY: z.string().optional().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(""),
  SEED_ADMIN_EMAIL: z.string().optional().default(""),
  SEED_ADMIN_PASSWORD: z.string().optional().default(""),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n");
  throw new Error(`Invalid backend environment.\n${details}`);
}

export const env = {
  port: parsed.data.PORT,
  nodeEnv: parsed.data.NODE_ENV,
  supabaseUrl: parsed.data.SUPABASE_URL,
  supabaseServiceRoleKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY,
  clientOrigins: parsed.data.CLIENT_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
  bookingUrl: parsed.data.APP_BOOKING_URL.replace(/\/$/, ""),
  adminUrl: parsed.data.APP_ADMIN_URL.replace(/\/$/, ""),
  smtpHost: parsed.data.SMTP_HOST,
  smtpPort: parsed.data.SMTP_PORT,
  smtpUser: parsed.data.SMTP_USER,
  smtpPass: parsed.data.SMTP_PASS,
  smtpFrom: parsed.data.SMTP_FROM,
  stripeSecretKey: parsed.data.STRIPE_SECRET_KEY,
  stripeWebhookSecret: parsed.data.STRIPE_WEBHOOK_SECRET,
  seedAdminEmail: parsed.data.SEED_ADMIN_EMAIL,
  seedAdminPassword: parsed.data.SEED_ADMIN_PASSWORD,
  paymentsEnabled: Boolean(parsed.data.STRIPE_SECRET_KEY),
};
