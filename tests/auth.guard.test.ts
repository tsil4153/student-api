import { Buffer } from "node:buffer";
import { inspect } from "node:util";
import jwt from "jsonwebtoken";
import type { Request, Response } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireAdmin } from "../src/auth/auth.middleware";
import type { AuthConfig } from "../src/auth/auth.types";

vi.mock("../src/db/pool", () => ({ pool: { query: vi.fn() } }));
vi.mock("../src/students/student.repository");

import { createApp } from "../src/app";
import { config } from "../src/config";
import { pool } from "../src/db/pool";
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
const validCreate = { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" };

const CHALLENGE_A = 'Bearer realm="student-api"';
const CHALLENGE_B = 'Bearer realm="student-api", error="invalid_token"';
const CHALLENGE_C = 'Bearer realm="student-api", error="insufficient_scope"';

const nowSeconds = () => Math.floor(Date.now() / 1000);
const b64url = (value: object): string => Buffer.from(JSON.stringify(value)).toString("base64url");

function mint(
  payload: object,
  options: { algorithm?: jwt.Algorithm; issuer?: string; audience?: string; omitExp?: boolean } = {},
  secret: string = auth.jwtSecret,
): string {
  const signOptions: jwt.SignOptions = {
    algorithm: options.algorithm ?? "HS256",
    issuer: options.issuer ?? "student-api",
    audience: options.audience ?? "student-api",
  };
  if (!options.omitExp) {
    signOptions.expiresIn = 60;
  }
  return jwt.sign(payload, secret, signOptions);
}

const adminToken = () => mint({ role: "admin", sub: "admin" });
const bearer = (token: string) => `Bearer ${token}`;

function allRepositoryCalls(): number {
  return (Object.values(studentRepository) as unknown[])
    .filter((fn) => vi.isMockFunction(fn))
    .reduce<number>((total, fn) => total + (fn as ReturnType<typeof vi.fn>).mock.calls.length, 0);
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
  vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 1 } as never);
  vi.mocked(studentRepository.listStudents).mockResolvedValue({ students: [student], total: 1 });
  vi.mocked(studentRepository.findStudentById).mockResolvedValue(student);
  vi.mocked(studentRepository.insertStudent).mockResolvedValue(student);
  vi.mocked(studentRepository.updateStudent).mockResolvedValue(student);
  vi.mocked(studentRepository.deleteStudent).mockResolvedValue(true);
});

afterEach(() => {
  const output = consoleOutput();
  vi.restoreAllMocks();
  vi.clearAllMocks();

  expect(output).not.toContain("Bearer");
  expect(output).not.toMatch(/eyJ[\w-]+\./);
});

describe("public safe methods without a token (AC-13)", () => {
  const app = () => createApp({ auth });

  it.each([
    ["GET", "/health"],
    ["HEAD", "/health"],
    ["GET", "/students"],
    ["HEAD", "/students"],
    ["OPTIONS", "/students"],
    ["GET", `/students/${STUDENT_ID}`],
    ["HEAD", `/students/${STUDENT_ID}`],
    ["OPTIONS", `/students/${STUDENT_ID}`],
  ])("%s %s -> 200", async (method, path) => {
    const res = await request(app())[method.toLowerCase() as "get"](path);

    expect(res.status).toBe(200);
  });

  it("OPTIONS /health is 404 with the pre-auth body (no OPTIONS handler; not 401/403) (AC-13)", async () => {
    const res = await request(app()).options("/health");

    expect(res.status).toBe(404);
    expect(res.text).toBe('{"error":"Not found"}');
  });

  it("returns the same bodies as before for GET endpoints", async () => {
    const health = await request(app()).get("/health");
    const list = await request(app()).get("/students");
    const one = await request(app()).get(`/students/${STUDENT_ID}`);

    expect(health.body).toEqual({ status: "ok" });
    expect(list.body.data).toEqual([student]);
    expect(one.body).toEqual({ data: student });
  });

  it("does not validate tokens on safe methods: an invalid Bearer on GET is ignored", async () => {
    const res = await request(app()).get("/students").set("Authorization", "Bearer garbage");

    expect(res.status).toBe(200);
  });

  it("returns 404 (not 401) for GET on an unknown path", async () => {
    const res = await request(app()).get("/nope");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });
});

