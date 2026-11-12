import type { Profile, Property, PropertyUser, ValidatedRequest } from "./index";

declare global {
  namespace Express {
    interface Request {
      user?: Profile;
      property?: Property;
      membership?: PropertyUser;
      permissions?: string[];
      pageAccess?: Record<string, "none" | "read" | "write">;
      validated?: ValidatedRequest;
    }
  }
}

export {};
