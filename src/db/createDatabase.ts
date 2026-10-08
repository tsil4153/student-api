import { Client } from "pg";
import { config } from "../config";

const databaseNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

function databaseNameFromUrl(databaseUrl: string): { name: string; adminUrl: string } {
  const url = new URL(databaseUrl);
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));

  if (!databaseNamePattern.test(name)) {
    throw new Error(
      `Database name "${name}" must contain only letters, numbers, and underscores.`,
    );
  }

  url.pathname = "/postgres";
  return { name, adminUrl: url.toString() };
}

async function createDatabase(): Promise<void> {
  const { name, adminUrl } = databaseNameFromUrl(config.databaseUrl);
  const client = new Client({ connectionString: adminUrl });

  try {
    await client.connect();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not connect to local PostgreSQL to create "${name}". ${message}`,
    );
  }

  try {
    const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);

    if ((existing.rowCount ?? 0) > 0) {
      console.log(`Database "${name}" already exists.`);
      return;
    }

    await client.query(`CREATE DATABASE ${name}`);
    console.log(`Created database "${name}".`);
  } finally {
    await client.end();
  }
}

createDatabase().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
