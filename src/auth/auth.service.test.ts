import * as crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../errors/AppError";
import { authenticateCredentials, credentialsMatch } from "./auth.service";

const auth = {
  username: "configured-admin",
  password: "configured-password",
  jwtSecret: "configured-jwt-secret-that-is-long-enough",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("authenticateCredentials", () => {
  it("issues an HS256 token for the configured subject with a one-hour expiry", () => {
    const token = authenticateCredentials(auth, {
      username: auth.username,
      password: auth.password,
    });
    const claims = jwt.verify(token, auth.jwtSecret, { algorithms: ["HS256"] });
    const header = jwt.decode(token, { complete: true })?.header;

    expect(header?.alg).toBe("HS256");
    expect(claims).toMatchObject({ sub: auth.username });
    if (typeof claims === "string") {
      throw new Error("Expected an object payload");
    }
    expect(claims.exp! - claims.iat!).toBe(3600);
  });

  it.each([
    ["wrong username", "other-admin", auth.password],
    ["wrong password", auth.username, "other-password"],
    ["both wrong", "other-admin", "other-password"],
  ])(
    "rejects %s with the same generic response and compares both values",
    (_label, username, password) => {
      const comparison = vi.fn(crypto.timingSafeEqual);
      const credentials = { username, password };

      try {
        authenticateCredentials(auth, credentials);
        throw new Error("Expected invalid credentials to be rejected");
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect(error).toMatchObject({ statusCode: 401, message: "Invalid username or password" });
      }

      expect(credentialsMatch(auth, credentials, comparison)).toBe(false);
      expect(comparison).toHaveBeenCalledTimes(2);
    },
  );
});