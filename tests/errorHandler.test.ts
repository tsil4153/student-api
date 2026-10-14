import { inspect } from "node:util";
import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError, z } from "zod";
import type { AuthConfig } from "../src/auth/auth.types";
import { AppError } from "../src/errors/AppError";

vi.mock("../src/db/pool", () => ({ pool: { query: vi.fn() } }));
vi.mock("../src/students/student.repository");

import { createApp } from "../src/app";
import { errorHandler } from "../src/middleware/errorHandler";
import * as studentRepository from "../src/students/student.repository";

const auth: AuthConfig = {
  adminUsername: "test-admin",
  adminPassword: "test-admin-password-not-real",
  jwtSecret: "test-only-fake-jwt-secret-0123456789-abcdef",
};

const STUDENT_ID = "11111111-1111-4111-8111-111111111111";
const student = {
  id: STUDENT_ID,
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  dateOfBirth: null,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};
const LEAK_MARKER = "leaky-marker-pw-12345";
const WRONG_PASSWORD = "definitely-wrong-password";

const mintToken = (claims: object, secret = auth.jwtSecret) =>
  jwt.sign(claims, secret, { algorithm: "HS256", expiresIn: 60, issuer: "student-api", audience: "student-api" });

const consoleSpies = () => [console.error, console.warn, console.log, console.info] as unknown as Array<
  ReturnType<typeof vi.fn>
>;

function consoleOutput(): string {
  return consoleSpies()
    .flatMap((spy) => spy.mock.calls)
    .map((args) => args.map((arg: unknown) => (typeof arg === "string" ? arg : inspect(arg))).join(" "))
    .join("\n");
}

