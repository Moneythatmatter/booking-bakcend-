export class AppError extends Error {
  status: number;
  code: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code ?? "error";
  }
}

const RPC_ERRORS: Record<string, [number, string, string]> = {
  not_available: [409, "Those dates are no longer available.", "not_available"],
  invalid_dates: [400, "Check-out must be after check-in.", "invalid_dates"],
  property_unavailable: [403, "This property is not accepting bookings.", "property_unavailable"],
  subscription_inactive: [403, "This property is not accepting bookings.", "subscription_inactive"],
  category_unavailable: [400, "That room category is not available.", "category_unavailable"],
  occupancy_exceeded: [400, "Guest count exceeds the room capacity.", "occupancy_exceeded"],
  cannot_cancel: [409, "This reservation can no longer be cancelled.", "cannot_cancel"],
  inventory_in_use: [409, "Those rooms are already reserved.", "inventory_in_use"],
};

export function mapDatabaseError(error: { message?: string; code?: string } | null): AppError | null {
  if (!error) return null;
  const message = error.message ?? "Database error";
  for (const key of Object.keys(RPC_ERRORS)) {
    if (message.includes(key)) {
      const [status, friendly, code] = RPC_ERRORS[key];
      return new AppError(status, friendly, code);
    }
  }
  if (error.code === "23505") {
    return new AppError(409, "That record already exists.", "conflict");
  }
  return new AppError(400, message, "database_error");
}

export function assertNoError(error: { message?: string; code?: string } | null) {
  const mapped = mapDatabaseError(error);
  if (mapped) throw mapped;
}
