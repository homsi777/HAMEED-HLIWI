# Backend foundation

## Local development

1. Copy `.env.example` to `.env` and set local-only credentials.
2. `npm install`
3. `npm run db:generate` after a schema change.
4. `npm run db:migrate`
5. `npm run db:seed` (development only)
6. `npm run start:dev`

The seed script creates development-only users. Its password is the value of `SEED_ADMIN_PASSWORD`; it refuses to run when `NODE_ENV=production`.

Production uses a separate PostgreSQL database, a strong unique `JWT_SECRET`, TLS, a strong non-default bootstrap password, `COOKIE_SECURE=true`, and `TRUST_PROXY=true`. Run migrations before starting the service: `npm run db:migrate`.

The API base is `/api/v1`; health is `/api/v1/health`. The real-time namespace is `/realtime` and authenticated clients can emit `realtime.ping`.
