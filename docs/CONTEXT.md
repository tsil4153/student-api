# Student API — Context

## Purpose

HTTP API to manage student records (create, read, update, delete). Data lives in PostgreSQL.

## Access model

| Who | Can do |
|---|---|
| Anyone (no login) | Read students (list, get by id), check `/health` |
| Admin (logged in) | Everything above, plus create, update, delete students |

- A write request without a valid admin token is rejected.
- Read requests and `/health` never need a token.

## Admin login

- One admin only. Username and password come from environment configuration.
- No user store, no admin creation, no registration.
- The admin logs in with those credentials and receives a short-lived token.
- The token is sent with every write request.
- The service refuses to start if the admin credentials or the token signing secret are missing or invalid.

## Out of scope

- Admin creation or management
- Password reset
- Token refresh and token revocation
- Roles other than admin
- HTTPS termination and reverse-proxy setup
- Password-strength policy

## Accepted limitations

- No token revocation. To invalidate all issued tokens, rotate `JWT_SECRET` and restart.
- Login rate limit is kept in memory: it resets on restart and is per app instance.
- Under a burst of simultaneous successful logins, a brief 429 can occur.

## Target state

- Reads and `/health` stay open.
- All data changes require the admin token.
- Details: [ARCHITECTURE.md](ARCHITECTURE.md).
