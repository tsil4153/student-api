import { Buffer } from "node:buffer";
import jwt from "jsonwebtoken";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  issueToken,
  verifyCredentials,
  verifyToken,
} from "../src/auth/auth.service";
import {
  TOKEN_AUDIENCE,
  TOKEN_ISSUER,
  TOKEN_TTL_SECONDS,
  type AuthConfig,
} from "../src/auth/auth.types";

// Spy wrapper: real implementation, but lets AC-7 observe that both fields are always compared.
const { timingSafeEqualSpy } = vi.hoisted(() => ({ timingSafeEqualSpy: vi.fn() }));
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  timingSafeEqualSpy.mockImplementation(actual.timingSafeEqual);
  return { ...actual, timingSafeEqual: timingSafeEqualSpy };
});

const auth: AuthConfig = {
  adminUsername: "test-admin",
  adminPassword: "pässwörd✓",
  jwtSecret: "test-only-fake-jwt-secret-0123456789-abcdef",
};

const b64url = (value: object): string => Buffer.from(JSON.stringify(value)).toString("base64url");

type Omittable = "issuer" | "audience" | "expiresIn";

// jsonwebtoken rejects explicit `undefined` options, so claims are dropped via `omit`.
function mint(
  payload: object | string,
  options: jwt.SignOptions = {},
  secret: string = auth.jwtSecret,
  omit: Omittable[] = [],
): string {
  const signOptions: jwt.SignOptions = {
    algorithm: "HS256",
    issuer: TOKEN_ISSUER,
    audience: TOKEN_AUDIENCE,
    expiresIn: 60,
    ...options,
  };
  for (const key of omit) {
    delete signOptions[key];
  }
  return jwt.sign(payload, secret, signOptions);
}

afterEach(() => {
  timingSafeEqualSpy.mockClear();
});

describe("verifyCredentials", () => {
  it.each([
    ["correct username and password", "test-admin", "pässwörd✓", true],
    ["wrong username", "other-admin", "pässwörd✓", false],
    ["wrong password", "test-admin", "wrong-password", false],
    ["both wrong", "nobody", "nothing", false],
    ["username differs by case", "Test-Admin", "pässwörd✓", false],
    ["password with trailing space", "test-admin", "pässwörd✓ ", false],
    ["password differing only in a Unicode character", "test-admin", "passwörd✓", false],
    ["input much longer than expected (length mismatch)", "a".repeat(10_000), "b".repeat(10_000), false],
    ["empty input shorter than expected", "", "", false],
  ])("%s -> %s", (_label, username, password, expected) => {
    expect(verifyCredentials(auth, username, password)).toBe(expected);
  });

  it("does not throw when the expected value is longer or Unicode-heavy", () => {
    const longAuth: AuthConfig = { ...auth, adminUsername: "u".repeat(500), adminPassword: "🔑".repeat(200) };

    expect(() => verifyCredentials(longAuth, "x", "y")).not.toThrow();
    expect(verifyCredentials(longAuth, "u".repeat(500), "🔑".repeat(200))).toBe(true);
  });

  it("compares both fields even when the username is already wrong (no short-circuit)", () => {
    verifyCredentials(auth, "wrong-user", "wrong-pass");

    expect(timingSafeEqualSpy).toHaveBeenCalledTimes(2);
  });
});

describe("issueToken", () => {
  it("returns the documented response shape", () => {
    const result = issueToken(auth);

    expect(Object.keys(result).sort()).toEqual(["accessToken", "expiresIn", "tokenType"]);
    expect(result.tokenType).toBe("Bearer");
    expect(result.expiresIn).toBe(TOKEN_TTL_SECONDS);
  });

  it("issues an HS256 token with admin claims valid for 3600 seconds (AC-5)", () => {
    const { accessToken } = issueToken(auth);
    const decoded = jwt.decode(accessToken, { complete: true });

    expect(decoded?.header.alg).toBe("HS256");
    expect(decoded?.payload).toMatchObject({
      sub: "admin",
      role: "admin",
      iss: "student-api",
      aud: "student-api",
    });

    const { iat, exp } = decoded?.payload as { iat: number; exp: number };
    expect(exp - iat).toBe(3600);
  });

  it("does not embed the username or password in the token", () => {
    const { accessToken } = issueToken(auth);
    const decodedText = Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8");

    expect(decodedText).not.toContain(auth.adminUsername);
    expect(decodedText).not.toContain(auth.adminPassword);
    expect(accessToken).not.toContain(auth.jwtSecret);
  });

  it("produces a token that verifyToken accepts", () => {
    const claims = verifyToken(auth, issueToken(auth).accessToken);

    expect(claims).toMatchObject({ sub: "admin", role: "admin" });
  });
});

describe("verifyToken (AC-15: every failure returns null)", () => {
  const nowSeconds = () => Math.floor(Date.now() / 1000);

  it("returns claims for a valid admin token", () => {
    expect(verifyToken(auth, mint({ role: "admin" }))).toMatchObject({ role: "admin" });
  });

  it("returns claims for a valid non-admin token (role is checked by the guard, not here)", () => {
    expect(verifyToken(auth, mint({ role: "user" }))).toMatchObject({ role: "user" });
  });

  const invalidTokens: Array<[string, () => string]> = [
    ["signed with a different secret", () => mint({ role: "admin" }, {}, "another-secret-another-secret-12345")],
    [
      "payload tampered after signing",
      () => {
        const [header, , signature] = mint({ role: "user" }).split(".");
        const forged = b64url({ role: "admin", iss: TOKEN_ISSUER, aud: TOKEN_AUDIENCE, exp: nowSeconds() + 60 });
        return `${header}.${forged}.${signature}`;
      },
    ],
    [
      "alg none (unsigned)",
      () => `${b64url({ alg: "none", typ: "JWT" })}.${b64url({ role: "admin", iss: TOKEN_ISSUER, aud: TOKEN_AUDIENCE, exp: nowSeconds() + 60 })}.`,
    ],
    ["HS512 signed with the same secret", () => mint({ role: "admin" }, { algorithm: "HS512" })],
    ["expired", () => mint({ role: "admin", exp: nowSeconds() - 10 }, {}, auth.jwtSecret, ["expiresIn"])],
    ["wrong issuer", () => mint({ role: "admin" }, { issuer: "someone-else" })],
    ["wrong audience", () => mint({ role: "admin" }, { audience: "someone-else" })],
    ["no exp claim", () => mint({ role: "admin" }, {}, auth.jwtSecret, ["expiresIn"])],
    ["string payload", () => mint("just-a-string", {}, auth.jwtSecret, ["issuer", "audience", "expiresIn"])],
    ["garbage string", () => "not-a-jwt"],
    ["three garbage segments", () => "a.b.c"],
    ["empty string", () => ""],
    ["only dots", () => ".."],
  ];

  it.each(invalidTokens)("%s", (_label, build) => {
    expect(verifyToken(auth, build())).toBeNull();
  });
});