describe("writes without usable credentials -> 401 A (AC-14)", () => {
  const writes: Array<[string, string]> = [
    ["POST", "/students"],
    ["PUT", `/students/${STUDENT_ID}`],
    ["DELETE", `/students/${STUDENT_ID}`],
    ["PATCH", `/students/${STUDENT_ID}`],
  ];
  const headers: Array<[string, string | undefined]> = [
    ["no Authorization header", undefined],
    ["Basic scheme", "Basic dGVzdDp0ZXN0"],
    ["Bearer with no token", "Bearer"],
    ["Bearer with only spaces", "Bearer    "],
    ["unknown scheme", "Token abc"],
    ["empty header", ""],
  ];

  describe.each(writes)("%s %s", (method, path) => {
    it.each(headers)("%s", async (_label, header) => {
      let test = request(createApp({ auth }))[method.toLowerCase() as "post"](path);
      if (header !== undefined) {
        test = test.set("Authorization", header);
      }

      const res = await test.send(validCreate);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Authentication required" });
      expect(res.headers["www-authenticate"]).toBe(CHALLENGE_A);
      expect(allRepositoryCalls()).toBe(0);
    });
  });

  it("ignores a token passed in the query string", async () => {
    const res = await request(createApp({ auth }))
      .post(`/students?access_token=${adminToken()}`)
      .send(validCreate);

    expect(res.status).toBe(401);
    expect(allRepositoryCalls()).toBe(0);
  });

  // Node's HTTP client cannot deliver an empty-token candidate (it trims plain trailing spaces), so call the guard directly.
  it.each([["Bearer "], ["Bearer \u00a0"], ["Bearer \t"]])(
    "guard treats %j as missing credentials, not as an empty token",
    (header) => {
      const setHeader = vi.fn();
      const next = vi.fn();

      requireAdmin(auth)({ headers: { authorization: header } } as Request, { setHeader } as unknown as Response, next);

      expect(setHeader).toHaveBeenCalledWith("WWW-Authenticate", CHALLENGE_A);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401, message: "Authentication required" }));
    },
  );
});

describe("invalid tokens on writes -> 401 B, identical for every cause (AC-15)", () => {
  const unsignedNone = () =>
    `${b64url({ alg: "none", typ: "JWT" })}.${b64url({ role: "admin", iss: "student-api", aud: "student-api", exp: nowSeconds() + 60 })}.`;

  const cases: Array<[string, () => string]> = [
    ["wrong secret", () => mint({ role: "admin" }, {}, "another-secret-another-secret-12345")],
    [
      "tampered payload",
      () => {
        const [header, , signature] = mint({ role: "user" }).split(".");
        const forged = b64url({ role: "admin", iss: "student-api", aud: "student-api", exp: nowSeconds() + 60 });
        return `${header}.${forged}.${signature}`;
      },
    ],
    ["alg none", unsignedNone],
    ["alg none with a stray signature segment", () => `${unsignedNone()}AAAA`],
    ["HS512 with the right secret", () => mint({ role: "admin" }, { algorithm: "HS512" })],
    ["expired", () => mint({ role: "admin", exp: nowSeconds() - 10 }, { omitExp: true })],
    ["wrong issuer", () => mint({ role: "admin" }, { issuer: "someone-else" })],
    ["wrong audience", () => mint({ role: "admin" }, { audience: "someone-else" })],
    ["no exp claim", () => mint({ role: "admin" }, { omitExp: true })],
    ["garbage string", () => "not-a-jwt"],
    ["three garbage segments", () => "a.b.c"],
  ];

  it.each(cases)("%s", async (_label, build) => {
    const res = await request(createApp({ auth }))
      .post("/students")
      .set("Authorization", bearer(build()))
      .send(validCreate);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid or expired token" });
    expect(res.headers["www-authenticate"]).toBe(CHALLENGE_B);
    expect(allRepositoryCalls()).toBe(0);
  });

  it("rejects an invalid token on every write method", async () => {
    const app = createApp({ auth });
    const header = bearer("not-a-jwt");

    for (const res of [
      await request(app).post("/students").set("Authorization", header).send(validCreate),
      await request(app).put(`/students/${STUDENT_ID}`).set("Authorization", header).send({ firstName: "B" }),
      await request(app).delete(`/students/${STUDENT_ID}`).set("Authorization", header),
      await request(app).patch(`/students/${STUDENT_ID}`).set("Authorization", header).send({ firstName: "B" }),
    ]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Invalid or expired token" });
    }
    expect(allRepositoryCalls()).toBe(0);
  });
});

