import express from "express";
import { requireAdminForWrites } from "./auth/auth.middleware";
import { createAuthRouter } from "./auth/auth.routes";
import type { AuthConfig } from "./auth/auth.types";
import { config } from "./config";
import { pool } from "./db/pool";
import { asyncHandler } from "./middleware/asyncHandler";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { studentRouter } from "./students/student.routes";

export interface CreateAppOptions {
  auth?: AuthConfig;
}

export function createApp(options: CreateAppOptions = {}) {
  const auth = options.auth ?? config.auth;
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get(
    "/health",
    asyncHandler(async (_req, res) => {
      await pool.query("SELECT 1");
      res.json({ status: "ok" });
    }),
  );

  // Mount order is the access policy: only routes above the guard are public for writes.
  app.use("/auth", createAuthRouter(auth));
  app.use(requireAdminForWrites(auth));
  app.use("/students", studentRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
