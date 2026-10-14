import { Router } from "express";
import type { AuthConfig } from "../config";
import { asyncHandler } from "../middleware/asyncHandler";
import { jsonBody } from "../middleware/jsonBody";
import { createLoginController } from "./auth.controller";

export function createAuthRouter(auth: AuthConfig): Router {
  const router = Router();
  router.post("/login", jsonBody, asyncHandler(createLoginController(auth)));
  return router;
}