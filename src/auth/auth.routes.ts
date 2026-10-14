import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { asyncHandler } from "../middleware/asyncHandler";
import { notFoundHandler } from "../middleware/errorHandler";
import { createLoginHandler } from "./auth.controller";
import type { AuthConfig } from "./auth.types";

export function createAuthRouter(auth: AuthConfig): Router {
  const router = Router();

  // Only 401 responses count, so successful logins and schema 400s do not use attempts.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    skipSuccessfulRequests: true,
    requestWasSuccessful: (_req, res) => res.statusCode !== 401,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: "Too many login attempts, try again later" });
    },
  });

  router.post("/login", loginLimiter, asyncHandler(createLoginHandler(auth)));
  router.use(notFoundHandler);

  return router;
}