describe("valid token without admin role -> 403 C (AC-16)", () => {
  it.each([
    ["role user", { role: "user" }],
    ["no role claim", { sub: "admin" }],
    ["role with different case", { role: "Admin" }],
    ["role as array", { role: ["admin"] }],
  ])("%s", async (_label, claims) => {
    const res = await request(createApp({ auth }))
      .post("/students")
      .set("Authorization", bearer(mint(claims)))
      .send(validCreate);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Forbidden" });
    expect(res.headers["www-authenticate"]).toBe(CHALLENGE_C);
    expect(allRepositoryCalls()).toBe(0);
  });

  it.each([
    ["PUT", `/students/${STUDENT_ID}`],
    ["DELETE", `/students/${STUDENT_ID}`],
    ["PATCH", `/students/${STUDENT_ID}`],
  ])("%s is also forbidden for role user", async (method, path) => {
    const res = await request(createApp({ auth }))
      [method.toLowerCase() as "put"](path)
      .set("Authorization", bearer(mint({ role: "user" })))
      .send({ firstName: "B" });

    expect(res.status).toBe(403);
    expect(allRepositoryCalls()).toBe(0);
  });
});

describe("valid admin token passes through (AC-17)", () => {
  const authorized = (app = createApp({ auth })) => ({
    post: (path: string) => request(app).post(path).set("Authorization", bearer(adminToken())),
    put: (path: string) => request(app).put(path).set("Authorization", bearer(adminToken())),
    del: (path: string) => request(app).delete(path).set("Authorization", bearer(adminToken())),
    patch: (path: string) => request(app).patch(path).set("Authorization", bearer(adminToken())),
  });

  it("POST /students -> 201 and the repository is called", async () => {
    const res = await authorized().post("/students").send(validCreate);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ data: student });
    expect(studentRepository.insertStudent).toHaveBeenCalledTimes(1);
  });

  it("PUT /students/:id -> 200", async () => {
    const res = await authorized().put(`/students/${STUDENT_ID}`).send({ firstName: "Grace" });

    expect(res.status).toBe(200);
    expect(studentRepository.updateStudent).toHaveBeenCalledWith(STUDENT_ID, { firstName: "Grace" });
  });

  it("DELETE /students/:id -> 204", async () => {
    const res = await authorized().del(`/students/${STUDENT_ID}`);

    expect(res.status).toBe(204);
    expect(studentRepository.deleteStudent).toHaveBeenCalledWith(STUDENT_ID);
  });

  it("invalid body -> 400 Validation failed (route validation still runs)", async () => {
    const res = await authorized().post("/students").send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    expect(studentRepository.insertStudent).not.toHaveBeenCalled();
  });

  it("PUT and DELETE for a missing student -> 404", async () => {
    vi.mocked(studentRepository.updateStudent).mockResolvedValue(null);
    vi.mocked(studentRepository.deleteStudent).mockResolvedValue(false);
    const client = authorized();

    expect((await client.put(`/students/${STUDENT_ID}`).send({ firstName: "G" })).status).toBe(404);
    expect((await client.del(`/students/${STUDENT_ID}`)).status).toBe(404);
  });

  it("duplicate email -> 409", async () => {
    vi.mocked(studentRepository.insertStudent).mockRejectedValue({ code: "23505" });

    const res = await authorized().post("/students").send(validCreate);

    expect(res.status).toBe(409);
  });

  it("PATCH /students/:id with an admin token reaches routing and is 404 (no PATCH route exists)", async () => {
    const res = await authorized().patch(`/students/${STUDENT_ID}`).send({ firstName: "G" });

    expect(res.status).toBe(404);
    expect(allRepositoryCalls()).toBe(0);
  });

  it("accepts a case-insensitive scheme and trailing whitespace", async () => {
    const res = await request(createApp({ auth }))
      .post("/students")
      .set("Authorization", `bearer ${adminToken()} `)
      .send(validCreate);

    expect(res.status).toBe(201);
  });
});

