# Authentication — Tech Specs (WHAT)

Size: MEDIUM. Status: draft for review. Companion: [authentication-PLAN.md](authentication-PLAN.md) (HOW).
Binding inputs: [coding-flow-state.md](../../agents/TEMP/authentication/coding-flow-state.md), [architecture-notes.md](../../agents/TEMP/authentication/architecture-notes.md) (Option B, approved; rationale, flows, OWASP table live there — not repeated).

## 0. TLDR

- `POST /auth/login` checks `ADMIN_USERNAME`/`ADMIN_PASSWORD` from env → JWT HS256, 1 h, no refresh.
- Global guard after `/health` + `/auth`: GET/HEAD/OPTIONS public; every other method needs `Authorization: Bearer <jwt>` with `role:"admin"`.
- 401 = no/invalid token; 403 = valid token, role ≠ admin. Exact headers in §5.
- Login rate limit: 5 failed credential checks (401) / 15 min / IP, in-memory, per app instance. Only 401 responses count; 200 and 400 do not.
- Startup fails fast on missing/empty auth env or `JWT_SECRET` < 32 chars; messages name the key only.
- Malformed JSON on any route → 400 `{"error":"Invalid JSON body"}`, nothing logged.
- `createApp(options?: { auth?: AuthConfig })` for test injection. Tests: vitest 5 + supertest, no Postgres.

## 1. Scope

In: login, JWT issue/verify, write guard, login rate limit, auth config validation, JSON parse-error fix, tests, `.env.example`, docs.
Out: user store, admin creation, password reset, refresh/revocation, roles beyond `admin`, HTTPS, reverse proxy (`trust proxy` stays unset), password-strength policy.

## 2. Existing code (evidence)

