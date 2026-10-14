import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const baseEnv: NodeJS.ProcessEnv = {
  PORT: "3000",
  DATABASE_URL: "postgresql://localhost/student_db",
  ADMIN_USERNAME: "admin-user",
  ADMIN_PASSWORD: "p",
  JWT_SECRET: "01234567890123456789012345678901",
};

let loadConfig: typeof import("./config").loadConfig;

beforeAll(async () => {
  vi.stubEnv("ADMIN_USERNAME", "test-admin");
  vi.stubEnv("ADMIN_PASSWORD", "test-password");
  vi.stubEnv("JWT_SECRET", "test-secret-that-is-at-least-32-characters");
  ({ loadConfig } = await import("./config"));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("loadConfig authentication settings", () => {
  it.each(["ADMIN_USERNAME", "ADMIN_PASSWORD", "JWT_SECRET"] as const)(
    "rejects absent %s without including a value",
    (key) => {
      const env = { ...baseEnv };
      delete env[key];

      const message = configurationError(env);
      expect(message).toContain(key);
      expectConfiguredValuesAreHidden(message);
    },
  );

  it.each(["ADMIN_USERNAME", "ADMIN_PASSWORD", "JWT_SECRET"] as const)(
    "rejects empty %s",
    (key) => {
      const message = configurationError({ ...baseEnv, [key]: "" });
      expect(message).toContain(key);
      expectConfiguredValuesAreHidden(message);
    },
  );

  it.each(["ADMIN_USERNAME", "ADMIN_PASSWORD", "JWT_SECRET"] as const)(
    "rejects whitespace-only %s",
    (key) => {
      const message = configurationError({ ...baseEnv, [key]: " \t " });
      expect(message).toContain(key);
      expectConfiguredValuesAreHidden(message);
    },
  );

  it("rejects a short JWT secret without echoing it", () => {
    const shortSecret = "short-secret";
    const message = configurationError({ ...baseEnv, JWT_SECRET: shortSecret });

    expect(message).toContain("JWT_SECRET");
    expect(message).not.toContain(shortSecret);
    expectConfiguredValuesAreHidden(message);
  });

  it("accepts a one-character password and preserves configured values", () => {
    const config = loadConfig(baseEnv);

    expect(config.auth.password).toBe("p");
    expect(config.auth.username).toBe("admin-user");
    expect(config.auth.jwtSecret).toBe(baseEnv.JWT_SECRET);
  });
});

function configurationError(env: NodeJS.ProcessEnv): string {
  try {
    loadConfig(env);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  throw new Error("Expected configuration to be rejected");
}

function expectConfiguredValuesAreHidden(message: string): void {
  expect(message).not.toContain(baseEnv.ADMIN_USERNAME!);
  expect(message).not.toContain(baseEnv.ADMIN_PASSWORD!);
  expect(message).not.toContain(baseEnv.JWT_SECRET!);
}