# Authentication — Execution Plan (HOW)

Size: MEDIUM, one session, sequential. Specs (WHAT, contracts, ACs): [authentication-SPECS.md](authentication-SPECS.md). This plan cites spec sections/AC IDs and does not restate contracts.

## Read first

1. [authentication-SPECS.md](authentication-SPECS.md) — binding contracts §4, matrix §5, config §6, ACs §7.
2. [architecture-notes.md](../../agents/TEMP/authentication/architecture-notes.md) — rationale, flows, OWASP table.
3. [coding-flow-state.md](../../agents/TEMP/authentication/coding-flow-state.md) — approved decisions.
4. `src/**`, `package.json`, `tsconfig.json`, `.env.example`.

## Rules

- Phases: IMPLEMENTATION (code + `npm run typecheck` green) → TESTS → DOCS. Do not write tests in IMPLEMENTATION steps.
- After every step: `npm run typecheck` exits 0. Order below guarantees this.
- NEVER read or print `.env` values. Key names only.
- Only files listed per step change. `src/index.ts`, `src/students/*`, `src/errors/AppError.ts`, `tsconfig.json` stay unchanged.
- Spec/library mismatch found → update SPECS §9 + this plan, keep contract semantics; contract change → stop, ask orchestrator.
- Record verified library facts and root causes in `agents/MEMORY.md` (create if missing).

## HITL gates

| Gate | When | Approver decides |
|---|---|---|
| G0 | Before I1 | Approve SPECS + PLAN |
| G1 | After I1 (before I2) | Accept `npm install` result (lockfile diff, `npm audit` summary, vite peer) |
| G2 | After I8 | Accept implementation (diff review); user runs manual login with real `.env` creds |
| G3 | After T6 + D1 | Accept tests, coverage, docs; final sign-off |

## Steps

| # | Phase | Step | Files | Depends |
|---|---|---|---|---|
| I1 | IMPL | Dependencies + engines + test script | `package.json`, `package-lock.json` | G0 |
| I2 | IMPL | Verify unverified library facts | none (notes → `agents/MEMORY.md`) | G1 |
| I3 | IMPL | Auth config validation + example env | `src/config.ts`, `.env.example` | I2 |
| I4 | IMPL | Types, schema, service | `src/auth/auth.types.ts`, `auth.schema.ts`, `auth.service.ts` | I3 |
| I5 | IMPL | Middleware | `src/auth/auth.middleware.ts` | I4 |
| I6 | IMPL | Controller + router (limiter) | `src/auth/auth.controller.ts`, `auth.routes.ts` | I5 |
| I7 | IMPL | App wiring + JSON parse error | `src/app.ts`, `src/middleware/errorHandler.ts` | I6 |
| I8 | IMPL | Build + manual smoke | none | I7 |
| T1 | TESTS | Vitest config, test tsconfig, first test | `vitest.config.ts`, `tsconfig.test.json`, `package.json` (typecheck script), `tests/config.test.ts` | G2 |
| T2 | TESTS | Service unit tests | `tests/auth.service.test.ts` | T1 |
| T3 | TESTS | Login HTTP tests | `tests/auth.login.test.ts` | T1 |
| T4 | TESTS | Guard HTTP tests | `tests/auth.guard.test.ts` | T1 |
| T5 | TESTS | Error handler + log safety | `tests/errorHandler.test.ts` | T1 |
| T6 | TESTS | Full run + scope check | none | T2–T5 |
| D1 | DOCS | Project docs | `docs/CONTEXT.md`, `docs/ARCHITECTURE.md` | T6 |

### I1 — Dependencies
Do: versions/script/engines exactly per SPECS §6; `npm install`. Confirm `vite` peer of vitest resolved.
Verify: `npm ls jsonwebtoken express-rate-limit @types/jsonwebtoken vitest supertest @types/supertest vite`; `npm audit --omit=dev` (report only); `npm run typecheck`.

