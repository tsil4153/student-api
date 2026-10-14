import { createHash, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import { AppError } from "../errors/AppError";
import type { AuthConfig } from "../config";

const TOKEN_LIFETIME_SECONDS = 3600;

export interface LoginCredentials {
  username: string;
  password: string;
}

export function authenticateCredentials(auth: AuthConfig, credentials: LoginCredentials): string {
  if (!credentialsMatch(auth, credentials)) {
    throw new AppError(401, "Invalid username or password");
  }

  return jwt.sign({}, auth.jwtSecret, {
    algorithm: "HS256",
    subject: auth.username,
    expiresIn: TOKEN_LIFETIME_SECONDS,
  });
}

export function credentialsMatch(
  auth: AuthConfig,
  credentials: LoginCredentials,
  compare: typeof timingSafeEqual = timingSafeEqual,
): boolean {
  const usernameMatches = compare(hash(credentials.username), hash(auth.username));
  const passwordMatches = compare(hash(credentials.password), hash(auth.password));
  return usernameMatches && passwordMatches;
}

export function verifyAdminToken(auth: AuthConfig, token: string): boolean {
  try {
    const payload = jwt.verify(token, auth.jwtSecret, { algorithms: ["HS256"] });

    return (
      typeof payload === "object" &&
      payload !== null &&
      payload.sub === auth.username &&
      typeof payload.exp === "number" &&
      Number.isFinite(payload.exp)
    );
  } catch {
    return false;
  }
}

function hash(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}