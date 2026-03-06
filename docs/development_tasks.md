# Development Task Breakdown
## Chess Tournament Entry Platform — MVP Phase 1

> **Methodology:** Kanban / Sprint-style. Each task is sized as a day unit (1D ≈ 1 developer-day).
> **Prerequisite:** Architecture v2.2 approved. Prisma schema finalized. `.env.example` populated.

---

## Sprint 0 — Project Foundation *(3 days)*

| ID | Task | Size | Owner | Notes |
|---|---|---|---|---|
| S0-1 | Initialize monorepo (npm workspaces + Turborepo) | 0.5D | Lead | `apps/api`, `apps/worker`, `apps/web`, `packages/shared` |
| S0-2 | Write `prisma/schema.prisma` — all entities, enums, relations | 1D | Backend | Based on v2.2 ER diagram. Include all indexes. |
| S0-3 | Run `prisma migrate dev` — migration 001 (init schema) | 0.5D | Backend | Verify all tables created. Run `prisma studio` to inspect. |
| S0-4 | Write `prisma/seed.ts` — Super Admin account seed | 0.5D | Backend | Reads `ADMIN_EMAIL` + `ADMIN_INITIAL_PASSWORD` from env |
| S0-5 | Setup ESLint, Prettier, `tsconfig.base.json`, Husky pre-commit | 0.5D | Lead | Shared lint rules for all apps |

**Definition of Done:**
- `npx prisma migrate dev` succeeds on a fresh DB
- `npx prisma db seed` creates the admin account
- `npm run lint` passes across all apps

---

## Sprint 1 — Authentication & Organizer Onboarding *(4 days)*

| ID | Task | Size | Owner | Notes |
|---|---|---|---|---|
| S1-1 | `auth` module — JWT login endpoint | 1D | Backend | bcrypt verify, issue access + refresh tokens, httpOnly cookie |
| S1-2 | `auth` module — refresh + logout endpoints | 0.5D | Backend | `refresh_token_sessions` table lookup; revoke on logout |
| S1-3 | `RolesGuard` + `@Roles()` decorator | 0.5D | Backend | Used by all subsequent protected routes |
| S1-4 | `TenantMiddleware` + `@OrganizerOwnership()` guard | 0.5D | Backend | AsyncLocalStorage for `organizerId`; ownership guard returns 403 |
| S1-5 | `users` module — Organizer self-registration | 0.5D | Backend | Creates user + organizer record; status = PENDING_VERIFICATION |
| S1-6 | Unit tests — auth service (login, refresh, logout) | 1D | Backend | Mock Prisma; test happy path + invalid credentials + revoked token |

**Definition of Done:**
- `POST /auth/login` issues valid JWT
- `POST /auth/refresh` rotates token using httpOnly cookie
- `RolesGuard` returns 403 for wrong role
- Tenant middleware correctly scopes organizer queries

---

## Sprint 2 — Tournament Management *(5 days)*

| ID | Task | Size | Owner | Notes |
|---|---|---|---|---|
| S2-1 | `tournaments` module — CRUD endpoints | 1D | Backend | Create, list (organizer-scoped), get by ID, update (DRAFT only) |
| S2-2 | Tournament status machine — lifecycle transitions | 1D | Backend | DRAFT→PENDING_APPROVAL→APPROVED→ACTIVE→CLOSED, REJECTED, CANCELLED. Validate allowed transitions. |
| S2-3 | Categories — create/update/delete as child entities | 0.5D | Backend | Cascade delete on tournament delete |
| S2-4 | `admin` module — tournament approval/rejection endpoints | 0.5D | Backend | `PATCH /admin/tournaments/:id/status` → APPROVED or REJECTED |
| S2-5 | `admin` module — tournament cancellation (APPROVED or ACTIVE→CANCELLED) | 0.5D | Backend | Validate transition; write audit_log entry |
| S2-6 | Write `audit_log` entries on every status transition | 0.5D | Backend | old_value, new_value, performed_by |
| S2-7 | Unit tests — tournament service (status machine) | 1D | Backend | Test all valid + invalid transitions including CANCELLED |

**Definition of Done:**
- Organizer can create a tournament in DRAFT status
- Admin can approve, reject, or cancel
- Invalid transitions return `409 CONFLICT`
- Audit log row written on every transition

