import http from "node:http";
import { inspect } from "node:util";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthConfig } from "../src/auth/auth.types";

vi.mock("../src/db/pool", () => ({ pool: { query: vi.fn() } }));
vi.mock("../src/students/student.repository");

import { createApp } from "../src/app";
import * as studentRepository from "../src/students/student.repository";

const auth: AuthConfig = {
  adminUsername: "test-admin",
  adminPassword: "test-admin-password-not-real",
  jwtSecret: "test-only-fake-jwt-secret-0123456789-abcdef",
};
const goodBody = { username: auth.adminUsername, password: auth.adminPassword };
const badBody = { username: auth.adminUsername, password: "definitely-wrong-password" };

const CLIENT_IP_HEADER = "x-test-client-ip";

// The wrapper lets a test pick the socket address, since express derives req.ip from it (trust proxy is off).
function createClient(options: { auth?: AuthConfig } = {}) {
  const app = createApp({ auth: options.auth ?? auth });
  const server = http.createServer((req, res) => {
    const ip = req.headers[CLIENT_IP_HEADER];
    if (typeof ip === "string") {
      Object.defineProperty(req.socket, "remoteAddress", { value: ip, configurable: true });
    }
    app(req, res);
  });
  return {
    login: (ip?: string) => {
      const test = request(server).post("/auth/login");
      return ip ? test.set(CLIENT_IP_HEADER, ip) : test;
    },
    raw: () => request(server),
  };
}

function consoleOutput(): string {
  return [console.error, console.warn, console.log, console.info]
    .flatMap((fn) => (fn as ReturnType<typeof vi.fn>).mock.calls)
    .map((args) => args.map((arg: unknown) => (typeof arg === "string" ? arg : inspect(arg))).join(" "))
    .join("\n");
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  const output = consoleOutput();
  vi.restoreAllMocks();
  vi.clearAllMocks();

  expect(output).not.toContain(auth.adminPassword);
  expect(output).not.toContain("definitely-wrong-password");
  expect(output).not.toContain("Bearer");
  expect(output).not.toMatch(/eyJ[\w-]+\./);
});

async function sendLogin(client: ReturnType<typeof createClient>, body: unknown, ip?: string) {
  return client.login(ip).send(body as object);
}

describe("POST /auth/login success", () => {
  it("returns exactly the documented body with no-store caching (AC-4)", async () => {
    const res = await sendLogin(createClient(), goodBody);

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(Object.keys(res.body).sort()).toEqual(["accessToken", "expiresIn", "tokenType"]);
    expect(res.body.tokenType).toBe("Bearer");
    expect(res.body.expiresIn).toBe(3600);
    expect(typeof res.body.accessToken).toBe("string");
  });

  it("issues an HS256 admin token valid for one hour that carries no credentials (AC-5)", async () => {
    const res = await sendLogin(createClient(), goodBody);
    const token: string = res.body.accessToken;
    const decoded = jwt.decode(token, { complete: true });
    const verified = jwt.verify(token, auth.jwtSecret, { algorithms: ["HS256"] }) as jwt.JwtPayload;

    expect(decoded?.header.alg).toBe("HS256");
    expect(verified).toMatchObject({ sub: "admin", role: "admin", iss: "student-api", aud: "student-api" });
    expect(verified.exp! - verified.iat!).toBe(3600);

    const payloadText = Buffer.from(token.split(".")[1], "base64url").toString("utf8");
    expect(payloadText).not.toContain(auth.adminUsername);
    expect(payloadText).not.toContain(auth.adminPassword);
  });

  it("accepts credentials of exactly 256 characters (schema boundary)", async () => {
    const longAuth: AuthConfig = { ...auth, adminUsername: "u".repeat(256), adminPassword: "p".repeat(256) };
    const res = await sendLogin(createClient({ auth: longAuth }), {
      username: "u".repeat(256),
      password: "p".repeat(256),
    });

    expect(res.status).toBe(200);
  });

  it("works for a Unicode password", async () => {
    const unicodeAuth: AuthConfig = { ...auth, adminPassword: "pässwörd✓" };
    const res = await sendLogin(createClient({ auth: unicodeAuth }), { ...goodBody, password: "pässwörd✓" });

    expect(res.status).toBe(200);
  });
});

