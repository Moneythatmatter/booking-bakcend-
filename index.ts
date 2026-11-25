import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env";
import { stripeWebhook } from "./controllers/payment.controller";
import { errorHandler } from "./middleware/error";
import { api } from "./routes";

const app = express();

app.set("trust proxy", 1);
app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || env.clientOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      if (env.nodeEnv !== "production") {
        console.warn(`CORS blocked origin: ${origin}. Allowed: ${env.clientOrigins.join(", ")}`);
      }
      callback(null, false);
    },
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 204,
  }),
);

app.post("/api/payments/webhook", express.raw({ type: "application/json" }), stripeWebhook);
app.use(express.json({ limit: "4mb" }));
app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev"));
app.use("/api", api);
app.use((_req, res) => {
  res.status(404).json({ error: { message: "Not found.", code: "not_found" } });
});
app.use(errorHandler);

app.listen(env.port, () => {
  console.log(`Booking API listening on port ${env.port}`);
});