### I2 — Verify library facts (read `node_modules/*/README.md`, `*.d.ts`)
Confirm or correct, record each with file path:
- jsonwebtoken: `SignOptions` (`algorithm`, `expiresIn`, `subject`, `issuer`, `audience`), `VerifyOptions` (`algorithms`, `issuer`, `audience`); unsigned/`none` rejected when `algorithms` set; token without `exp` accepted (→ SPECS §4.1 extra `exp` check).
- express-rate-limit v8: `limit`, `windowMs`, `skipSuccessfulRequests`, `requestWasSuccessful` (custom predicate so only 401 counts), `standardHeaders: "draft-8"`, `legacyHeaders`, `handler` signature; `Retry-After` set on block; header names for draft-8; validation warnings that may `console.error` (must not include secrets).
- body-parser (via express 4.22): JSON parse error `type === "entity.parse.failed"`, `status 400`, `body` property holds raw text.
- vitest 5: `test.env` option; `vitest.config.ts` loads in a package without `"type":"module"` (fallback: `vitest.config.mts`).
Verify: notes exist in `agents/MEMORY.md`; SPECS §9 updated if anything differs.

### I3 — Config
Do: `config.auth` per SPECS §4.1 `config.auth` row; `.env.example` per §6 (empty values + generation comment).
Verify: `npm run typecheck`; `$env:JWT_SECRET='short'; npx tsx src/index.ts; $LASTEXITCODE; Remove-Item Env:JWT_SECRET` → non-zero, message names `JWT_SECRET`, no value. (Do not use empty strings in PowerShell: `$env:X=''` deletes the var and `dotenv` refills it from `.env`.)

### I4 — Types, schema, service
Do: SPECS §4 signatures + §4.1 rows `loginSchema`, `verifyCredentials`, `issueToken`, `verifyToken`. Augmentation lives in `auth.types.ts` (inside `src`, so tsc sees it).
Verify: `npm run typecheck`.

### I5 — Middleware
Do: SPECS §4.1 `requireAdmin`, `requireAdminForWrites`; headers/bodies exactly §5 A/B/C.
Verify: `npm run typecheck`; `Get-ChildItem src/auth -File | Select-String "console\."` → no match.

### I6 — Controller + router
Do: SPECS §4.1 `createAuthRouter`, limiter, login handler (wrap with existing `asyncHandler`). Limiter created inside `createAuthRouter`, not at module scope.
Verify: `npm run typecheck`.

### I7 — Wiring
Do: SPECS §3 mount order, `CreateAppOptions`; errorHandler branch per §4.1. Add one-line comment in `app.ts` that mount order is the access policy.
Verify: `npm run typecheck`; `npm run build`.

### I8 — Build + smoke (needs local Postgres; skip DB-dependent calls if unavailable and report)
Do: `npm run dev` (async), then:
- `GET /health` → 200; `GET /students` → 200 (AC-13).
- `POST /students` no token → 401 + `WWW-Authenticate` (AC-14).
- `POST /auth/login` with fake creds `{"username":"x","password":"y"}` → 401 (AC-6); malformed JSON → 400, terminal shows no body (AC-20).
- Valid-credential login: user performs at G2 (agent must not read `.env`).
Verify: responses captured with `curl.exe -i`; stop dev server after.

## Test plan (TESTS phase)

Traps:
- `src/config.ts` imports `dotenv/config`; `dotenv` fills only keys absent from `process.env`. Config tests: `vi.mock("dotenv/config", () => ({}))`, `vi.resetModules()`, `vi.stubEnv`, dynamic `import("../src/config")`. Otherwise real `.env` values leak in.
- `vitest.config.ts` `test.env` sets dummy values (SPECS §6) so importing `src/app` never reads real secrets.
- No Postgres: `vi.mock("../src/students/student.repository")` for write paths; `vi.mock("../src/db/pool")` with `query` stub for `/health`. `pg.Pool` connects lazily.
- Mint test tokens with `jsonwebtoken` using the injected `AuthConfig.jwtSecret`; craft `alg:none` by hand (base64url header/payload, empty signature).
- Use a fresh `createApp({ auth })` per rate-limit test (limiter is per instance). Distinct client IPs: `app.set` is not available to tests, so use a custom `req.ip` only if feasible; otherwise cover the spoofed `X-Forwarded-For` case (header must not change the bucket). Window expiry is library-owned; not tested.
- Guard bypass tests (AC-25): `POST /Students`, `/students/`, `//students`, method-override header; repository mock must have zero calls.
- Type-check tests: `npm run typecheck` includes `tsconfig.test.json`. If vitest types do not resolve under `moduleResolution: node`, override resolution in `tsconfig.test.json` only.
- Spy `console.error/warn/log` in HTTP suites; assert no call args contain test password, token, or `Bearer`.

