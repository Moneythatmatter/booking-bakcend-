import { createHash, randomBytes } from "crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function confirmationCode() {
  const bytes = randomBytes(8);
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

export function guestToken() {
  return randomBytes(32).toString("hex");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

const ZERO_DECIMAL = new Set(["jpy", "krw", "vnd"]);

export function toMinorUnits(amount: number, currency: string) {
  if (ZERO_DECIMAL.has(currency.toLowerCase())) return Math.round(amount);
  return Math.round(amount * 100);
}
