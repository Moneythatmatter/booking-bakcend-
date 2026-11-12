import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { provisionSchema, publicReservationSchema } from "../validations/schemas";
import { assertDateRange, eachNight } from "../utils/dates";
import { AppError } from "../utils/errors";
import { hasPermission, permissionsFor } from "../utils/permissions";
import { confirmationCode, guestToken, hashToken } from "../utils/tokens";
import { slugify } from "../utils/slug";

describe("booking guards", () => {
  it("rejects a stay that does not move forward", () => {
    assert.throws(() => assertDateRange("2026-11-02", "2026-11-02"), (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.status, 400);
      return true;
    });
  });

  it("counts nights without the checkout date", () => {
    assert.deepEqual(eachNight("2026-11-01", "2026-11-04"), ["2026-11-01", "2026-11-02", "2026-11-03"]);
  });

  it("keeps staff from managing rooms, prices, or bookings", () => {
    const staff = permissionsFor("staff");
    assert.equal(hasPermission("staff", "bookings.read"), true);
    assert.equal(staff.includes("rooms.manage"), false);
    assert.equal(staff.includes("rates.manage"), false);
    assert.equal(staff.includes("bookings.manage"), false);
    assert.equal(staff.includes("widget.manage"), false);
    assert.equal(permissionsFor("owner").includes("rooms.manage"), true);
  });

  it("hashes guest links and never returns the raw token shape from the hash", () => {
    const token = guestToken();
    assert.match(token, /^[a-f0-9]{64}$/);
    assert.equal(hashToken(token), hashToken(token));
    assert.notEqual(hashToken(token), token);
    assert.equal(hashToken(token).length, 64);
    assert.match(confirmationCode(), /^[A-Z2-9]{8}$/);
  });

  it("rejects a public booking with a bad email or inverted dates", () => {
    const result = publicReservationSchema.safeParse({
      body: {
        category_id: "6d8f0c3e-1b7a-4d2e-9c11-0a0b1c2d3e4f",
        guest_name: "A",
        guest_email: "not-an-email",
        check_in: "2026-12-02",
        check_out: "2026-12-01",
        adults: 2,
      },
      query: {},
      params: { slug: "harbor-inn" },
    });
    assert.equal(result.success, false);
  });

  it("builds a url-safe property slug", () => {
    assert.equal(slugify("  Harbor & Inn  "), "harbor-inn");
  });

  it("requires a property name when a hotelier provisions an account", () => {
    const result = provisionSchema.safeParse({
      body: { full_name: "Ada Lovelace", property_name: "A" },
      query: {},
      params: {},
    });
    assert.equal(result.success, false);
  });
});
