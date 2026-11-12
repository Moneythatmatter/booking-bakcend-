import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny } from "zod";

export function validate(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.parse({
      body: req.body ?? {},
      query: req.query ?? {},
      params: req.params ?? {},
    });
    req.validated = parsed;
    next();
  };
}