---

## Sprint 3 — Player Registration *(5 days)*

| ID | Task | Size | Owner | Notes |
|---|---|---|---|---|
| S3-1 | `registrations` module — registration endpoint skeleton | 0.5D | Backend | DTO validation (class-validator), route wiring |
| S3-2 | Age validation logic | 0.5D | Backend | Calculate age at `tournament.start_date`; check against `category.min_age`/`max_age` |
| S3-3 | Duplicate detection | 0.5D | Backend | Query `registrations` by `phone + tournament_id`; return 409 |
| S3-4 | **Phone rate limiting via Redis** | 0.5D | Backend | `rate:reg:{tournamentId}:{phone}` Redis key; INCR + EXPIRE; 3 attempts / 1 hour |
| S3-5 | **Seat locking via `SELECT FOR UPDATE`** | 1D | Backend | Wrap in `prisma.$transaction`; check `registered_count < max_seats`; decrement on cancel/expiry |
| S3-6 | `expires_at` field on PENDING_PAYMENT registrations | 0.5D | Backend | `NOW() + 2 hours` on INSERT |
| S3-7 | `GET /registrations/:entryNumber/status` — public status check | 0.5D | Backend | Returns status + tournament name only (no PII to unauthenticated caller) |
| S3-8 | Unit tests — registration service | 1D | Backend | Test age validation, duplicate, race condition (seat lock), phone rate limit |

**Definition of Done:**
- Concurrent registrations for the same last seat → exactly one succeeds
- Age mismatch → 400 with clear error
- 4th registration attempt from same phone → 429 Too Many Requests
- `expires_at` correctly set on all PENDING_PAYMENT registrations

---

## Sprint 4 — Payments *(4 days)*

| ID | Task | Size | Owner | Notes |
|---|---|---|---|---|
| S4-1 | `payments` module — Razorpay SDK wrapper service | 0.5D | Backend | Create order, fetch order status. Abstract SDK behind interface for testability. |
| S4-2 | `POST /tournaments/:id/categories/:catId/register` — create Razorpay order on registration | 0.5D | Backend | After successful registration INSERT, call Razorpay, return `{order_id, key_id, amount}` |
| S4-3 | **Webhook endpoint — raw body middleware** | 0.5D | Backend | `rawBody` buffer preserved before `express.json()`. Critical for HMAC verification. |
| S4-4 | **Webhook endpoint — HMAC-SHA256 verification** | 0.5D | Backend | `crypto.timingSafeEqual`; reject 400 on mismatch; log attempt |
| S4-5 | Webhook handler — payment state machine transitions | 0.5D | Backend | `payment.captured` → PAID + registration CONFIRMED; `payment.failed` → FAILED |
| S4-6 | Idempotency guard | 0.5D | Backend | Check `razorpay_payment_id` unique before processing; return 200 if already processed |
| S4-7 | Unit tests — payment service (HMAC verify, state machine) | 1D | Backend | Test valid signature, invalid signature, duplicate webhook, failure event |

**Definition of Done:**
- Invalid webhook signature → 400, no DB changes
- Duplicate webhook (same `payment_id`) → 200, no re-processing
- Payment confirmed → registration status = CONFIRMED, confirmed_at set

---

## Sprint 5 — Background Jobs *(4 days)*

| ID | Task | Size | Owner | Notes |
|---|---|---|---|---|
| S5-1 | BullMQ module setup — Redis connection, queue definitions, job name constants | 0.5D | Backend | Shared producer service; queue names as typed enum |
| S5-2 | Worker app bootstrap (`apps/worker`) — separate NestJS application | 0.5D | Backend | `worker.ts` entry point; imports only processors + dependencies |
| S5-3 | `PAYMENT_RECONCILE` processor — poll Razorpay for stuck PENDING payments | 1D | Backend | BullMQ cron every 15 min; update payment + registration; enqueue notification if resolved |
| S5-4 | **`PURGE_EXPIRED_REGISTRATIONS` processor — seat release** | 0.5D | Backend | BullMQ cron every 15 min; `expires_at < NOW() AND status = PENDING_PAYMENT`; `registered_count - 1` per cancelled seat in atomic transaction |
| S5-5 | Dead-letter queue setup — Sentry + Grafana alert on DLQ depth > 0 | 0.5D | DevOps | All payment + notification queues require DLQ |
| S5-6 | Unit tests — seat expiry processor (registered_count decremented) | 0.5D | Backend | Verify seat count decremented; verify status = CANCELLED |
| S5-7 | Integration test — full payment flow (register → webhook → confirm) | 0.5D | Backend | Supertest + local Postgres; mock Razorpay SDK |

