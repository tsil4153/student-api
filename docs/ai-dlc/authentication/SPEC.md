---
id: SPEC-authentication
title: Admin Authentication
status: approved
approved_by: tsil4153
tier: T2 
spec_version: 1
sources:
  - docs/ai-dlc/authentication/intake-decisions.md
  - docs/ai-dlc/authentication/spec-decisions.md
---

# Admin Authentication

## Goal

Require the configured administrator to authenticate before creating, updating, or deleting students, while keeping student reads and health checks unauthenticated.

## Non-goals

- Self-registration.
- Roles beyond admin or per-admin permissions.
- Refresh tokens.
- Rate limiting or lockout.
- Audit trail or logging of authentication events.
- Password reset.
- Any UI.
- Admin management.
- Hashed password storage.
- HTTPS/TLS, which the deployment provides.
- CORS.
- Cookies.

## Actors

- Admin: the single administrator configured through environment variables.
- Client: submits login credentials, calls student routes, or reads public endpoints.

## Assumptions

- The application continues to use the existing student routes and shared validation and `AppError` response formats.
- Authentication credentials and signing configuration are provided through the deployment environment; no admin account is stored in the database.
- Authenticated student writes retain their current behavior and responses.

## Functional requirements

1. The system shall provide `POST /auth/login`, accepting a JSON object with string `username` and `password` fields.
2. A successful login shall return HTTP `200` with `{ "token": string, "tokenType": "Bearer", "expiresIn": 3600 }`.
3. Login shall return HTTP `400` in the existing validation error shape when either required field is missing, either field is not a string, or the request body contains invalid JSON.
4. A well-formed login with an incorrect username, incorrect password, or both shall return the same generic HTTP `401` message. Username and password comparisons shall both run and use constant-time comparison; the response shall not reveal which credential was incorrect.
5. `POST /auth/login` shall be exempt from bearer-token authentication. Login `401` responses do not require a `WWW-Authenticate` header.
6. The system shall sign tokens with `HS256` using `JWT_SECRET`. Tokens shall expire after one hour, have no refresh mechanism, and use the configured admin username as their subject.
7. A token shall be valid only when its signature uses the current `JWT_SECRET` and `HS256`, it has not expired, and its subject equals the current `ADMIN_USERNAME`. All other algorithms, including `none`, shall be rejected. Changing `JWT_SECRET` or `ADMIN_USERNAME` shall invalidate existing tokens.
8. The client shall authenticate student writes with `Authorization: Bearer <token>`. The create, update, and delete routes shall require a valid admin token before body validation or student lookup.
9. Missing, malformed, wrong-secret, expired, wrong-subject, or wrong-algorithm bearer credentials on a protected write shall produce the same generic HTTP `401` in the existing `AppError` response shape, with `WWW-Authenticate: Bearer`. The message shall not identify the failed check.
10. Student listing, viewing an individual student, and `/health` shall remain unauthenticated and retain their existing responses.
11. The system shall read `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `JWT_SECRET` from environment variables. Startup shall fail with a clear configuration error naming (but never revealing the value of) any variable that is missing, empty, or whitespace-only. Startup shall also fail if `JWT_SECRET` is shorter than 32 characters. `ADMIN_PASSWORD` has no minimum length in v1.
12. The system shall never log or return `ADMIN_PASSWORD` or `JWT_SECRET`.
13. Automated tests shall cover successful login; each invalid-credential case; malformed login input; every protected-write token rejection case; authentication-before-validation-and-lookup ordering; successful authenticated writes; unauthenticated reads; and each required startup configuration failure.

## Authorization

- `POST /students`, `PUT /students/:id`, and `DELETE /students/:id` require a valid bearer token for the configured admin.
- `GET /students`, `GET /students/:id`, `GET /health`, and `POST /auth/login` do not require a bearer token.
- There are no other roles or per-admin permissions.
- Authentication rejection occurs before write-body validation and before looking up a student. Therefore unauthenticated writes return `401` even when the body is invalid or the requested student does not exist.

## Data touched

- Environment configuration: `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `JWT_SECRET`.
- Login request credentials and the signed token returned to the client.
- Existing student records through authenticated create, update, and delete operations; those operations otherwise behave as they do today.
- No persistent authentication data or refresh-token data.

## Error behavior

