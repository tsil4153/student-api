import express from "express";
import type { AuthConfig } from "./config";
import { pool } from "./db/pool";
import { asyncHandler } from "./middleware/asyncHandler";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { jsonBody } from "./middleware/jsonBody";
import { createAuthRouter } from "./auth/auth.routes";
import { createStudentRouter } from "./students/student.routes";

export function createApp({ auth }: { auth: AuthConfig }) {
  const app = express();

  app.disable("x-powered-by");

  app.get(
    "/health",
    asyncHandler(async (_req, res) => {
      await pool.query("SELECT 1");
      res.json({ status: "ok" });
    }),
  );

  app.use("/auth", createAuthRouter(auth));
  app.use("/students", createStudentRouter(auth));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
