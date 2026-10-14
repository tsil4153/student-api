import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 5000,
    hookTimeout: 5000,
    // src/config.ts imports "dotenv/config"; aliasing it to a no-op stub keeps every test file off the real .env.
    alias: [{ find: /^dotenv\/config$/, replacement: resolve(__dirname, "tests/stubs/dotenv-config.ts") }],
    // Fake, test-only values: the only source of process.env for tests.
    env: {
      PORT: "3999",
      DATABASE_URL: "postgresql://test-user:test-pass@localhost:5432/test_db",
      ADMIN_USERNAME: "test-admin",
      ADMIN_PASSWORD: "test-admin-password-not-real",
      JWT_SECRET: "test-only-fake-jwt-secret-0123456789-abcdef",
    },
  },
});
