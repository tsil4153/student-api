# coding-flow state: authentication

Size: MEDIUM. Flow: coding-flow. Current phase: 2 (design).

## Request (verbatim)
Build authentication and authorization for the endpoints. Only admins can make changes to the database. All GET endpoints and health endpoint work without auth. No admin creation, password reset, etc. Just login using credentials in .env and use the generated token for other endpoints.

## Decisions (user-approved via HITL Q&A)
- Token: JWT, signed with JWT_SECRET, lifetime 1 hour, no refresh.
- Credentials: ADMIN_USERNAME / ADMIN_PASSWORD plaintext in .env, timing-safe compare.
- Login: POST /auth/login -> { accessToken, tokenType, expiresIn }.
- Rate limit login: 5 attempts / 15 min / IP.
- Startup: fail fast if ADMIN_USERNAME, ADMIN_PASSWORD or JWT_SECRET missing, or JWT_SECRET < 32 chars.
- Public: GET /health, GET /students, GET /students/:id. Protected (admin): POST, PUT, DELETE /students.
- Tests: add vitest + supertest.
- Old docs/ai-dlc/authentication drafts: ignore.
- Design Q&A: raise engines.node to >=22.12 (vitest 5); rate limit counts only failed logins (skipSuccessfulRequests); no reverse proxy (trust proxy unset); JWT sub fixed "admin"; include malformed-JSON fix (400, no body logging).

## Facts
- Stack: Express 4, zod, pg, tsx, TypeScript. Errors via AppError + errorHandler. No test framework.
- .env already has ADMIN_USERNAME, ADMIN_PASSWORD, JWT_SECRET (values not read). .env.example lacks them.

## Phase log
- 0 prerequisites: done
- 1 discovery: done (inline, MEDIUM)
- 2 design: done -> architecture-notes.md (Option B: global safe-method guard)
- 3 user_review_design: APPROVED ("Approve, the design was reviewed")
- 4 tech_plan: done -> plans/authentication/authentication-SPECS.md + authentication-PLAN.md
- 5 review_plan: done (reviewer: approve with changes; 6 findings applied; CORS preflight out of scope)
- 6 user_review_plan: APPROVED ("Approve, the plan and specs were reviewed") = gate G0
- 7 implementation: I1-I7 done; G1 APPROVED ("Yes, I accept the install result")
- 8 review_code: done (reviewer: approve with changes; only missing tests/docs + doc nit, fixed SPECS §9; limiter concurrency = accepted limitation)
- 9 impl_validation/I8 smoke: PASS vs real server (port 3101, stopped). Valid-credential login left to user.
- 10 user_review_impl (G2): APPROVED ("Yes, I approve the implementation"); user manual real-cred login result not reported
- 11 tests: done (187 tests, 5 files, mutation checks 11 mutants caught); 12 review_tests: done (fixes applied)
- D1 docs: done (docs/CONTEXT.md, docs/ARCHITECTURE.md)
- 13 final_validation: PASS with notes (docs PORT-error wording fixed); G3 waiting for user
