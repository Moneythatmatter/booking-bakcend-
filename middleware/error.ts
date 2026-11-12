import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { env } from "../config/env";
import { AppError } from "../utils/errors";

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof AppError) {
    res.status(error.status).json({ error: { message: error.message, code: error.code } });
    return;
  }

  if (error instanceof ZodError) {
    const message = error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    res.status(422).json({ error: { message, code: "validation_error" } });
    return;
  }

  console.error(error);
  const message = env.nodeEnv === "production" ? "Something went wrong." : error instanceof Error ? error.message : "Something went wrong.";
  res.status(500).json({ error: { message, code: "internal_error" } });
}