**Definition of Done:**
- Expired PENDING_PAYMENT registrations → CANCELLED + seat released within 15 min
- Stuck PENDING payments reconciled by polling job
- DLQ alert fires correctly in Grafana

---

## Sprint 6 — Notifications & Reports *(3 days)*

| ID | Task | Size | Owner | Notes |
|---|---|---|---|---|
| S6-1 | `SEND_EMAIL` processor — SendGrid integration | 0.5D | Backend | Template-based; HTML email for REGISTRATION_CONFIRMED, TOURNAMENT_CANCELLED |
| S6-2 | Trigger notification jobs from payment webhook + tournament cancellation | 0.5D | Backend | Payment webhook → REGISTRATION_CONFIRMED; Admin cancel → TOURNAMENT_CANCELLED for each CONFIRMED registration |
| S6-3 | `GENERATE_EXPORT` processor — ExcelJS + R2 upload | 1D | Backend | Query CONFIRMED registrations; generate .xlsx with all required columns; upload to R2 at `/{organizer_id}/{tournament_id}/{job_id}.xlsx`; update `export_jobs` |
| S6-4 | `CLEANUP_EXPORT_FILES` processor — 30-day TTL enforcement | 0.5D | Backend | BullMQ cron daily 2 AM IST; delete R2 object; set `storage_key = NULL`, `status = EXPIRED` |
| S6-5 | `reports` module — export trigger + presigned URL endpoints | 0.5D | Backend | `POST /organizer/tournaments/:id/exports`; `GET /organizer/exports/:jobId` with 15-min signed URL |

**Definition of Done:**
- Registration confirmation email received within 30s of webhook processing
- Tournament cancellation email sent to all CONFIRMED registrations
- Excel export contains all required columns with correct data
- Export file inaccessible after 30 days (R2 object deleted)

---

## Sprint 7 — Admin & Observability *(3 days)*

| ID | Task | Size | Owner | Notes |
|---|---|---|---|---|
| S7-1 | `admin` module — organizer list + verification endpoint | 0.5D | Backend | `GET /admin/organizers`, `PATCH /admin/organizers/:id/verify` |
| S7-2 | `admin` module — **audit log endpoint** | 0.5D | Backend | `GET /admin/audit-logs` with `entity_type`, `performed_by`, `from`, `to` filters; cursor pagination |
| S7-3 | `admin` module — analytics endpoint | 0.5D | Backend | Aggregate queries: total tournaments, registrations, revenue, top categories |
| S7-4 | Pino structured logging setup | 0.5D | Backend | `nestjs-pino`; sensitive field redact config; JSON output for staging/prod |
| S7-5 | Sentry integration — API global exception filter + worker processor error hooks | 0.5D | DevOps | `@sentry/nestjs`; capture all unhandled exceptions with request context |
| S7-6 | Prometheus metrics endpoint (`/metrics`) | 0.5D | DevOps | `@willsoto/nestjs-prometheus`; HTTP request histogram, BullMQ gauges |

**Definition of Done:**
- Audit log returns filterable, paginated results for all admin actions
- Sentry captures all production exceptions with stack trace
- `/metrics` returns Prometheus-compatible metrics
- Log output is structured JSON with no sensitive fields

---

## Sprint 8 — Frontend MVP *(8 days)*

