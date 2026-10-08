The frontier is empty. This is the Design decision list for you to confirm or correct.

**Design decisions: authentication (T2)**

**Request pipeline**
1. Remove the global `express.json()`. Export a shared `jsonBody` (`express.json({ limit: "1mb" })`) and apply it per route.
2. `POST /students` and `PUT /students/:id` use `requireAdmin, jsonBody, handler`. `DELETE /students/:id` uses `requireAdmin` only. `POST /auth/login` uses `jsonBody` only. Reads and `/health` are unchanged. Unknown paths still return `404`.
3. `requireAdmin` sets `WWW-Authenticate: Bearer` on `res`, then calls `next(new AppError(401, <generic message>))`. `AppError` is unchanged.
4. `errorHandler` gets a body-parser `SyntaxError` branch. It returns `400` with `{ error: "Validation failed", details: <fixed payload> }`. You accepted that malformed JSON on student writes changes from `500` to `400`, after auth passes.

**Components**
5. New `src/auth/` folder with `auth.routes.ts`, `auth.controller.ts`, `auth.schema.ts` (zod login body), `auth.service.ts` (credential check and token sign/verify), and `requireAdmin.ts`.
6. `app.ts` mounts `/auth`. `student.routes.ts` adds `requireAdmin` to the three writes.
7. `createApp({ auth })` passes the auth config to the service and middleware factory. `index.ts` passes `config.auth`.

**Token and credentials**
8. Use `jsonwebtoken` with `algorithms: ["HS256"]` pinned on verify and an explicit subject check against `ADMIN_USERNAME`.
9. Claims are only `sub`, `iat` and `exp` (3600s). There is no clock-tolerance setting.
10. `verifyCredentials(input, expected)` SHA-256-hashes each side, compares with `timingSafeEqual`, runs both comparisons always, then combines the results.

**Configuration**
11. `loadConfig(env)` is a pure function. `config = loadConfig(process.env)` is kept. The trimmed value is used for the whitespace check only, and the stored value is not altered.
12. One error lists all offending variable names and never their values. The `JWT_SECRET` minimum is 32 characters.
13. The import-time throw means config fails before `ensureSchema()`.
14. `.env.example` gets `ADMIN_USERNAME=admin`, `ADMIN_PASSWORD=change-me`, and an empty `JWT_SECRET=` with a comment to generate 32+ random characters. There is no README to update.

**Tests**
15. Use Vitest and `supertest`, with `*.test.ts` files beside the code in `src`, and add an `npm test` script.
16. `student.service` and `pool` are mocked with `vi.mock`, so no database is needed. Real-Postgres tests are out of scope.
17. `build` uses a new `tsconfig.build.json` that excludes `**/*.test.ts`. `typecheck` keeps the base config.
18. Config tests call `loadConfig` directly for each absent, empty, whitespace-only and short case.
19. The constant-time test spies on the comparison helper and asserts two calls for each wrong-credential combination. There are no timing measurements.
20. Token expiry tests use fake timers.
21. A `console` spy test asserts the secret and password never appear in logs or responses.

**Sequencing**
22. (1) Test harness and `tsconfig.build.json`. (2) `loadConfig` with tests. (3) Auth service with tests. (4) Login route and the `errorHandler` branch. (5) `requireAdmin` and route wiring with per-route `jsonBody`. (6) `.env.example`.

**Rejected alternatives**
- Global `express.json()` left in place (breaks auth-before-validation).
- `jose` and hand-rolled HS256.
- Mapping parse errors for login only.
- Putting `WWW-Authenticate` on `AppError` or in `errorHandler`.
- Timing-based tests.
- Real-Postgres integration tests.

**Unknowns and prototype marks:** None.