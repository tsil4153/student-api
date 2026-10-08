**Spec decisions: authentication (T2)**

**Scope and permissions**
1. Audience is admins. There is one admin, configured in env vars. There are no other roles and no per-admin permissions.
2. `POST`, `PUT` and `DELETE` on `/students` require a valid admin token.
3. `GET /students`, `GET /students/:id` and `/health` stay unauthenticated with unchanged responses.
4. Authenticated writes behave exactly as they do today.

**Login: `POST /auth/login`**
5. The request body is JSON `{ "username": string, "password": string }`.
6. Success returns `200` with `{ "token": string, "tokenType": "Bearer", "expiresIn": 3600 }`.
7. A missing field, a non-string value, or invalid JSON returns `400` in the existing validation error shape.
8. A well-formed body with a wrong username, a wrong password, or both returns `401` with the same generic message.
9. Username and password comparisons are constant-time. Both always run, so the response does not reveal which one failed.
10. `/auth/login` is exempt from the bearer check. Login `401`s need no `WWW-Authenticate` header.

**Token**
11. The token is signed with `HS256` using `JWT_SECRET`. It lasts 1 hour, with no refresh.
12. The subject is the admin username.
13. A token is valid only if all of these hold:
    - It has an `HS256` signature made with the current `JWT_SECRET`.
    - It has not expired.
    - Its subject equals the configured `ADMIN_USERNAME`.
14. Any other algorithm, including `none`, is rejected.
15. Changing `JWT_SECRET` or `ADMIN_USERNAME` invalidates all existing tokens. Clients must log in again.

**Write-route rejection**
16. The client sends `Authorization: Bearer <token>`.
17. These cases all return the same generic `401` in the existing `AppError` shape, with `WWW-Authenticate: Bearer`:
    - No token.
    - A malformed token.
    - A wrong-secret token.
    - An expired token.
    - A wrong-subject token.
    - A wrong algorithm.
18. The generic message does not say which check failed.
19. Authentication runs before body validation and before any student lookup. An unauthenticated request with an invalid body or a nonexistent ID gets `401`.

**Configuration**
20. `ADMIN_USERNAME`, `ADMIN_PASSWORD` (plaintext) and `JWT_SECRET` are read from env.
21. Startup fails with a clear config error naming the variable, never its value, in these cases:
    - A variable is missing, empty or whitespace-only.
    - `JWT_SECRET` is shorter than 32 characters.
22. `ADMIN_PASSWORD` has no minimum length in v1.
23. The secret and password are never logged or returned.

**Non-goals**
- Self-registration.
- Roles beyond admin.
- Refresh tokens.
- Rate limiting and lockout.
- Audit trail and logging of auth events.
- Password reset.
- Any UI.
- Admin management.
- Hashed password storage.
- HTTPS/TLS, which the deployment provides.
- CORS.
- Cookies.

**Tests that must exist**
- A valid login returns a token.
- Wrong username, wrong password and wrong both give the same `401`.
- A malformed login body gives `400`.
- Writes get `401` for each case in item 17.
- An unauthenticated invalid-body or nonexistent-ID request gets `401`.
- A valid token lets all three writes behave as today.
- The three read routes work with no token.
- Startup fails for each missing, empty or short config value in item 21.

**Risk tier:** T2, as you assigned.

**Unknowns and prototype marks:** None. The test approach and library choices belong to the Design session. The repository has no tests today.