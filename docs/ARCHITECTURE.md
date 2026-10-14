# Student API — Architecture

Contracts (signatures, exact bodies, acceptance criteria): [plans/authentication/authentication-SPECS.md](../plans/authentication/authentication-SPECS.md). Not repeated here. Business view: [CONTEXT.md](CONTEXT.md).

## Stack

TypeScript (CommonJS), Express 4, PostgreSQL (`pg`), Zod, `jsonwebtoken`, `express-rate-limit`. Node >=22.12.

## Module layout

| Path | Responsibility |
|---|---|
| `src/index.ts` | Process entry: start server |
| `src/app.ts` | `createApp(options?)`: mount order = access policy |
| `src/config.ts` | Read and validate env (`port`, `databaseUrl`, `auth`); fail fast at import |
| `src/db/` | `pool.ts` (pg pool), `schema.ts`, `createDatabase.ts` (`npm run db:create`) |
| `src/errors/` | `AppError` |
| `src/middleware/` | `asyncHandler`, `errorHandler` (also `notFoundHandler`; malformed JSON -> 400) |
| `src/students/` | Controller, repository, routes, schema, service, types for students CRUD |
| `src/auth/` | `auth.service` (credential check, token issue/verify), `auth.middleware` (`requireAdmin`, `requireAdminForWrites`), `auth.controller` (login), `auth.routes` (`createAuthRouter` + limiter), `auth.schema`, `auth.types` |

## Access policy and mount order

Order in `createApp` is the policy:

```
express.json(1mb) -> GET /health -> /auth -> requireAdminForWrites -> /students -> notFoundHandler -> errorHandler
```

- `/health` and `/auth/*` sit above the guard, so the guard never applies to them.
- Guard: `GET`, `HEAD`, `OPTIONS` pass; any other method needs an admin token (deny by default).
- Unknown non-safe path: 401 without token, 404 with admin token.
- Body parsing runs first: malformed JSON returns 400 even without a token.

## Request status

| Request | Status | `WWW-Authenticate` |
|---|---|---|
| `GET`/`HEAD`/`OPTIONS` on `/students`, `GET /health` | as normal (public) | none |
| `POST /auth/login`, correct credentials | 200 | none |
| `POST /auth/login`, wrong credentials | 401 | `Bearer realm="student-api"` |
| `POST /auth/login`, invalid body | 400 | none |
| `POST /auth/login`, limit exceeded | 429 (`Retry-After`) | none |
| Write, no `Authorization` header or not Bearer | 401 | `Bearer realm="student-api"` |
| Write, invalid or expired token | 401 | `Bearer realm="student-api", error="invalid_token"` |
| Write, valid token, role is not `admin` | 403 | `Bearer realm="student-api", error="insufficient_scope"` |
| Write, valid admin token | as normal (201/200/204/400/404/409) | none |
| Malformed JSON, any route | 400 | none |

- 401 = not authenticated. 403 = authenticated, not admin. 429 = login rate limit.
- Error bodies carry only `error` (+ `details` for validation). Exact bodies: SPECS §5.

## Token

- JWT, HS256, signed with `JWT_SECRET`.
- Lifetime 1 h (`expiresIn` 3600). No refresh token.
- Claims: `sub` (`admin`), `role` (`admin`), `iss`, `aud` (both `student-api`), `exp` (plus `iat`).
- Verification pins the algorithm, checks `iss`, `aud`, and requires `exp`.

## Login rate limit

- 5 failed credential checks per 15 minutes per IP.
- Only 401 responses count; 200 and 400 do not.
- In memory, one limiter per `createApp()` instance; resets on restart.
- `trust proxy` is unset: `X-Forwarded-For` is ignored, so behind a proxy all clients share one bucket.

## Configuration

Read in `src/config.ts`; the process exits at startup if a rule fails. Auth key errors name the key, never the value (`PORT` errors echo the invalid port, which is not secret). Values belong in `.env` (git-ignored); `.env.example` lists the keys.

| Key | Rule |
|---|---|
| `PORT` | Integer 1-65535, default `3000` |
| `DATABASE_URL` | Required (PostgreSQL connection string) |
| `ADMIN_USERNAME` | Required, non-blank |
| `ADMIN_PASSWORD` | Required, non-blank |
| `JWT_SECRET` | Required, non-blank, at least 32 characters |

## Commands

| Command | Purpose |
|---|---|
| `npm install` | Install dependencies |
| `npm run db:create` | Create the database |
| `npm run dev` | Run with reload (`tsx watch`) |
| `npm test` | Run tests (`vitest run`) |
| `npm run typecheck` | Type-check `src` and tests |
| `npm run build` | Compile to `dist/` |

## Testing

- Vitest + supertest, files in `tests/`.
- No PostgreSQL needed: repository and pool are mocked.
- `vitest.config.ts` sets fake env values; `dotenv/config` is aliased to a stub, so the real `.env` is never read.
- Tests build apps with `createApp({ auth })` to inject auth config.

## Usage example

Log in, then send the token on writes. Placeholders only.

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"<ADMIN_USERNAME>","password":"<ADMIN_PASSWORD>"}'
# -> {"accessToken":"<token>","tokenType":"Bearer","expiresIn":3600}

curl -X POST http://localhost:3000/students \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{ ... student fields ... }'
```

Student fields: see `src/students/student.schema.ts`.
