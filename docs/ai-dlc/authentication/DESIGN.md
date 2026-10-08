---
id: DESIGN-authentication
title: Admin Authentication design
status: approved
approved_by: tsil4153
tier: T2
spec_id: SPEC-authentication
spec_version: 1
sources:
  - docs/ai-dlc/authentication/SPEC.md
  - docs/ai-dlc/authentication/design-decisions.md
---

# Admin Authentication design

## Impacted components

This is one application-component change within the existing Student API. No new service, datastore, or tier is introduced.

| Area | Evidence and proposed change |
| --- | --- |
| Application composition | Existing `src/app.ts` creates the Express app, installs global `express.json()`, mounts `/health` and `/students`, then installs not-found and error handlers. Replace global parsing with a shared `jsonBody` (`express.json({ limit: "1mb" })`) applied to routes, mount the new auth router at `/auth`, and accept `createApp({ auth })` so auth settings reach the auth service and middleware factory. Preserve health and unknown-path behavior. |
| Authentication endpoints and logic | New `src/auth/auth.routes.ts`, `auth.controller.ts`, `auth.schema.ts`, `auth.service.ts`, and `requireAdmin.ts`. These provide login validation and response, credential comparison, JWT signing/verification, and protected-route middleware. The auth configuration is supplied from the application composition rather than read independently by route handlers. |
| Student write routes | Existing `src/students/student.routes.ts` registers list, view, create, update, and delete routes. Add `requireAdmin` before `jsonBody` on create and update, and before the delete handler; leave list and view unchanged. Existing controller parsing in `src/students/student.controller.ts` and student operations in `src/students/student.service.ts` remain the behavior after middleware succeeds. |
| Configuration and startup | Existing `src/config.ts` loads dotenv and exports an import-time `config`; existing `src/index.ts` imports it before database setup and calls `createApp()` after `ensureSchema()`. Refactor configuration into pure `loadConfig(env)` plus `config = loadConfig(process.env)`, pass `config.auth` to `createApp`, and validate all three auth variables at load time. The existing import-time configuration failure occurs before `ensureSchema()`. |
| Error handling | Existing `src/middleware/errorHandler.ts` maps `ZodError` to the validation response and `AppError` to its existing status/message/details shape. Add a body-parser `SyntaxError` branch for malformed JSON with HTTP 400 and a fixed validation details payload. Keep `src/errors/AppError.ts` unchanged; `requireAdmin` sets `WWW-Authenticate: Bearer` on the response before forwarding the generic `AppError(401, ...)`. |
| Environment example | Existing `.env.example` lists `PORT` and `DATABASE_URL`. Add example admin username/password and an empty `JWT_SECRET` with a comment to generate a 32+ character value. |
| Build and test harness | Existing `package.json` has build/typecheck scripts but no test script or auth/JWT/test dependencies; existing `tsconfig.json` includes all of `src`. Add the selected `jsonwebtoken`, Vitest, and supertest dependencies (plus type packages as needed), an `npm test` script, and new `tsconfig.build.json` excluding `**/*.test.ts`; retain tests under `src` and keep the base typecheck config inclusive. |

## Integration contracts

