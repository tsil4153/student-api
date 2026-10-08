import { createApp } from "./app";
import { config } from "./config";
import { ensureSchema } from "./db/schema";
import { pool } from "./db/pool";
import { isInvalidDatabase } from "./errors/AppError";

async function main(): Promise<void> {
  try {
    await ensureSchema();
  } catch (error) {
    if (isInvalidDatabase(error)) {
      console.error(
        'Database from DATABASE_URL does not exist. Create it with "npm run db:create", then start the API again.',
      );
    } else if (isConnectionRefused(error)) {
      console.error(
        "Could not connect to PostgreSQL at the host in DATABASE_URL. Confirm PostgreSQL is running locally and the credentials in .env are correct.",
      );
    }

    throw error;
  }

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`Student API listening on http://localhost:${config.port}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}. Closing server.`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

function isConnectionRefused(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ECONNREFUSED"
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