| Fact | Evidence |
|---|---|
| `createApp()` no params; json 1mb → `/health` → `/students` → 404 → errorHandler | [src/app.ts](../../src/app.ts#L7-L26) |
| Config read at import; throws on invalid; `dotenv/config` loaded first | [src/config.ts](../../src/config.ts#L1-L29) |
| `pool` imports `config` → importing app validates env | [src/db/pool.ts](../../src/db/pool.ts#L1-L9) |
| errorHandler: ZodError→400 `Validation failed`+details; AppError→status; else `console.error(error)`+500 | [src/middleware/errorHandler.ts](../../src/middleware/errorHandler.ts#L9-L33) |
| Import-time throw → process exits 1 (uncaught, before `main`) | [src/index.ts](../../src/index.ts#L1-L2), [src/index.ts](../../src/index.ts#L55-L59) |
| Student routes GET `/`, GET `/:id`, POST `/`, PUT `/:id`, DELETE `/:id` | [src/students/student.routes.ts](../../src/students/student.routes.ts#L7-L11) |
| tsconfig `rootDir: src`, `include: ["src"]`, CJS | [tsconfig.json](../../tsconfig.json#L4-L7), [tsconfig.json](../../tsconfig.json#L14) |
| `engines.node >=18`, no test script | [package.json](../../package.json#L7-L17) |
| `.env.example` has PORT, DATABASE_URL only | [.env.example](../../.env.example#L1-L2) |

## 3. Architecture

Mount order in `createApp` (order is the policy; pinned by AC-18):

```
express.json(1mb) → GET /health → /auth (authRouter) → requireAdminForWrites → /students → notFoundHandler → errorHandler
```

Consequences (intended): body parsing runs before the guard (malformed JSON → 400 even without token); `/auth/*` never reaches the guard; unknown non-safe path → 401 without token, 404 with admin token.

| Unit | File | Responsibility |
|---|---|---|
| types | `src/auth/auth.types.ts` | `AuthConfig`, `TokenClaims`, `LoginResponse`, constants, `Express.Request.auth` augmentation |
| schema | `src/auth/auth.schema.ts` | `loginSchema` |
| service | `src/auth/auth.service.ts` | credential check, token issue, token verify (pure; no Express) |
| middleware | `src/auth/auth.middleware.ts` | `requireAdmin`, `requireAdminForWrites` |
| controller | `src/auth/auth.controller.ts` | login handler |
| routes | `src/auth/auth.routes.ts` | `createAuthRouter`: limiter + POST `/login` + router-local 404 |
| config | `src/config.ts` | `config.auth` validation |
| app | `src/app.ts` | options, mount order |
| errors | `src/middleware/errorHandler.ts` | JSON parse error branch |

`src/index.ts`, `src/students/*`, `src/errors/AppError.ts` — unchanged.

## 4. Interfaces (signatures only)

```ts
// auth.types.ts
export interface AuthConfig { adminUsername: string; adminPassword: string; jwtSecret: string }
export interface TokenClaims { sub: string; role: string; iss: string; aud: string; iat: number; exp: number }
export interface LoginResponse { accessToken: string; tokenType: "Bearer"; expiresIn: number }
export const TOKEN_TTL_SECONDS = 3600; export const TOKEN_ISSUER = "student-api"; export const TOKEN_AUDIENCE = "student-api";
export const AUTH_REALM = "student-api"; export const ADMIN_ROLE = "admin"; export const ADMIN_SUBJECT = "admin";
declare global { namespace Express { interface Request { auth?: TokenClaims } } }

// auth.schema.ts
export const loginSchema: z.ZodType<{ username: string; password: string }>;

// auth.service.ts
export function verifyCredentials(auth: AuthConfig, username: string, password: string): boolean;
export function issueToken(auth: AuthConfig): LoginResponse;
export function verifyToken(auth: AuthConfig, token: string): TokenClaims | null; // null on ANY failure, never throws

// auth.middleware.ts
export function requireAdmin(auth: AuthConfig): RequestHandler;
export function requireAdminForWrites(auth: AuthConfig): RequestHandler;

// auth.controller.ts
export function createLoginHandler(auth: AuthConfig): (req: Request, res: Response) => Promise<void>;

// auth.routes.ts
export function createAuthRouter(auth: AuthConfig): Router;

// app.ts
export interface CreateAppOptions { auth?: AuthConfig }
export function createApp(options?: CreateAppOptions): Express; // auth defaults to config.auth

// config.ts
export const config: { port: number; databaseUrl: string; auth: AuthConfig };
```

### 4.1 Behavior contracts

| Unit | Contract |
|---|---|
| `loginSchema` | `z.object({ username, password }).strict()`; each `z.string().min(1).max(256)`; no trim, no transform. |
| `verifyCredentials` | SHA-256 digest of input and expected for BOTH fields; `crypto.timingSafeEqual` on each digest pair; both comparisons always computed (no short-circuit before both run); returns `userOk && passOk` afterwards. Never throws for any string input (any length, Unicode). |
| `issueToken` | `jsonwebtoken.sign({ role: "admin" }, jwtSecret, { algorithm: "HS256", expiresIn: 3600, subject: "admin", issuer, audience })` → `{ accessToken, tokenType: "Bearer", expiresIn: 3600 }`. Payload carries no username/password. |
| `verifyToken` | `jsonwebtoken.verify` with `algorithms: ["HS256"]`, `issuer`, `audience`. Additionally reject if payload is not an object or `typeof exp !== "number"` (jsonwebtoken accepts tokens without `exp`). Catches all errors → `null`. Does not check role. |
| `requireAdmin` | Parse `Authorization` with `/^Bearer +(\S+)\s*$/i`. No header / no match → 401 A. `verifyToken` null → 401 B. `role !== "admin"` → 403 C. Else `req.auth = claims; next()`. Errors go via `res.setHeader("WWW-Authenticate", …)` + `next(new AppError(…))`. Never logs. |
| `requireAdminForWrites` | `GET`/`HEAD`/`OPTIONS` → `next()`; any other method → `requireAdmin`. |
| `createAuthRouter` | New limiter instance per call. Route: `POST /login` → limiter → login handler. Router ends with `notFoundHandler` so no `/auth/*` request reaches the guard. Limiter applies only to `POST /login`. |
| login limiter (express-rate-limit v8) | `windowMs: 900000`, `limit: 5`, `skipSuccessfulRequests: true` with `requestWasSuccessful: (_req, res) => res.statusCode !== 401` (only credential failures count; schema 400s and 200s do not), `standardHeaders: "draft-8"`, `legacyHeaders: false`, `handler` → 429 body §5. Default key (IP; `X-Forwarded-For` ignored because `trust proxy` is unset). Option names subject to PLAN verify step. |
| login handler | `loginSchema.parse(req.body)` (ZodError → existing 400). `verifyCredentials` false → `res.setHeader("WWW-Authenticate", 'Bearer realm="student-api"')` + `AppError(401,"Invalid credentials")`. True → 200 `issueToken(auth)` with header `Cache-Control: no-store`. |
| `errorHandler` | New first branch: error object with `type === "entity.parse.failed"` → 400 `{ error: "Invalid JSON body" }`; no `console.*`; raw body never echoed. Other branches unchanged. |
| `config.auth` | Read `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `JWT_SECRET`. Missing or `value.trim() === ""` → `throw new Error("<KEY> is required")`. `JWT_SECRET.length < 32` → `throw new Error("JWT_SECRET must be at least 32 characters")`. Stored raw (no trim). Messages never contain values. |

## 5. Error / status matrix (exact)

| # | Case | Status | Body | `WWW-Authenticate` / other headers |
|---|---|---|---|---|
| E1 | Malformed JSON, any route, any auth state | 400 | `{"error":"Invalid JSON body"}` | — |
| E2 | Login body fails `loginSchema` | 400 | `{"error":"Validation failed","details":{…}}` (existing shape) | — |
| E3 | Login wrong username and/or password | 401 | `{"error":"Invalid credentials"}` | `Bearer realm="student-api"` |
| E4 | Login over limit (≥5 failed in window, same IP) | 429 | `{"error":"Too many login attempts, try again later"}` | `Retry-After`, `RateLimit`, `RateLimit-Policy` |
| E5 | Login OK | 200 | `{"accessToken":"…","tokenType":"Bearer","expiresIn":3600}` | `Cache-Control: no-store` |
| A | Non-safe method, header missing / not Bearer / empty token | 401 | `{"error":"Authentication required"}` | `Bearer realm="student-api"` |
| B | Non-safe method, token invalid (sig, alg incl. `none`, exp, missing exp, iss, aud, malformed) | 401 | `{"error":"Invalid or expired token"}` (same for all) | `Bearer realm="student-api", error="invalid_token"` |
| C | Non-safe method, valid token, `role` ≠ `"admin"` or absent | 403 | `{"error":"Forbidden"}` | `Bearer realm="student-api", error="insufficient_scope"` |
| D | Non-safe method, valid admin token | as today (201/200/204/400/404/409) | as today | — |
| F | GET/HEAD/OPTIONS anywhere; `/auth/*` any method | as today / 404 `{"error":"Not found"}` for unknown | as today | — |
| G | Startup with bad auth env | process exits non-zero | stderr names key only | — |

Precedence: E1 (global parser) → A/B/C (guard) → route validation/handler. On `/auth/login`: limiter (E4) → E2 → E3/E5.
Error bodies contain only `error` (+ `details` for E2). No token, secret, password, username, or `Authorization` value in any body or log.

## 6. Configuration

| Key | Rule | `.env.example` value |
|---|---|---|
| `PORT` | unchanged | `3000` (unchanged) |
| `DATABASE_URL` | unchanged | unchanged |
| `ADMIN_USERNAME` | required, non-blank | empty (`ADMIN_USERNAME=`) |
| `ADMIN_PASSWORD` | required, non-blank | empty (`ADMIN_PASSWORD=`) |
| `JWT_SECRET` | required, non-blank, length ≥ 32 | empty (`JWT_SECRET=`); comment above it: generate with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |

Empty example values are deliberate: copying `.env.example` without filling the 3 keys must fail startup (AC-1), never yield a predictable admin login.

`package.json`: `engines.node` → `">=22.12"`; deps `jsonwebtoken ^9.0.3`, `express-rate-limit ^8.7.1`; devDeps `@types/jsonwebtoken ^9.0.10`, `vitest ^5.0.4`, `supertest ^7.3.1`, `@types/supertest ^7.2.1`; script `"test": "vitest run"`. Other deps unchanged.
`vitest.config.ts` (root): `test.env` sets dummy `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `JWT_SECRET` (≥32 chars, test-only, obviously fake). Tests in `tests/`.
`tsconfig.test.json` (new): extends `tsconfig.json`, `noEmit`, `rootDir: "."`, `include: ["src", "tests", "vitest.config.ts"]`. `package.json` script `typecheck` becomes `tsc --noEmit && tsc --noEmit -p tsconfig.test.json`. `tsconfig.json` and `build` stay unchanged. If `moduleResolution: node` cannot resolve vitest types, override `module`/`moduleResolution` in `tsconfig.test.json` only.

## 7. Acceptance criteria

Verification: T = automated test (mapping in PLAN §Test plan), R = code review, M = manual run.

| ID | Criterion | Verify |
|---|---|---|
| AC-1 | Each of `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `JWT_SECRET` missing or blank → config import throws `"<KEY> is required"`; message excludes value | T, M |
| AC-2 | `JWT_SECRET` of 31 chars → throws `"JWT_SECRET must be at least 32 characters"` (value not in message); 32 chars → OK | T |
| AC-3 | `.env.example` lists the 3 keys with empty values (§6); no usable default credential or secret | R |
| AC-4 | Valid login → E5 exactly (no extra keys; `Cache-Control: no-store`) | T |
| AC-5 | Issued token: header `alg:"HS256"`; payload `sub:"admin"`, `role:"admin"`, `iss`/`aud` `"student-api"`, `exp − iat = 3600`; no username/password values in token | T |
| AC-6 | Wrong username / wrong password / both wrong → E3, byte-identical bodies and headers | T |
| AC-7 | `verifyCredentials` uses SHA-256 + `timingSafeEqual` on both fields, no short-circuit; never throws on length/Unicode mismatch | R, T |
| AC-8 | Login body: missing field, non-string, `""`, 257 chars, extra key, JSON array → E2; scalar JSON (`null`, `"x"`, `1`) is rejected by the JSON parser → E1; 256 chars passes schema | T |
| AC-9 | After 5 credential failures (E3) from one IP in 15 min, 6th request → E4, even with correct credentials; a different client IP is unaffected; a spoofed `X-Forwarded-For` does not change the bucket | T |
| AC-10 | ≥6 consecutive successful logins → all 200; ≥6 schema-invalid bodies (E2) do not consume attempts (successes and E2 not counted) | T |
| AC-11 | Limiter state is per `createApp()` instance; GET `/students` and write routes are not rate limited | T |
| AC-12 | Any method on `/auth/<unknown>` and GET `/auth/login` → 404 without token | T |
| AC-13 | GET/HEAD on `/health`, `/students`, `/students/:id` and OPTIONS on `/students`, `/students/:id` succeed without token (as today); OPTIONS `/health` is never 401/403 (it returns 404 as before, pre-existing) | T |
| AC-14 | POST `/students`, PUT/DELETE `/students/:id`, PATCH `/students/:id` without header, with `Basic …`, with `Bearer` (empty) → A; repository not called | T |
| AC-15 | Tokens: wrong secret, tampered payload, `alg:none`, HS512 with same secret, expired, wrong `iss`, wrong `aud`, no `exp`, garbage string → B, identical body | T |
| AC-16 | Valid signature, `role:"user"` or no role → C | T |
| AC-17 | Valid admin token → POST 201, PUT 200, DELETE 204, invalid body 400 (as today, repository mocked) | T |
| AC-18 | Mount order: POST `/auth/login` works without token while POST `/students` → 401 in the same app | T |
| AC-19 | Unknown non-safe path (e.g. POST `/nope`, POST `/health`): no token → A; admin token → 404 | T |
| AC-20 | Malformed JSON on `/auth/login` and `/students` → E1; `console.error/warn/log` not called; raw body not in response | T |
| AC-21 | During AC-4..AC-20 runs, no `console.*` call contains password, token, or `Authorization` value; no auth error reaches the 500 branch | T, R |
| AC-22 | `createApp()` with no args uses `config.auth`; `src/index.ts` unchanged | R, T |
| AC-23 | `package.json` per §6; `npm run typecheck` (src and tests) and `npm test` pass; tests need no Postgres and no real `.env` values | M |
| AC-24 | `docs/CONTEXT.md`, `docs/ARCHITECTURE.md` exist and describe auth behavior, env keys, run/test commands | R |
| AC-25 | Guard cannot be bypassed by path or method variants: `POST /Students`, `POST /students/`, `POST //students`, and `POST /students` with `X-HTTP-Method-Override: GET` all return A without a token; repository not called | T |

## 8. Security (threat summary)

STRIDE → controls: Spoofing — HS256 pinned, iss/aud/exp checked, timing-safe credential compare, rate limit (AC-5, AC-7, AC-9, AC-15). Tampering — signature + alg pin (AC-15). Repudiation — not in scope (no audit log). Info disclosure — generic messages, no oracle between jwt failure types, no body/secret logging (AC-6, AC-15, AC-20, AC-21). DoS — limiter per IP; accepted: in-memory, reset on restart, shared bucket behind a proxy. Elevation — role check, deny-by-default for non-safe methods (AC-14, AC-16, AC-19).
Accepted risks: no revocation (rotate `JWT_SECRET`), no password policy, plaintext admin password in `.env` (git-ignored, [.gitignore](../../.gitignore#L3)).

## 9. Assumptions / not verified

- Only still unverified: vitest `test.env` and loading `vitest.config.ts` in a CJS package (checked in T1; fallback `vitest.config.mts`). All other library facts are verified in the section below.
- Accepted limitation: `skipSuccessfulRequests` decrements after the response finishes, so a burst of 6+ simultaneous correct logins can briefly get 429. Single admin, low impact.
- Test files are type-checked through `tsconfig.test.json` (§6); the root `tsconfig.json` `include` stays `["src"]`.
- CORS preflight is out of scope: OPTIONS passes the guard, but no CORS headers are added. No change to current behavior.
- Login 401 carries `WWW-Authenticate` per approved design; `Cache-Control: no-store` on E5 is an addition (OAuth token-response practice), not in the design.

### Verified facts / deviations (I2, installed packages)

No contract deviation. Details and file/line evidence: [agents/MEMORY.md](../../agents/MEMORY.md).

- Verified: jsonwebtoken 9.0.3 option names; `none`/unsigned rejected; token without `exp` accepted (so the extra `exp` check in `verifyToken` is required); `verify` may return a string payload.
- Verified: express-rate-limit 8.7.1 option names (`limit`, `windowMs`, `skipSuccessfulRequests`, `requestWasSuccessful`, `standardHeaders: "draft-8"`, `legacyHeaders`, `handler`); blocks when hits > `limit` (6th request); `Retry-After` set before `handler`; draft-8 headers are `RateLimit` and `RateLimit-Policy`. A blocked 429 is not counted (status ≠ 401, so its hit is decremented).
- Note for tests: a request with `X-Forwarded-For` (trust proxy unset) makes the limiter log one validation `console.error` per limiter (no header value in the message). Count: AC-9 spoof case.
- Verified: body-parser error has `type "entity.parse.failed"`, `status 400`, raw text in `body`; strict mode rejects scalar JSON; empty JSON body parses to `{}` (then E2). Other body-parser errors (413/415) are outside §5 and keep today's 500 path.
- Verified: `npx tsx --version` and `npx vitest --version` exit 0 despite the blocked `esbuild` postinstall.
- Still not verified: loading `vitest.config.ts` in this CJS package (check in T1; fallback `vitest.config.mts`).
