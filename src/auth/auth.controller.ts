import type { Request, Response } from "express";
import { AppError } from "../errors/AppError";
import { loginSchema } from "./auth.schema";
import { issueToken, verifyCredentials } from "./auth.service";
import { AUTH_REALM, type AuthConfig } from "./auth.types";

export function createLoginHandler(auth: AuthConfig) {
  return async (req: Request, res: Response): Promise<void> => {
    const { username, password } = loginSchema.parse(req.body);

    if (!verifyCredentials(auth, username, password)) {
      res.setHeader("WWW-Authenticate", `Bearer realm="${AUTH_REALM}"`);
      throw new AppError(401, "Invalid credentials");
    }

    res.setHeader("Cache-Control", "no-store");
    res.json(issueToken(auth));
  };
}
