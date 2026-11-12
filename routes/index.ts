import { Router } from "express";
import rateLimit from "express-rate-limit";
import * as authController from "../controllers/auth.controller";
import * as hotelierController from "../controllers/hotelier.controller";
import * as publicController from "../controllers/public.controller";
import * as superController from "../controllers/super.controller";
import { attachPlatformAccess, requirePage, requirePlatformPage, requirePropertyAccess } from "../middleware/access";
import { requireAuth, requirePlatformRole } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  additionalPropertySchema,
  availabilityQuery,
  bookingListSchema,
  bookingPatchSchema,
  categoryPatchSchema,
  categorySchema,
  extrasSchema,
  coverSchema,
  memberPatchSchema,
  memberSchema,
  idParams,
  inventoryQuerySchema,
  inventorySchema,
  listQuery,
  planPatchSchema,
  planSchema,
  propertyParams,
  propertyStatusSchema,
  propertyUpdateSchema,
  provisionSchema,
  publicReservationSchema,
  ratePatchSchema,
  rateSchema,
  roomPatchSchema,
  roomSchema,
  slugParams,
  staffPatchSchema,
  staffSchema,
  subscriptionPatchSchema,
  subscriptionUpsertSchema,
  tokenParams,
  userCreateSchema,
  userPatchSchema,
  widgetSchema,
} from "../validations/schemas";

const bookingLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: "Too many booking attempts. Try again shortly.", code: "rate_limited" } },
});

const provisionLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

export const api = Router();

api.get("/health", (_req, res) => {
  res.json({ data: { ok: true } });
});

const auth = Router();
auth.get("/me", requireAuth, authController.me);
auth.post("/provision", provisionLimit, requireAuth, requirePlatformRole("hotelier"), validate(provisionSchema), authController.provision);
auth.post("/properties", requireAuth, requirePlatformRole("hotelier"), validate(additionalPropertySchema), authController.createProperty);
api.use("/auth", auth);

const publicRoutes = Router();
publicRoutes.get("/properties/:slug", validate(slugParams), publicController.showProperty);
publicRoutes.get("/properties/:slug/availability", validate(availabilityQuery), publicController.availability);
publicRoutes.post("/properties/:slug/reservations", bookingLimit, validate(publicReservationSchema), publicController.book);
publicRoutes.get("/bookings/:token", validate(tokenParams), publicController.guestBooking);
api.use("/public", publicRoutes);

const propertyRoutes = Router({ mergeParams: true });
propertyRoutes.use(requirePropertyAccess);
propertyRoutes.get("/dashboard", requirePage("dashboard", "read"), hotelierController.dashboard);
propertyRoutes.get("/", requirePage("property", "read"), hotelierController.showProperty);
propertyRoutes.patch("/", requirePage("property", "write"), validate(propertyUpdateSchema), hotelierController.patchProperty);
propertyRoutes.post("/cover", requirePage("property", "write"), validate(coverSchema), hotelierController.postCover);
propertyRoutes.get("/activity", requirePage("activity", "read"), hotelierController.activity);
propertyRoutes.get("/users", requirePage("users", "read"), hotelierController.users);
propertyRoutes.post("/users", requirePage("users", "write"), validate(memberSchema), hotelierController.postUser);
propertyRoutes.patch("/users/:userId", requirePage("users", "write"), validate(memberPatchSchema), hotelierController.patchUser);
propertyRoutes.get("/categories", requirePage("categories", "read"), validate(propertyParams), hotelierController.categories);
propertyRoutes.post("/categories", requirePage("categories", "write"), validate(categorySchema), hotelierController.postCategory);
propertyRoutes.patch("/categories/:categoryId", requirePage("categories", "write"), validate(categoryPatchSchema), hotelierController.patchCategory);
propertyRoutes.delete("/categories/:categoryId", requirePage("categories", "write"), validate(idParams), hotelierController.removeCategory);
propertyRoutes.get("/extras", requirePage("extras", "read"), hotelierController.extras);
propertyRoutes.put("/extras", requirePage("extras", "write"), validate(extrasSchema), hotelierController.putExtras);
propertyRoutes.get("/rooms", requirePage("rooms", "read"), hotelierController.rooms);
propertyRoutes.post("/rooms", requirePage("rooms", "write"), validate(roomSchema), hotelierController.postRoom);
propertyRoutes.patch("/rooms/:roomId", requirePage("rooms", "write"), validate(roomPatchSchema), hotelierController.patchRoom);
propertyRoutes.delete("/rooms/:roomId", requirePage("rooms", "write"), hotelierController.removeRoom);
propertyRoutes.get("/rates", requirePage("pricing", "read"), hotelierController.rates);
propertyRoutes.post("/rates", requirePage("pricing", "write"), validate(rateSchema), hotelierController.postRate);
propertyRoutes.patch("/rates/:rateId", requirePage("pricing", "write"), validate(ratePatchSchema), hotelierController.patchRate);
propertyRoutes.delete("/rates/:rateId", requirePage("pricing", "write"), hotelierController.removeRate);
propertyRoutes.get("/inventory", requirePage("availability", "read"), validate(inventoryQuerySchema), hotelierController.inventory);
propertyRoutes.patch("/inventory", requirePage("availability", "write"), validate(inventorySchema), hotelierController.patchInventory);
propertyRoutes.get("/bookings", requirePage("bookings", "read"), validate(bookingListSchema), hotelierController.bookings);
propertyRoutes.patch("/bookings/:bookingId", requirePage("bookings", "write"), validate(bookingPatchSchema), hotelierController.patchBooking);
propertyRoutes.get("/guests", requirePage("guests", "read"), hotelierController.guests);
propertyRoutes.get("/subscription", requirePage("subscription", "read"), hotelierController.subscription);
propertyRoutes.get("/widget", requirePage("widget", "read"), hotelierController.widget);
propertyRoutes.patch("/widget", requirePage("widget", "write"), validate(widgetSchema), hotelierController.patchWidget);