describe("POST /auth/login wrong credentials (AC-6)", () => {
  it.each([
    ["wrong username", { username: "someone-else", password: auth.adminPassword }],
    ["wrong password", badBody],
    ["both wrong", { username: "someone-else", password: "definitely-wrong-password" }],
  ])("%s -> 401 with the standard challenge", async (_label, body) => {
    const res = await sendLogin(createClient(), body);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid credentials" });
    expect(res.headers["www-authenticate"]).toBe('Bearer realm="student-api"');
  });

  it("gives byte-identical responses for every failure variant (no credential oracle)", async () => {
    const variants = [
      { username: "someone-else", password: auth.adminPassword },
      badBody,
      { username: "someone-else", password: "definitely-wrong-password" },
    ];
    const responses = [];
    for (const body of variants) {
      responses.push(await sendLogin(createClient(), body));
    }

    const signatures = responses.map((res) => `${res.status}|${res.headers["www-authenticate"]}|${res.text}`);
    expect(new Set(signatures).size).toBe(1);
  });
});

describe("POST /auth/login body validation (AC-8)", () => {
  const tooLong = "x".repeat(257);

  it.each([
    ["missing username", { password: "p" }],
    ["missing password", { username: "u" }],
    ["empty object", {}],
    ["non-string username", { username: 123, password: "p" }],
    ["non-string password", { username: "u", password: { nested: true } }],
    ["empty username", { username: "", password: "p" }],
    ["empty password", { username: "u", password: "" }],
    ["257-char username", { username: tooLong, password: "p" }],
    ["257-char password", { username: "u", password: tooLong }],
    ["extra key", { username: "u", password: "p", admin: true }],
    ["JSON array (empty)", []],
    ["JSON array (credentials inside)", [{ username: "u", password: "p" }]],
  ])("%s -> 400 Validation failed and no echo of input", async (_label, body) => {
    const res = await sendLogin(createClient(), body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    expect(Object.keys(res.body).sort()).toEqual(["details", "error"]);
    expect(res.body.details).toEqual({
      formErrors: expect.any(Array),
      fieldErrors: expect.any(Object),
    });
    expect(res.text).not.toContain(tooLong);
  });

  it("treats an empty JSON body as a validation error", async () => {
    const res = await createClient().login().set("Content-Type", "application/json");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it.each([["null"], ['"x"'], ["1"], ["true"]])(
    "scalar JSON %s -> 400 Invalid JSON body (rejected by the parser)",
    async (raw) => {
      const res = await createClient().login().set("Content-Type", "application/json").send(raw);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Invalid JSON body" });
    },
  );

  it("a 256-char wrong credential passes the schema and fails as 401, not 400", async () => {
    const res = await sendLogin(createClient(), { username: "u".repeat(256), password: "p".repeat(256) });

    expect(res.status).toBe(401);
  });
});

describe("POST /auth/login rate limiting", () => {
  async function failFiveTimes(client: ReturnType<typeof createClient>, ip?: string) {
    for (let i = 0; i < 5; i += 1) {
      const res = await sendLogin(client, badBody, ip);
      expect(res.status).toBe(401);
    }
  }

  it("blocks the 6th attempt after 5 failures, even with correct credentials (AC-9)", async () => {
    const client = createClient();
    await failFiveTimes(client);

    const res = await sendLogin(client, goodBody);

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "Too many login attempts, try again later" });
    expect(res.text).not.toContain("accessToken");
    const retryAfter = Number(res.headers["retry-after"]);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(900);
    expect(res.headers["ratelimit"]).toBeDefined();
    expect(res.headers["ratelimit-policy"]).toContain("q=5");
    expect(res.headers["ratelimit-policy"]).toContain("w=900");
  });

  it("does not affect a different client IP (AC-9)", async () => {
    const client = createClient();
    await failFiveTimes(client, "203.0.113.10");

    const blocked = await sendLogin(client, goodBody, "203.0.113.10");
    const other = await sendLogin(client, goodBody, "203.0.113.20");

    expect(blocked.status).toBe(429);
    expect(other.status).toBe(200);
  });

  it("ignores a spoofed X-Forwarded-For when choosing the bucket (AC-9)", async () => {
    const client = createClient();
    for (let i = 0; i < 5; i += 1) {
      const res = await client.login().set("X-Forwarded-For", `198.51.100.${i}`).send(badBody);
      expect(res.status).toBe(401);
    }

    const res = await client.login().set("X-Forwarded-For", "198.51.100.200").send(goodBody);

    expect(res.status).toBe(429);
  });

  it("does not count successful logins: 7 in a row all succeed (AC-10)", async () => {
    const client = createClient();

    for (let i = 0; i < 7; i += 1) {
      const res = await sendLogin(client, goodBody);
      expect(res.status).toBe(200);
    }
  });

  it("successful logins do not consume the failure budget (AC-10)", async () => {
    const client = createClient();
    for (let i = 0; i < 3; i += 1) {
      await sendLogin(client, goodBody);
    }

    await failFiveTimes(client);
    const res = await sendLogin(client, goodBody);

    expect(res.status).toBe(429);
  });

  it("does not count schema-invalid (400) bodies: 7 of them leave the full budget (AC-10)", async () => {
    const client = createClient();
    for (let i = 0; i < 7; i += 1) {
      const res = await sendLogin(client, { username: "u" });
      expect(res.status).toBe(400);
    }

    await failFiveTimes(client);
    const res = await sendLogin(client, badBody);

    expect(res.status).toBe(429);
  });

  it("keeps state per app instance (AC-11)", async () => {
    const exhausted = createClient();
    await failFiveTimes(exhausted);
    const fresh = createClient();

    expect((await sendLogin(exhausted, goodBody)).status).toBe(429);
    expect((await sendLogin(fresh, goodBody)).status).toBe(200);
  });

  it("does not rate limit GET /students or admin writes, even after login is blocked (AC-11)", async () => {
    vi.mocked(studentRepository.listStudents).mockResolvedValue({ students: [], total: 0 });
    vi.mocked(studentRepository.insertStudent).mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
      dateOfBirth: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    });
    const client = createClient();
    await failFiveTimes(client);
    expect((await sendLogin(client, goodBody)).status).toBe(429);
    const token = jwt.sign({ role: "admin" }, auth.jwtSecret, {
      algorithm: "HS256",
      expiresIn: 60,
      issuer: "student-api",
      audience: "student-api",
    });

    for (let i = 0; i < 8; i += 1) {
      expect((await client.raw().get("/students")).status).toBe(200);
      const created = await client
        .raw()
        .post("/students")
        .set("Authorization", `Bearer ${token}`)
        .send({ firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" });
      expect(created.status).toBe(201);
    }
  });
});

describe("/auth routing (AC-12, AC-18)", () => {
  it.each([
    ["GET", "/auth/nope"],
    ["POST", "/auth/nope"],
    ["PUT", "/auth/nope"],
    ["PATCH", "/auth/nope"],
    ["DELETE", "/auth/nope"],
    ["GET", "/auth/login"],
    ["PUT", "/auth/login"],
    ["DELETE", "/auth/login"],
    ["POST", "/auth"],
  ])("%s %s -> 404 without a token", async (method, path) => {
    const res = await createClient().raw()[method.toLowerCase() as "get"](path);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });

  it.each([
    ["HEAD", "/auth/nope"],
    ["OPTIONS", "/auth/nope"],
    ["HEAD", "/auth/login"],
    ["OPTIONS", "/auth/login"],
  ])("%s %s -> 404 (HEAD has no body)", async (method, path) => {
    const res = await createClient().raw()[method.toLowerCase() as "head"](path);

    expect(res.status).toBe(404);
    if (method === "OPTIONS") {
      expect(res.body).toEqual({ error: "Not found" });
    }
  });

  it("serves login without a token while POST /students is still guarded in the same app (AC-18)", async () => {
    const client = createClient();

    const login = await sendLogin(client, goodBody);
    const write = await client.raw().post("/students").send({});

    expect(login.status).toBe(200);
    expect(write.status).toBe(401);
    expect(studentRepository.insertStudent).not.toHaveBeenCalled();
  });
});