| ID | Task | Size | Owner | Notes |
|---|---|---|---|---|
| F8-1 | Shared API client (`lib/api.ts`) — typed fetch with auth header management | 0.5D | Frontend | Token refresh on 401; typed response with `ApiResponse<T>` |
| F8-2 | Public tournament listing page (`/`) | 1D | Frontend | Cards with category info, seat availability, registration deadline |
| F8-3 | Tournament detail page (`/tournaments/[id]`) | 0.5D | Frontend | Full details + category table with available seats |
| F8-4 | Player registration form (`/tournaments/[id]/register`) | 1.5D | Frontend | react-hook-form + zod; DOB picker; FIDE optional; category selector; age validation feedback |
| F8-5 | Razorpay checkout integration | 1D | Frontend | Load Razorpay JS SDK; open checkout with `{order_id, key, amount}`; handle success/failure callbacks |
| F8-6 | Registration confirmation page (`/registration/[entryNumber]`) | 0.5D | Frontend | Poll `GET /registrations/:entryNumber/status`; show CONFIRMED or PENDING message |
| F8-7 | Organizer login page + auth flow | 0.5D | Frontend | JWT stored in memory; refresh token via cookie; redirect on 401 |
| F8-8 | Organizer dashboard — tournament list + status badges | 0.5D | Frontend | |
| F8-9 | Organizer — create tournament form + multi-category | 1D | Frontend | Dynamic category add/remove; date pickers; submit to `POST /organizer/tournaments` |
| F8-10 | Organizer — registration list view + export button | 0.5D | Frontend | Table with filters; export button → poll for download URL |
| F8-11 | Admin dashboard — pending approval list + approve/reject actions | 0.5D | Frontend | |

---

## Sprint 9 — Infrastructure & Deployment *(3 days)*

| ID | Task | Size | Owner | Notes |
|---|---|---|---|---|
| I9-1 | Write `Dockerfile.api` + `Dockerfile.worker` (multi-stage) | 0.5D | DevOps | node:20-alpine; non-root user; health check |
| I9-2 | Write `docker-compose.prod.yml` — API, Worker, PgBouncer, Nginx | 0.5D | DevOps | Restart policies; resource limits |
| I9-3 | Write `docker-compose.dev.yml` — Postgres, Redis, MinIO | 0.5D | DevOps | Volume persistence; port mappings |
| I9-4 | GitHub Actions CI pipeline | 0.5D | DevOps | Lint + test + Docker build on PR |
| I9-5 | GitHub Actions CD pipeline — staging + production | 0.5D | DevOps | build/push → migrate → deploy; tag-gated production |
| I9-6 | Configure Cloudflare WAF rules (rate limit + webhook IP allowlist) | 0.5D | DevOps | Razorpay IP ranges allowlisted for `/payments/webhook` |

---

## Overall MVP Timeline

| Sprint | Focus | Duration | Cumulative |
|---|---|---|---|
| Sprint 0 | Foundation | 3 days | Week 1 |
| Sprint 1 | Auth + Organizer onboarding | 4 days | Week 2 |
| Sprint 2 | Tournament management | 5 days | Week 3 |
| Sprint 3 | Player registration | 5 days | Week 4 |
| Sprint 4 | Payments | 4 days | Week 5 |
| Sprint 5 | Background jobs | 4 days | Week 6 |
| Sprint 6 | Notifications + Reports | 3 days | Week 7 |
| Sprint 7 | Admin + Observability | 3 days | Week 7–8 |
| Sprint 8 | Frontend MVP | 8 days | Week 9–10 |
| Sprint 9 | Infrastructure | 3 days | Week 10 |
| **Total** | | **~42 developer-days** | **~10 weeks (1 dev)** |

> 10 weeks = 2 developers × 5 weeks, or 1 developer × 10 weeks.

---

## Pre-Launch Checklist

```
Security
[ ] All admin routes verified to return 403 for organizer tokens
[ ] Webhook HMAC verification tested with invalid signature
[ ] Rate limiting smoke-tested (3 registrations, 4th → 429)
[ ] No secrets in repository (git secrets scan)
[ ] Staging smoke test with live Razorpay test payment end-to-end

Infrastructure
[ ] Database backup verified (restore drill completed)
[ ] Sentry receiving test errors from staging
[ ] Grafana dashboard live with production metrics
[ ] DLQ alert firing correctly on test failure
[ ] Cloudflare WAF rules active

Functional
[ ] Full registration → payment → confirmation email flow verified
[ ] Tournament cancellation → all player emails sent
[ ] Organizer Excel export → correct fields, confirmed only
[ ] Admin audit log showing all test actions
[ ] Seat locking tested with concurrent registrations
```
