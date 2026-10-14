import "dotenv/config";

export interface AuthConfig {
  username: string;
  password: string;
  jwtSecret: string;
}

export interface AppConfig {
  port: number;
  databaseUrl: string;
  auth: AuthConfig;
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const rawPort = env.PORT ?? "3000";
  const port = Number(rawPort);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535. Received: ${rawPort}`);
  }

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required. Example: postgresql://postgres:postgres@localhost:5432/student_db",
    );
  }

  const missing: string[] = [];
  const adminUsername = readRequiredAuthValue(env, "ADMIN_USERNAME", missing);
  const adminPassword = readRequiredAuthValue(env, "ADMIN_PASSWORD", missing);
  const jwtSecret = readRequiredAuthValue(env, "JWT_SECRET", missing);

  if (jwtSecret !== undefined && jwtSecret.length < 32) {
    missing.push("JWT_SECRET");
  }

  if (missing.length > 0) {
    throw new Error(`Invalid authentication configuration: ${[...new Set(missing)].join(", ")}`);
  }

  return {
    port,
    databaseUrl,
    auth: {
      username: adminUsername!,
      password: adminPassword!,
      jwtSecret: jwtSecret!,
    },
  };
}

function readRequiredAuthValue(
  env: NodeJS.ProcessEnv,
  key: "ADMIN_USERNAME" | "ADMIN_PASSWORD" | "JWT_SECRET",
  invalid: string[],
): string | undefined {
  const value = env[key];

  if (value === undefined || value.trim().length === 0) {
    invalid.push(key);
    return undefined;
  }

  return value;
}

export const config = loadConfig(process.env);
