# MEMORY

Root causes, verified facts, what worked/failed. Keep short.

## Authentication: verified library facts (I2, installed versions)

Env: Node v24.21.0, jsonwebtoken 9.0.3, @types/jsonwebtoken 9.0.10, express-rate-limit 8.7.1, express 4.22.3, body-parser 1.20.8, vitest 5.0.4, vite 8.3.4, esbuild 0.28.2.

### jsonwebtoken (`node_modules/jsonwebtoken/verify.js`, `sign.js`, `node_modules/@types/jsonwebtoken/index.d.ts`)
- `SignOptions`: `algorithm`, `expiresIn` (`number | StringValue`), `subject`, `issuer`, `audience`. `VerifyOptions`: `algorithms`, `issuer`, `audience`. Names match SPECS.
- `verify` with a secret and an unsigned token throws `jwt signature is required` (verify.js L109). `none` is also not in `algorithms: ["HS256"]` → `invalid algorithm` (L145).
- `exp` is checked only when present (`typeof payload.exp !== 'undefined'`, L185). A signed token without `exp` is accepted → `verifyToken` must check `typeof exp === "number"` itself.
- `verify` returns `JwtPayload | string`: payload can be a string → check `typeof === "object"`.
- `sign` writes `iat` automatically for object payloads; `exp = iat + expiresIn`.

### express-rate-limit v8 (`node_modules/express-rate-limit/dist/index.cjs`, `index.d.ts`)
- Option names match SPECS: `windowMs`, `limit`, `skipSuccessfulRequests`, `requestWasSuccessful(req, res)`, `standardHeaders: "draft-8"`, `legacyHeaders`, `handler(req, res, next, options)`.
- Block rule: `totalHits > limit` (L1052). With `limit: 5`: hits 1-5 pass, hit 6 is blocked.
- `requestWasSuccessful` runs after the response `finish` event, async; the hit is then decremented (L1005-1050; `decrementKey` L1007). The blocked 429 itself has status ≠ 401 → counts as "success" → decremented → net count stays 5.
- Draft-8 headers: `RateLimit: "5-in-15min"; r=..; t=..` and `RateLimit-Policy: "5-in-15min"; q=5; w=900; pk=:..:` (setDraft8Headers ~L270-300, default identifier L814).
- `Retry-After` is set (seconds) when blocked if `standardHeaders` or `legacyHeaders` is truthy (L1053-1058) — before `handler` runs (L1052-1060).
- Default `handler` sends `config.message` with 429; custom `handler` must write the response itself.
- Validations run once per limiter and log with `console.error` (ConsoleLogger L227-230, getValidations L703-735). A request with an `X-Forwarded-For` header while `trust proxy` is false (Express default, `express/lib/application.js` L86) logs one `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` line. The message has no header value. Tests that spy on `console.error` in the spoofed-XFF case will see this one call.
- Create the limiter at app construction, not inside a request handler (`creationStack` validation, L631).

### body-parser (`node_modules/body-parser/lib/read.js`, `lib/types/json.js`)
- Parse failure: `createError(400, err, { body: str, type: "entity.parse.failed" })` (read.js L130-133, `type` at L132). `status` 400, `body` = raw text (never echo or log).
- Strict mode (default) rejects JSON whose first non-space char is not `{` or `[` (json.js L88) → scalar JSON (`null`, `"x"`, `1`) becomes `entity.parse.failed`.
- Empty body with JSON content-type parses to `{}` (json.js L79) → `loginSchema` gives 400 Validation failed.
- Other body-parser errors (`entity.too.large` 413, `charset.unsupported` 415) are not mapped by SPECS; they still reach the generic 500 branch (existing behavior).

### vitest / esbuild
- `npx tsx --version` → tsx v4.23.15, exit 0. `npx vitest --version` → vitest/5.0.4, exit 0. `@esbuild/win32-x64` binary runs (`--version` 0.28.2) although esbuild `postinstall` was blocked. No impact.
- vitest 5 is ESM (`"type": "module"`, engines `^22.12 || ^24 || >=26`). `test.env` exists in the resolved config type (`dist/chunks/config.d.QBNYCgFU.d.ts` L3711). NOT verified: loading `vitest.config.ts` in this CJS package (verify in T1; fallback `vitest.config.mts`).

## Authentication: test learnings (T1-T6)

- `vitest.config.ts` loads in this CJS package (vitest 5.0.4, no `.mts` needed). It prints a Vite warning (`configLoader: native` / ESM syntax in CJS file); harmless now, set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` to silence. Fix later: rename to `.mts`.
- `vitest.config.ts` `test.env` (fake values) is enough: `src/config` import never needs `.env`. Config tests need `vi.mock("dotenv/config")` + `vi.resetModules()` + `vi.stubEnv(key, undefined)` (undefined deletes the var).
- `jwt.sign` rejects explicit `undefined` options (`"issuer" must be a string`): drop keys instead of passing `undefined`. Expired token = payload `exp` in the past with no `expiresIn` (no sleep).
- Per-request client IP in HTTP tests: wrap `createApp()` in `http.createServer` and `Object.defineProperty(req.socket, "remoteAddress", ...)` per request; `req.ip` and the rate-limit key follow it (trust proxy off). Works with supertest.
- `OPTIONS /health` returns 404 (also before auth): `app.get` route is matched but `notFoundHandler` answers before Express builds the OPTIONS reply. `OPTIONS /students` returns 200. SPECS AC-13 "OPTIONS succeed" is true only for `/students`; `/health` OPTIONS is just not 401.
- Sequential supertest logins: `skipSuccessfulRequests` decrement lands before the next request; 178 tests ran 4x with no flake.
- Mutation check (scratch copy in `%TEMP%`, junctioned `node_modules`; repo `src` untouched): 7 of 7 mutants killed (no alg pin, no `exp` check, no role check, PUT treated safe, limiter counts successes, limit 6, credential short-circuit). Remove the junction with `cmd /c rmdir` BEFORE `Remove-Item -Recurse` (PS 5.1 would follow it into `node_modules`).
- No coverage provider installed (`@vitest/coverage-v8` absent): coverage not measured.
