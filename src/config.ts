import "dotenv/config";

function readPort(): number {
  const raw = process.env.PORT ?? "3000";
  const port = Number(raw);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535. Received: ${raw}`);
  }

  return port;
}

function readDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required. Example: postgresql://postgres:postgres@localhost:5432/student_db",
    );
  }

  return databaseUrl;
}

function readRequired(key: string): string {
  const value = process.env[key];

  if (value === undefined || value.trim() === "") {
    throw new Error(`${key} is required`);
  }

  return value;
}

function readAuth() {
  const adminUsername = readRequired("ADMIN_USERNAME");
  const adminPassword = readRequired("ADMIN_PASSWORD");
  const jwtSecret = readRequired("JWT_SECRET");

  if (jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters");
  }

  return { adminUsername, adminPassword, jwtSecret };
}

export const config = {
  port: readPort(),
  databaseUrl: readDatabaseUrl(),
  auth: readAuth(),
};
