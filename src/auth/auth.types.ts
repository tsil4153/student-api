export interface AuthConfig {
  adminUsername: string;
  adminPassword: string;
  jwtSecret: string;
}

export interface TokenClaims {
  sub: string;
  role: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
}

export const TOKEN_TTL_SECONDS = 3600;
export const TOKEN_ISSUER = "student-api";
export const TOKEN_AUDIENCE = "student-api";
export const AUTH_REALM = "student-api";
export const ADMIN_ROLE = "admin";
export const ADMIN_SUBJECT = "admin";

declare global {
  namespace Express {
    interface Request {
      auth?: TokenClaims;
    }
  }
}