function consoleCallCount(): number {
  return consoleSpies().reduce((total, spy) => total + spy.mock.calls.length, 0);
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.mocked(studentRepository.insertStudent).mockResolvedValue(student);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("malformed JSON (AC-20)", () => {
  const malformed = `{"username":"test-admin","password":"${LEAK_MARKER}"`;

  async function postMalformed(path: string, token?: string) {
    const test = request(createApp({ auth })).post(path).set("Content-Type", "application/json");
    return (token ? test.set("Authorization", `Bearer ${token}`) : test).send(malformed);
  }

  it.each([
    ["/auth/login", undefined],
    ["/students", undefined],
    ["/students", "garbage-token"],
    ["/students", mintToken({ role: "admin" })],
  ])("POST %s (token: %s) -> 400 Invalid JSON body, nothing logged, body not echoed", async (path, token) => {
    const res = await postMalformed(path, token);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid JSON body" });
    expect(res.text).not.toContain(LEAK_MARKER);
    expect(consoleCallCount()).toBe(0);
    expect(studentRepository.insertStudent).not.toHaveBeenCalled();
  });

  it("also applies to PUT and DELETE-with-body routes (parser runs before the guard)", async () => {
    const res = await request(createApp({ auth }))
      .put(`/students/${STUDENT_ID}`)
      .set("Content-Type", "application/json")
      .send("{not json");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid JSON body" });
  });

  it("scalar JSON on /students is also Invalid JSON body", async () => {
    const res = await request(createApp({ auth }))
      .post("/students")
      .set("Content-Type", "application/json")
      .send("null");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid JSON body" });
    expect(consoleCallCount()).toBe(0);
  });
});

describe("errorHandler branches", () => {
  function appThrowing(error: unknown) {
    const app = express();
    app.get("/boom", () => {
      throw error;
    });
    app.use(errorHandler);
    return app;
  }

  it("maps a body-parser style parse error to 400 Invalid JSON body without logging", async () => {
    const parseError = Object.assign(new Error("Unexpected token"), {
      type: "entity.parse.failed",
      status: 400,
      body: LEAK_MARKER,
    });

    const res = await request(appThrowing(parseError)).get("/boom");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid JSON body" });
    expect(res.text).not.toContain(LEAK_MARKER);
    expect(consoleCallCount()).toBe(0);
  });

  it("keeps the ZodError branch", async () => {
    const zodError = new ZodError(z.string().safeParse(1).error!.issues);

    const res = await request(appThrowing(zodError)).get("/boom");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    expect(res.body.details).toBeDefined();
  });

  it("keeps the AppError branch (status, message, details)", async () => {
    const res = await request(appThrowing(new AppError(409, "Conflict here", { field: "email" }))).get("/boom");

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Conflict here", details: { field: "email" } });
  });

  it("keeps the 500 branch: generic body, error logged once, message not leaked", async () => {
    const res = await request(appThrowing(new Error("db password is hunter2"))).get("/boom");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
    expect(res.text).not.toContain("hunter2");
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("does not treat an error object whose type merely resembles a parse error as one", async () => {
    const res = await request(appThrowing(Object.assign(new Error("x"), { type: "entity.too.large" }))).get("/boom");

    expect(res.status).toBe(500);
  });
});

describe("no sensitive data in logs or auth responses (AC-21)", () => {
  // Scenario: one app instance serves a full mixed auth workload while console is observed.
  //
  //  Client            App (guard + login + errorHandler)         console
  //    |-- login ok ------->|                                        |
  //    |-- login wrong ---->|                                        |
  //    |-- write, bad token>|                                        |
  //    |-- write, user role>|                                        |
  //    |-- write, admin --->|                                        |
  //    |-- malformed JSON ->|                                        |
  //    |<-- no 5xx, no secret in any body ---|-- nothing sensitive -->|
  it("keeps passwords, tokens and Authorization values out of console and responses; no 5xx", async () => {
    const app = createApp({ auth });
    const adminToken = mintToken({ role: "admin" });
    const userToken = mintToken({ role: "user" });
    const badToken = mintToken({ role: "admin" }, "another-secret-another-secret-12345");

    const login = await request(app).post("/auth/login").send({ username: auth.adminUsername, password: auth.adminPassword });
    const responses = [
      login,
      await request(app).post("/auth/login").send({ username: auth.adminUsername, password: WRONG_PASSWORD }),
      await request(app).post("/auth/login").send({ username: "u" }),
      await request(app).post("/students").set("Authorization", `Bearer ${badToken}`).send({}),
      await request(app).post("/students").set("Authorization", `Bearer ${userToken}`).send({}),
      await request(app).post("/students").send({}),
      await request(app)
        .post("/students")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" }),
      await request(app)
        .post("/auth/login")
        .set("Content-Type", "application/json")
        .send(`{"password":"${LEAK_MARKER}"`),
    ];

    for (const res of responses) {
      expect(res.status).toBeLessThan(500);
    }

    const output = consoleOutput();
    for (const secret of [auth.adminPassword, WRONG_PASSWORD, LEAK_MARKER, adminToken, userToken, badToken, auth.jwtSecret]) {
      expect(output).not.toContain(secret);
    }
    expect(output).not.toContain("Bearer");
    expect(output).not.toContain("Authorization");
    expect(consoleCallCount()).toBe(0);

    const errorBodies = responses.filter((res) => res.status >= 400).map((res) => res.text).join("\n");
    for (const secret of [auth.adminPassword, WRONG_PASSWORD, LEAK_MARKER, adminToken, userToken, badToken, auth.jwtSecret]) {
      expect(errorBodies).not.toContain(secret);
    }
    expect(errorBodies).not.toContain(auth.adminUsername);
    expect(login.body.accessToken).toBeDefined();
  });

  it("with a spoofed X-Forwarded-For the library may log a validation error, but never secrets", async () => {
    const app = createApp({ auth });

    await request(app)
      .post("/auth/login")
      .set("X-Forwarded-For", "198.51.100.7")
      .send({ username: auth.adminUsername, password: WRONG_PASSWORD });
    await request(app)
      .post("/auth/login")
      .set("X-Forwarded-For", "198.51.100.8")
      .set("Authorization", "Bearer not-a-real-token-value")
      .send({ username: auth.adminUsername, password: auth.adminPassword });

    const output = consoleOutput();
    expect(output).not.toContain(WRONG_PASSWORD);
    expect(output).not.toContain(auth.adminPassword);
    expect(output).not.toContain("not-a-real-token-value");
    expect(output).not.toContain("198.51.100");
    expect(output).not.toMatch(/eyJ[\w-]+\./);
  });
});