describe("unknown non-safe paths (AC-19)", () => {
  it.each([
    ["POST", "/nope"],
    ["PUT", "/nope"],
    ["DELETE", "/nope"],
    ["POST", "/health"],
  ])("%s %s -> 401 without a token, 404 with an admin token", async (method, path) => {
    const app = createApp({ auth });
    const verb = method.toLowerCase() as "post";

    const anonymous = await request(app)[verb](path).send({});
    const admin = await request(app)[verb](path).set("Authorization", bearer(adminToken())).send({});

    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toEqual({ error: "Authentication required" });
    expect(admin.status).toBe(404);
    expect(admin.body).toEqual({ error: "Not found" });
  });
});

describe("createApp() default configuration (AC-22)", () => {
  it("uses config.auth: tokens signed with it are accepted and its credentials log in", async () => {
    const app = createApp();
    const token = jwt.sign({ role: "admin" }, config.auth.jwtSecret, {
      algorithm: "HS256",
      expiresIn: 60,
      issuer: "student-api",
      audience: "student-api",
    });

    const write = await request(app).post("/students").set("Authorization", bearer(token)).send(validCreate);
    const login = await request(app)
      .post("/auth/login")
      .send({ username: config.auth.adminUsername, password: config.auth.adminPassword });

    expect(write.status).toBe(201);
    expect(login.status).toBe(200);
  });

  it("rejects a token signed with some other secret", async () => {
    const res = await request(createApp())
      .post("/students")
      .set("Authorization", bearer(mint({ role: "admin" }, {}, "another-secret-another-secret-12345")))
      .send(validCreate);

    expect(res.status).toBe(401);
  });
});

describe("guard cannot be bypassed by path or method variants (AC-25)", () => {
  it.each([
    ["case variant", "/Students"],
    ["trailing slash", "/students/"],
    ["double leading slash", "//students"],
    ["percent-encoded letter", "/%73tudents"],
    ["dot segment", "/students/../students"],
  ])("POST %s without a token -> 401, repository untouched", async (_label, path) => {
    const res = await request(createApp({ auth })).post(path).send(validCreate);

    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toBe(CHALLENGE_A);
    expect(allRepositoryCalls()).toBe(0);
  });

  it.each(["GET", "DELETE", "get", "OPTIONS"])(
    "POST /students with X-HTTP-Method-Override: %s without a token -> 401",
    async (override) => {
      const res = await request(createApp({ auth }))
        .post("/students")
        .set("X-HTTP-Method-Override", override)
        .send(validCreate);

      expect(res.status).toBe(401);
      expect(allRepositoryCalls()).toBe(0);
    },
  );

  it("a GET with X-HTTP-Method-Override: DELETE stays a read and deletes nothing", async () => {
    const res = await request(createApp({ auth }))
      .get(`/students/${STUDENT_ID}`)
      .set("X-HTTP-Method-Override", "DELETE");

    expect(res.status).toBe(200);
    expect(studentRepository.deleteStudent).not.toHaveBeenCalled();
  });
});
