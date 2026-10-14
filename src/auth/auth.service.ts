import { createHash, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import {
  ADMIN_ROLE,
  ADMIN_SUBJECT,
  TOKEN_AUDIENCE,
  TOKEN_ISSUER,
  TOKEN_TTL_SECONDS,
  type AuthConfig,
  type LoginResponse,
  type TokenClaims,
} from "./auth.types";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function safeEqual(actual: string, expected: string): boolean {
  return timingSafeEqual(digest(actual), digest(expected));
}

export function verifyCredentials(auth: AuthConfig, username: string, password: string): boolean {
  const userOk = safeEqual(username, auth.adminUsername);
  const passOk = safeEqual(password, auth.adminPassword);

  return userOk && passOk;
}

export function issueToken(auth: AuthConfig): LoginResponse {
  const accessToken = jwt.sign({ role: ADMIN_ROLE }, auth.jwtSecret, {
    algorithm: "HS256",
    expiresIn: TOKEN_TTL_SECONDS,
    subject: ADMIN_SUBJECT,
    issuer: TOKEN_ISSUER,
    audience: TOKEN_AUDIENCE,
  });

  return { accessToken, tokenType: "Bearer", expiresIn: TOKEN_TTL_SECONDS };
}

export function verifyToken(auth: AuthConfig, token: string): TokenClaims | null {
  try {
    const payload = jwt.verify(token, auth.jwtSecret, {
      algorithms: ["HS256"],
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
    });

    // jsonwebtoken accepts signed tokens that have no exp
    if (typeof payload !== "object" || typeof payload.exp !== "number") {
      return null;
    }

    return payload as TokenClaims;
  } catch {
    return null;
  }
}
