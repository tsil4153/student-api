import type { NextFunction, RequestHandler, Response } from "express";
import { AppError } from "../errors/AppError";
import { verifyToken } from "./auth.service";
import { ADMIN_ROLE, AUTH_REALM, type AuthConfig } from "./auth.types";

const BEARER_PATTERN = /^Bearer +(\S+)\s*$/i;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function deny(
  res: Response,
  next: NextFunction,
  status: number,
  message: string,
  error?: string,
): void {
  const challenge =
    error === undefined ? `Bearer realm="${AUTH_REALM}"` : `Bearer realm="${AUTH_REALM}", error="${error}"`;

  res.setHeader("WWW-Authenticate", challenge);
  next(new AppError(status, message));
}

export function requireAdmin(auth: AuthConfig): RequestHandler {
  return (req, res, next) => {
    const match = BEARER_PATTERN.exec(req.headers.authorization ?? "");

    if (!match) {
      deny(res, next, 401, "Authentication required");
      return;
    }

    const claims = verifyToken(auth, match[1]);

    if (!claims) {
      deny(res, next, 401, "Invalid or expired token", "invalid_token");
      return;
    }

    if (claims.role !== ADMIN_ROLE) {
      deny(res, next, 403, "Forbidden", "insufficient_scope");
      return;
    }

    req.auth = claims;
    next();
  };
}

export function requireAdminForWrites(auth: AuthConfig): RequestHandler {
  const adminOnly = requireAdmin(auth);

  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }

    adminOnly(req, res, next);
  };
}
