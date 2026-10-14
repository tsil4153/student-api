import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";

vi.mock("../db/pool", () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

const auth = {
  username: "configured-admin",
  password: "configured-password",
  jwtSecret: "configured-jwt-secret-that-is-long-enough",
};
const app = createApp({ auth });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /auth/login", () => {
  it("returns the bearer token response without requiring an existing bearer token", async () => {
    const response = await request(app).post("/auth/login").send({
      username: auth.username,
      password: auth.password,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ tokenType: "Bearer", expiresIn: 3600 });
    expect(typeof response.body.token).toBe("string");
    expect(response.headers["www-authenticate"]).toBeUndefined();
  });

  it.each([
    ["missing username", { password: auth.password }],
    ["missing password", { username: auth.username }],
    ["non-string username", { username: 12, password: auth.password }],
    ["non-string password", { username: auth.username, password: false }],
  ])("rejects %s with the validation response", async (_label, body) => {
    const response = await request(app).post("/auth/login").send(body);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Validation failed");
    expect(response.body.details).toBeDefined();
  });

  it("maps invalid JSON to the validation response", async () => {
    const response = await request(app)
      .post("/auth/login")
      .set("Content-Type", "application/json")
      .send("{invalid");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Validation failed",
      details: { formErrors: ["Invalid JSON"], fieldErrors: {} },
    });
  });

  it.each([
    ["wrong username", "other-admin", auth.password],
    ["wrong password", auth.username, "other-password"],
    ["both wrong", "other-admin", "other-password"],
  ])("returns the same generic 401 for %s", async (_label, username, password) => {
    const response = await request(app).post("/auth/login").send({ username, password });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Invalid username or password" });
    expect(response.headers["www-authenticate"]).toBeUndefined();
  });

  it("does not expose configured secrets in responses or logs", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const success = await request(app).post("/auth/login").send({
      username: auth.username,
      password: auth.password,
    });
    const failure = await request(app).post("/auth/login").send({
      username: auth.username,
      password: "wrong-password",
    });
    const output = JSON.stringify([success.body, failure.body]);

    expect(output).not.toContain(auth.password);
    expect(output).not.toContain(auth.jwtSecret);
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });
});