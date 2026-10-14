import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import * as studentService from "./student.service";
import type { Student } from "./student.types";

vi.mock("../db/pool", () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

vi.mock("./student.service", () => ({
  createStudent: vi.fn(),
  getStudent: vi.fn(),
  listStudents: vi.fn(),
  updateStudent: vi.fn(),
  removeStudent: vi.fn(),
}));

const auth = {
  username: "configured-admin",
  password: "configured-password",
  jwtSecret: "configured-jwt-secret-that-is-long-enough",
};
const student: Student = {
  id: "00000000-0000-4000-8000-000000000001",
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  dateOfBirth: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const app = createApp({ auth });

function issueToken(
  tokenAuth = auth,
  subject = tokenAuth.username,
  secret = tokenAuth.jwtSecret,
  algorithm: "HS256" | "HS384" = "HS256",
  expiresIn: jwt.SignOptions["expiresIn"] = "1h",
): string {
  return jwt.sign({}, secret, { algorithm, subject, expiresIn });
}

function unsignedToken(): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ sub: auth.username, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString("base64url");
  return `${header}.${payload}.`;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(studentService.createStudent).mockResolvedValue(student);
  vi.mocked(studentService.getStudent).mockResolvedValue(student);
  vi.mocked(studentService.listStudents).mockResolvedValue({
    data: [student],
    pagination: { limit: 20, offset: 0, total: 1 },
  });
  vi.mocked(studentService.updateStudent).mockResolvedValue(student);
  vi.mocked(studentService.removeStudent).mockResolvedValue();
});

describe("protected student routes", () => {
  const writeMethods = ["POST", "PUT", "DELETE"] as const;
  const invalidTokens = [
    ["missing", undefined],
    ["malformed", "Bearer"],
    ["wrong secret", `Bearer ${issueToken(auth, auth.username, "another-long-secret-value")}`],
    ["expired", `Bearer ${issueToken(auth, auth.username, auth.jwtSecret, "HS256", -1)}`],
    ["wrong subject", `Bearer ${issueToken(auth, "someone-else")}`],
    ["wrong algorithm", `Bearer ${issueToken(auth, auth.username, auth.jwtSecret, "HS384")}`],
    ["none algorithm", `Bearer ${unsignedToken()}`],
  ] as const;

  it.each(invalidTokens)("rejects %s credentials consistently on every write", async (_label, authorization) => {
    for (const method of writeMethods) {
      const path = method === "POST" ? "/students" : `/students/${student.id}`;
      let response;

      if (method === "POST") {
        const call = request(app).post(path);
        if (authorization) call.set("Authorization", authorization);
        response = await call.set("Content-Type", "application/json").send("{invalid");
      } else if (method === "PUT") {
        const call = request(app).put(path);
        if (authorization) call.set("Authorization", authorization);
        response = await call.set("Content-Type", "application/json").send("{invalid");
      } else {
        const call = request(app).delete(path);
        if (authorization) call.set("Authorization", authorization);
        response = await call;
      }

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: "Authentication required" });
      expect(response.headers["www-authenticate"]).toBe("Bearer");
    }

    expect(studentService.createStudent).not.toHaveBeenCalled();
    expect(studentService.updateStudent).not.toHaveBeenCalled();
    expect(studentService.removeStudent).not.toHaveBeenCalled();
  });

  it("rejects tokens issued under changed secret or username configuration", async () => {
    const oldToken = issueToken();
    const changedConfigs = [
      { ...auth, jwtSecret: "changed-secret-that-is-also-long-enough" },
      { ...auth, username: "changed-admin" },
    ];

    for (const changedAuth of changedConfigs) {
      const changedApp = createApp({ auth: changedAuth });
      const response = await request(changedApp)
        .delete(`/students/${student.id}`)
        .set("Authorization", `Bearer ${oldToken}`);

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: "Authentication required" });
      expect(response.headers["www-authenticate"]).toBe("Bearer");
    }
  });

  it("requires authentication before body validation and student lookup", async () => {
    const invalidBody = await request(app)
      .post("/students")
      .set("Content-Type", "application/json")
      .send("{invalid");
    const nonexistentStudent = await request(app).delete("/students/00000000-0000-4000-8000-000000000099");

    expect(invalidBody.status).toBe(401);
    expect(nonexistentStudent.status).toBe(401);
    expect(studentService.createStudent).not.toHaveBeenCalled();
    expect(studentService.removeStudent).not.toHaveBeenCalled();
  });

  it("allows valid admin tokens to create, update, and delete students", async () => {
    const token = issueToken();
    const authorization = `Bearer ${token}`;
    const created = await request(app)
      .post("/students")
      .set("Authorization", authorization)
      .send({ firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" });
    const updated = await request(app)
      .put(`/students/${student.id}`)
      .set("Authorization", authorization)
      .send({ firstName: "Augusta" });
    const deleted = await request(app).delete(`/students/${student.id}`).set("Authorization", authorization);

    expect(created.status).toBe(201);
    expect(updated.status).toBe(200);
    expect(deleted.status).toBe(204);
    expect(studentService.createStudent).toHaveBeenCalledOnce();
    expect(studentService.updateStudent).toHaveBeenCalledOnce();
    expect(studentService.removeStudent).toHaveBeenCalledOnce();
  });

  it("validates malformed JSON after authentication succeeds", async () => {
    const response = await request(app)
      .post("/students")
      .set("Authorization", `Bearer ${issueToken()}`)
      .set("Content-Type", "application/json")
      .send("{invalid");

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Validation failed");
  });
});

describe("public student and health routes", () => {
  it("keeps listing, viewing, and health accessible without a token", async () => {
    const list = await request(app).get("/students");
    const detail = await request(app).get(`/students/${student.id}`);
    const health = await request(app).get("/health");

    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([student]);
    expect(detail.status).toBe(200);
    expect(detail.body).toEqual({ data: student });
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ status: "ok" });
  });
});