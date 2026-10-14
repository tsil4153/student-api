import type { Request, Response } from "express";
import type { AuthConfig } from "../config";
import { authenticateCredentials } from "./auth.service";
import { loginSchema } from "./auth.schema";

export function createLoginController(auth: AuthConfig) {
  return async (req: Request, res: Response): Promise<void> => {
    const credentials = loginSchema.parse(req.body);
    const token = authenticateCredentials(auth, credentials);
    res.status(200).json({ token, tokenType: "Bearer", expiresIn: 3600 });
  };
}