- Invalid or incomplete login input returns HTTP `400` using the existing validation error shape (`{ "error": "Validation failed", "details": ... }`).
- Well-formed but incorrect login credentials return HTTP `401` with one generic message and no required `WWW-Authenticate` header.
- Any invalid or missing bearer credential for a protected write returns HTTP `401` in the existing `AppError` shape and includes `WWW-Authenticate: Bearer`.
- Authentication rejection takes precedence over write validation errors and student-not-found outcomes.
- Invalid configuration prevents startup and identifies the variable by name without disclosing its value.

## Security constraints

- Use only `HS256` and reject all other token algorithms, including `none`.
- Validate token signature against the current `JWT_SECRET`, expiration, and subject against the current `ADMIN_USERNAME` on every protected write.
- Compare username and password in constant time, running both comparisons for each well-formed login attempt.
- Use the same generic login failure response for wrong username, wrong password, or both; use the same generic protected-write rejection for all token failures.
- Never log or return the configured password or signing secret.
- Tokens expire after one hour; there are no refresh tokens.

## Acceptance criteria

- **AC-1** Given configured valid admin credentials, when the client submits them as JSON to `POST /auth/login`, then the response is HTTP `200` with a token, `tokenType` equal to `Bearer`, and `expiresIn` equal to `3600`.
- **AC-2** Given a login body with a missing field, a non-string field, or invalid JSON, when it is submitted to `POST /auth/login`, then the response is HTTP `400` in the existing validation error shape.
- **AC-3** Given a well-formed login with a wrong username, wrong password, or both, when submitted, then each response is HTTP `401` with the same generic message; a test of the comparison path confirms both constant-time comparisons run for each attempt.
- **AC-4** Given a login request, when submitted without a bearer token, then login is processed normally; when credentials are incorrect, the `401` response does not require `WWW-Authenticate`.
- **AC-5** Given a valid login, when the issued token is inspected and used before expiry, then it has an `HS256` signature, the configured username as subject, and a one-hour expiration.
- **AC-6** Given a token with an expired time, invalid signature, non-`HS256` algorithm (including `none`), or subject other than the configured admin, when used on a protected write, then it is rejected; changing `JWT_SECRET` or `ADMIN_USERNAME` also causes previously issued tokens to be rejected.
- **AC-7** Given no token or a malformed, wrong-secret, expired, wrong-subject, or wrong-algorithm token, when sent to any protected write, then the response is the same generic HTTP `401` in the `AppError` shape and includes `WWW-Authenticate: Bearer`.
- **AC-8** Given an unauthenticated client, when it submits an invalid write body or targets a nonexistent student ID on a protected write, then the response is HTTP `401` before validation or student lookup affects the result.
- **AC-9** Given a valid admin token, when the client creates, updates, or deletes a student, then each write succeeds or fails according to the existing behavior and response for that operation.
- **AC-10** Given no bearer token, when the client lists students, views a student, or calls `/health`, then each route remains accessible and returns its existing response.
- **AC-11** Given each of `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `JWT_SECRET` is tested separately as absent, empty, and whitespace-only, or `JWT_SECRET` is shorter than 32 characters, when the application starts, then startup fails with a clear error naming the offending variable without revealing its value; `ADMIN_PASSWORD` is accepted without a minimum-length check.
- **AC-12** Given authentication succeeds or fails, when application logs or API responses are inspected, then neither `ADMIN_PASSWORD` nor `JWT_SECRET` appears.
- **AC-13** Given the automated test suite for authentication, when its test cases are inspected and run, then it covers AC-1 through AC-12, including each startup configuration case and each protected-write token rejection case.

## Unresolved

None. Authentication method, admin provisioning, permissions, v1 behavior, error outcomes, risk tier, and non-goals are specified by the decision lists.

## Decision trace

- R1-R5: Spec decisions 5-10 (login input, success and error behavior, constant-time comparisons, and login exemption).
- R6-R7: Spec decisions 11-15 (JWT algorithm, expiry, subject, validation rules, and invalidation on configuration changes).
- R8-R9: Intake V1 boundary; Spec decisions 2 and 16-19 (protected writes, bearer header, generic rejection, and validation/lookup precedence).
- R10: Intake V1 boundary; Spec decision 3 (public reads and health check with unchanged responses).
- R11-R12: Spec decisions 20-23 (environment configuration, startup validation, password-length rule, and secret handling).
- R13: Spec decisions Tests that must exist (required authentication and startup test coverage).
- Non-goals, tier, and actors: Intake Audience, V1 boundary, and Risk tier; Spec decisions 1 and Non-goals.