| File | Covers |
|---|---|
| `tests/config.test.ts` | AC-1, AC-2 |
| `tests/auth.service.test.ts` | AC-5, AC-7 (correct/wrong/both wrong/length-mismatch/Unicode), AC-15 (`verifyToken` returns null per case) |
| `tests/auth.login.test.ts` | AC-4, AC-5, AC-6, AC-8, AC-9, AC-10, AC-11, AC-12, AC-18 |
| `tests/auth.guard.test.ts` | AC-13, AC-14, AC-15 (HTTP), AC-16, AC-17, AC-19, AC-22 (`createApp()` default path), AC-25 |
| `tests/errorHandler.test.ts` | AC-20, AC-21 |
| review (G2/G3) | AC-3, AC-7, AC-21, AC-22, AC-24 |
| manual | AC-1 (I3), AC-23 (T6) |

Test data: username/password boundary 256/257 chars; Unicode password (`"pässwörd✓"`); secret exactly 31/32 chars; tokens per AC-15 list; methods POST/PUT/DELETE/PATCH; paths `/students`, `/students/<uuid>`, `/nope`, `/health`, `/auth/nope`.

### T1–T5
Each: write file, `npx vitest run tests/<file>` green, `npm run typecheck` green. T1 creates `vitest.config.ts` together with `tests/config.test.ts` (`vitest run` with zero test files exits non-zero).

### T6 — Full run + scope
Verify: `npm test` exit 0; `npm run typecheck` exit 0; `git status --porcelain` lists only files named in this plan (+ `agents/MEMORY.md`, `plans/authentication/*`); `git diff -- src/index.ts src/students src/errors tsconfig.json` empty.

### D1 — Docs
Do: `docs/CONTEXT.md` (business purpose, public vs admin behavior, out-of-scope list); `docs/ARCHITECTURE.md` (module layout, mount order/policy, token + limiter facts, env keys, run: `npm install`, `npm run db:create`, `npm run dev`, `npm test`; login + Bearer usage example with placeholder creds). No README exists — do not create one. Link to SPECS for contracts, do not copy.
Verify: files exist; contain no secret values (`Select-String -Path docs/*.md -Pattern "JWT_SECRET="` shows placeholders only).

## Done when

- AC-1..AC-24 each have evidence (test name, review note, or command output) in the G3 report.
- `npm run typecheck` and `npm test` exit 0 without Postgres.
- No `.env` value appears in code, tests, docs, logs, or chat output.

## Checklist

- [ ] G0 approved
- [ ] I1 deps installed, lockfile updated, audit summary reported, G1 approved
- [ ] I2 library facts verified and recorded; SPECS §9 updated if needed
- [ ] I3–I7 implemented; typecheck green after each
- [ ] I8 smoke done (or DB-unavailable noted); G2 approved incl. user's real-cred login
- [ ] T1–T5 written; each file green alone
- [ ] T6 full suite green; scope check clean
- [ ] Every AC mapped to evidence
- [ ] No `console.*` in `src/auth`; no secrets in logs/bodies (AC-21)
- [ ] Mount-order comment present in `app.ts`
- [ ] D1 docs written; no README created
- [ ] `agents/MEMORY.md` updated with verified facts / root causes
- [ ] G3 approved