- `POST /auth/login` is mounted by existing `src/app.ts` through new `src/auth/auth.routes.ts`. Its route uses `jsonBody` and the new Zod schema, but no bearer middleware. The controller delegates to the auth service and returns HTTP 200 with `{ token, tokenType: "Bearer", expiresIn: 3600 }` on success.
- The login schema requires string `username` and `password` fields. Schema failures and malformed JSON use HTTP 400 in the existing validation response shape. Well-formed bad credentials all use the same generic HTTP 401 response; login failures do not require a `WWW-Authenticate` header.
- The new auth service signs using `jsonwebtoken` and `HS256`, with only `sub`, `iat`, and `exp` claims; the subject is the configured admin username and expiry is one hour. Verification pins `algorithms: ["HS256"]`, checks expiry/signature, and explicitly compares the subject with the current configured username. No clock tolerance is configured.
- Credential verification SHA-256-hashes each provided and expected value, compares both digest pairs with `timingSafeEqual`, always runs both comparisons for a well-formed attempt, and combines the results. The wrong-username, wrong-password, and both-wrong cases share the same response.
- Existing write paths `POST /students`, `PUT /students/:id`, and `DELETE /students/:id` gain `requireAdmin`; create and update then pass through `jsonBody`. This order ensures auth rejection precedes body parsing/validation and the existing controller lookup/operation. Their post-auth success and failure behavior remains unchanged.
- Existing `GET /students`, `GET /students/:id`, and `GET /health` remain public. `notFoundHandler` remains after mounted routes so unmatched paths continue returning 404.
- `requireAdmin` rejects absent, malformed, invalid-signature, expired, wrong-subject, and non-HS256 credentials through one generic `AppError` 401. It sets `WWW-Authenticate: Bearer` before forwarding the error; the existing error handler serializes the normal AppError response.
- `loadConfig(env)` requires non-empty, non-whitespace `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `JWT_SECRET`; it preserves the original configured values after using trimming only for emptiness checks. A short `JWT_SECRET` is rejected. One startup error names every offending variable without including values.

## Data changes and migration

No database schema or persistent authentication records are added. The existing `src/db/schema.ts` and student tables remain unchanged. Authentication uses environment configuration and transient request credentials/tokens only; existing student records are changed only by authenticated use of current student operations. No migration or backfill is required.

## Error handling and idempotency

- Login validation and malformed JSON return HTTP 400 using `{ error: "Validation failed", details: ... }`; malformed JSON is mapped by the new body-parser `SyntaxError` branch in existing `src/middleware/errorHandler.ts`.
- Bad login credentials return a shared generic HTTP 401 without a required challenge header. Protected writes return a shared generic HTTP 401 AppError shape and `WWW-Authenticate: Bearer`, regardless of token failure reason.
- Authentication runs before JSON body parsing on create/update and before controller validation, student lookup, or mutation on all protected writes. Auth failures therefore take precedence over invalid bodies and missing students.
- Valid authenticated calls retain existing student-service idempotency and status behavior; authentication adds no retries, token refresh, or write deduplication.
- Startup configuration errors identify variable names only. Auth configuration, passwords, and signing secrets must not appear in logs or API responses.

## Observability

No authentication event logging or audit trail is added, consistent with the spec non-goals. Existing application startup/error logging remains; startup errors may name missing or invalid configuration keys, but must never include their configured values. Tests will spy on console output and API responses to guard against password or secret disclosure.

## Sequencing and compatibility

Implement in the selected decision order: (1) test harness and `tsconfig.build.json`; (2) pure `loadConfig` with tests; (3) auth service with tests; (4) login route and malformed-JSON handling; (5) `requireAdmin`, per-route JSON parsing, and student route wiring; (6) `.env.example` updates.

The change intentionally removes global JSON parsing. JSON parsing is retained for login and student create/update through the shared route middleware; reads and health remain unchanged. Malformed JSON on student writes changes from the current generic HTTP 500 to HTTP 400 only after authentication passes. Unauthenticated protected writes receive 401 before parse or validation errors. Authenticated student writes otherwise retain existing responses. Environment validation makes the three admin/JWT values mandatory at startup, so deployments must configure them before rollout.

## Rejected alternatives

- Keeping global `express.json()` was rejected because parsing could fail before authentication, violating auth-before-validation ordering.
- `jose` and hand-rolled HS256 were rejected in favor of `jsonwebtoken` with an explicit allowed-algorithm list.
- Mapping malformed JSON only on login was rejected; the error handler maps body-parser syntax errors generally, with the documented student-write 400 behavior change after auth.
- Putting `WWW-Authenticate` on `AppError` or adding it in `errorHandler` was rejected; the protected-route middleware sets the header on `res` before forwarding the error.
- Timing-based tests were rejected in favor of asserting that both constant-time comparison calls execute for each wrong-credential combination.
- Real-Postgres integration tests were rejected for this change; student service and pool are mocked in the Vitest/supertest suite.

## Test approach

Tests live beside source in `src` as `*.test.ts`; use Vitest and supertest. Mock `student.service` and the pool so the authentication suite does not require PostgreSQL. Every test group below maps to the spec acceptance criteria:

- New `src/auth/auth.service.test.ts`: successful token claims, algorithm and one-hour expiry; wrong-username, wrong-password and both-wrong generic response behavior; spy on the constant-time helper to assert two comparisons per attempt. Covers AC-1, AC-3, AC-5.
- New `src/auth/auth.routes.test.ts`: login without bearer credentials, malformed/missing/non-string login fields and invalid JSON, successful response shape, shared invalid-credential response, and absence of a required challenge header for login failures. Covers AC-1 through AC-4.
- New `src/auth/requireAdmin.test.ts`: missing/malformed tokens, bad signature, expiry, wrong subject, non-HS256 including `none`, and invalidation after configured secret or username changes; assert all protected-write rejections share a 401 body and Bearer challenge. Covers AC-6 and AC-7.
- New `src/students/student.routes.test.ts` (or equivalent app-level route tests): verify unauthenticated invalid-body and nonexistent-ID writes are rejected before validation/lookup; verify authenticated create/update/delete behavior and public reads/health. Covers AC-8 through AC-10.
- New `src/config.test.ts`: call `loadConfig` directly for each variable absent, empty, and whitespace-only; cover short JWT secret, accepted password without a minimum length, and errors that identify variable names but not values. Covers AC-11.
- New application-level secret disclosure test, colocated with the route tests: spy on console and inspect authentication responses after success and failure to ensure password and JWT secret are absent. Covers AC-12.
- The authentication suite and test inventory together must cover every preceding acceptance case, including each startup failure and each protected-write rejection. Covers AC-13.
- Build with the new `tsconfig.build.json` to exclude tests from emitted application code; `typecheck` continues to include test files through the base `tsconfig.json`.

## Risks and gaps

- Repository evidence: `jsonwebtoken`, Vitest, and supertest are not currently declared in `package.json`; dependency versions and corresponding type-package requirements must be selected when the implementation is approved. These are additions to the existing application component, not new components.
- Neither the spec nor decisions fixes the literal generic login/protected-write messages, or the exact fixed `details` payload for malformed JSON. The implementation must select stable non-revealing messages and a fixed payload consistent with the existing validation shape.
- The decisions specify required string fields but do not specify whether unknown login object properties are rejected or ignored. The login schema's unknown-key policy remains to be decided during implementation without weakening the required-field validation.
- The repository currently has no test files or test script. The selected mocking boundaries and test placement are proposed and need confirmation against the eventual test harness.
- `.env.example` currently has only `PORT` and `DATABASE_URL`; local and deployed environments will need the newly required auth variables before startup can succeed.