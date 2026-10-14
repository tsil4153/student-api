import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VALID_SECRET = "x".repeat(32);

function stubValidEnv(): void {
  vi.stubEnv("PORT", "3999");
  vi.stubEnv("DATABASE_URL", "postgresql://test-user:test-pass@localhost:5432/test_db");
  vi.stubEnv("ADMIN_USERNAME", "test-admin");
  vi.stubEnv("ADMIN_PASSWORD", "test-admin-password-not-real");
  vi.stubEnv("JWT_SECRET", VALID_SECRET);
}

async function importConfig() {
  return (await import("../src/config")).config;
}

describe("test isolation from the real .env", () => {
  it("resolves dotenv/config to the test stub (vitest.config.ts alias), so no .env is read", async () => {
    const resolved = (await import("dotenv/config")) as unknown as Record<string, unknown>;

    expect(resolved.NEUTRALIZED_DOTENV).toBe(true);
  });

  it("takes process.env values from vitest.config.ts test.env", () => {
    expect(process.env.PORT).toBe("3999");
    expect(process.env.DATABASE_URL).toBe("postgresql://test-user:test-pass@localhost:5432/test_db");
    expect(process.env.ADMIN_USERNAME).toBe("test-admin");
  });
});

describe("config.auth", () => {
  beforeEach(() => {
    vi.resetModules();
    stubValidEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("loads auth values when all keys are valid (32-char secret accepted)", async () => {
    const config = await importConfig();

    expect(config.auth).toEqual({
      adminUsername: "test-admin",
      adminPassword: "test-admin-password-not-real",
      jwtSecret: VALID_SECRET,
    });
  });

  describe.each(["ADMIN_USERNAME", "ADMIN_PASSWORD", "JWT_SECRET"])("%s", (key) => {
    it("throws '<KEY> is required' when missing", async () => {
      vi.stubEnv(key, undefined);

      await expect(importConfig()).rejects.toThrow(new Error(`${key} is required`));
    });

    it.each([["empty", ""], ["whitespace-only", "   "]])(
      "throws '<KEY> is required' when %s",
      async (_label, value) => {
        vi.stubEnv(key, value);

        await expect(importConfig()).rejects.toThrow(new Error(`${key} is required`));
      },
    );
  });

  it("rejects a 31-char JWT_SECRET without leaking the value", async () => {
    const shortSecret = "s".repeat(31);
    vi.stubEnv("JWT_SECRET", shortSecret);

    const failure = await importConfig().then(
      () => null,
      (error: Error) => error,
    );

    expect(failure).toEqual(new Error("JWT_SECRET must be at least 32 characters"));
    expect(failure?.message).not.toContain(shortSecret);
  });
});