const hotelier = Router();
hotelier.use(requireAuth, requirePlatformRole("hotelier"));
hotelier.use("/properties/:propertyId", propertyRoutes);
api.use("/hotelier", hotelier);

const superAdmin = Router();
superAdmin.use(requireAuth, requirePlatformRole("super_admin"), attachPlatformAccess);
superAdmin.get("/stats", requirePlatformPage("overview", "read"), superController.stats);
superAdmin.get("/reports", requirePlatformPage("reports", "read"), superController.reports);
superAdmin.get("/users", requirePlatformPage("hoteliers", "read"), validate(listQuery), superController.users);
superAdmin.post("/users", requirePlatformPage("hoteliers", "write"), validate(userCreateSchema), superController.createUser);
superAdmin.get("/users/:userId", requirePlatformPage("hoteliers", "read"), superController.showUser);
superAdmin.patch("/users/:userId", requirePlatformPage("hoteliers", "write"), validate(userPatchSchema), superController.patchUser);
superAdmin.get("/staff", requirePlatformPage("users", "read"), superController.staff);
superAdmin.post("/staff", requirePlatformPage("users", "write"), validate(staffSchema), superController.postStaff);
superAdmin.patch("/staff/:userId", requirePlatformPage("users", "write"), validate(staffPatchSchema), superController.patchStaff);
superAdmin.get("/properties", requirePlatformPage("properties", "read"), validate(listQuery), superController.properties);
superAdmin.patch("/properties/:propertyId", requirePlatformPage("properties", "write"), validate(propertyStatusSchema), superController.patchProperty);
superAdmin.get("/plans", requirePlatformPage("plans", "read"), superController.plans);
superAdmin.post("/plans", requirePlatformPage("plans", "write"), validate(planSchema), superController.postPlan);
superAdmin.patch("/plans/:planId", requirePlatformPage("plans", "write"), validate(planPatchSchema), superController.patchPlan);
superAdmin.get("/subscriptions", requirePlatformPage("subscriptions", "read"), validate(listQuery), superController.subscriptions);
superAdmin.post("/subscriptions", requirePlatformPage("subscriptions", "write"), validate(subscriptionUpsertSchema), superController.postSubscription);
superAdmin.patch("/subscriptions/:subscriptionId", requirePlatformPage("subscriptions", "write"), validate(subscriptionPatchSchema), superController.patchSubscriptionHandler);
superAdmin.get("/bookings", requirePlatformPage("bookings", "read"), validate(listQuery), superController.bookings);
superAdmin.get("/logs", requirePlatformPage("activity", "read"), validate(listQuery), superController.logs);
api.use("/super", superAdmin);
