import type { RequestHandler } from "express";
import type { AuthConfig } from "../config";
import { AppError } from "../errors/AppError";
import { verifyAdminToken } from "./auth.service";

const AUTHENTICATION_ERROR = new AppError(401, "Authentication required");

export function requireAdmin(auth: AuthConfig): RequestHandler {
  return (req, res, next) => {
    const authorization = req.get("authorization");
    const match = authorization?.match(/^Bearer ([^\s]+)$/i);

    if (!match || !verifyAdminToken(auth, match[1])) {
      res.setHeader("WWW-Authenticate", "Bearer");
      next(AUTHENTICATION_ERROR);
      return;
    }

    next();
  };
}