import { randomBytes } from "crypto";

export function slugify(input: string) {
  const slug = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "hotel";
}

export function uniqueSlug(input: string) {
  return `${slugify(input)}-${randomBytes(2).toString("hex")}`;
}
