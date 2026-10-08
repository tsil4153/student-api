import express from "express";
import { pool } from "./db/pool";
import { asyncHandler } from "./middleware/asyncHandler";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { studentRouter } from "./students/student.routes";

export function createApp() {
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

  app.use("/students", studentRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
