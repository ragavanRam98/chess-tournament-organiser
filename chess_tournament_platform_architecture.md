# Chess Tournament Entry Platform

### Full Architecture & Technical Blueprint

> **Owner:** Easy Chess Academy
> **Version:** 2.2 — Final Implementation Baseline
> **Status:** Approved for Development

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [User Roles & Permissions](#2-user-roles--permissions)
3. [C4 Architecture Diagrams](#3-c4-architecture-diagrams)
4. [Technology Stack](#4-technology-stack)
5. [Backend Module Architecture](#5-backend-module-architecture)
6. [Database Design](#6-database-design)
7. [Sequence Diagrams](#7-sequence-diagrams)
8. [Payment Architecture](#8-payment-architecture)
9. [Background Job Architecture](#9-background-job-architecture)
10. [Infrastructure Architecture](#10-infrastructure-architecture)
11. [Multi-Tenancy Design](#11-multi-tenancy-design)
12. [Security Architecture](#12-security-architecture)
13. [API Design Reference](#13-api-design-reference)
14. [Scaling Strategy](#14-scaling-strategy)
15. [Development Roadmap](#15-development-roadmap)
16. [Open Decisions](#16-open-decisions)
17. [Observability Architecture](#17-observability-architecture)
18. [Backup Strategy](#18-backup-strategy)
19. [CI/CD Pipeline](#19-cicd-pipeline)
20. [Environment Topology](#20-environment-topology)

---

## Changelog

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-03-05 | Initial product vision document |
| 2.0 | 2026-03-05 | Full technical rewrite — C4 diagrams, ER schema, sequence diagrams, infrastructure, API design |
| 2.1 | 2026-03-05 | Added observability, backup strategy, CI/CD pipeline, environment topology |
| **2.2** | **2026-03-06** | **CANCELLED tournament status; explicit seat release on expiry; export 30-day lifecycle; admin audit log endpoint; phone-based registration rate limiting** |

---

## 1. System Overview

The Chess Tournament Entry Platform is a **multi-tenant SaaS platform** providing centralized digital infrastructure for chess tournament management. It replaces manual workflows (WhatsApp registrations, Google Forms, Excel tracking, manual payment verification) with a fully automated, auditable online system.

### Problem → Solution

| Current State | Platform Solution |
|---|---|
| WhatsApp registrations | Online registration forms with age + duplicate validation |
| Google Forms | Structured registration with category enforcement |
| Manual Excel tracking | Real-time dashboard + async Excel/CSV export |
| Manual payment verification | Razorpay webhook-verified automated confirmation |
| Per-tournament manual comms | Automated email notifications |

### Initial Scale Targets

| Metric | Initial | Growth Target |
|---|---|---|
| Academies (Organizers) | 50 | 500+ |
| Tournaments per year | 200 | 1,000+ |
| Players per tournament | 100–500 | 1,000+ |
| Registrations per year | 50,000 | 500,000+ |

---

## 2. User Roles & Permissions

| Capability | Player | Organizer | Super Admin |
|---|---|---|---|
| View public tournaments | ✅ | ✅ | ✅ |
| Register for a tournament | ✅ | ❌ | ❌ |
| Pay entry fee | ✅ | ❌ | ❌ |
| Create tournament | ❌ | ✅ | ✅ |
| Edit own tournament | ❌ | ✅ | ✅ |
| View own registrations | ❌ | ✅ | ✅ |
| Export entry reports | ❌ | ✅ | ✅ |
| Approve / reject / cancel tournaments | ❌ | ❌ | ✅ |
| Verify organizers | ❌ | ❌ | ✅ |
| View platform analytics | ❌ | ❌ | ✅ |
| View audit logs | ❌ | ❌ | ✅ |

**Role Assignment Rules:**
- **Super Admin**: Seeded at deployment. Not self-registerable.
- **Organizers**: Self-register → `PENDING_VERIFICATION`. Super Admin manually activates.
- **Players**: No account required for MVP. Registration is form-based.

---

## 3. C4 Architecture Diagrams

### Level 1 — System Context

```mermaid
C4Context
    title Chess Tournament Entry Platform — System Context

    Person(player, "Player / Parent", "Discovers tournaments and registers online")
    Person(organizer, "Organizer", "Chess academy that runs tournaments")
    Person(superadmin, "Super Admin", "Easy Chess Academy platform operator")

    System(platform, "Chess Tournament Platform", "Central system for tournament creation, player registration, payments, and reporting")

    System_Ext(razorpay, "Razorpay", "Payment gateway for online entry fee collection")
    System_Ext(email, "Email Service (SendGrid / SES)", "Transactional email delivery")
    System_Ext(s3, "Object Storage (Cloudflare R2)", "Excel/CSV exports and tournament assets")
    System_Ext(cdn, "Cloudflare CDN", "Edge caching and DDoS protection")

    Rel(player, platform, "Registers, pays entry fee", "HTTPS")
    Rel(organizer, platform, "Creates tournaments, exports entries", "HTTPS")
    Rel(superadmin, platform, "Approves/cancels tournaments, manages platform", "HTTPS")
    Rel(platform, razorpay, "Creates payment orders, verifies webhooks", "HTTPS / Webhook")
    Rel(platform, email, "Sends confirmation emails", "API")
    Rel(platform, s3, "Stores and retrieves exports", "S3 API")
    Rel(cdn, platform, "Routes and caches traffic", "HTTPS")
```

### Level 2 — Container Diagram

```mermaid
C4Container
    title Chess Tournament Entry Platform — Container Diagram

    Person(player, "Player / Parent")
    Person(organizer, "Organizer")
    Person(superadmin, "Super Admin")

    System_Boundary(platform, "Chess Tournament Entry Platform") {
        Container(webapp, "Web Application", "Next.js / TypeScript", "Tournament discovery, player registration, organizer dashboard, admin panel")
        Container(api, "API Server", "NestJS / Node.js / TypeScript", "REST API: auth, tournaments, registrations, payments, exports, admin")
        Container(worker, "Background Worker", "NestJS / BullMQ", "Async: Excel generation, emails, payment reconciliation, seat expiry release")
        ContainerDb(postgres, "PostgreSQL", "Managed Postgres", "Users, tournaments, registrations, payments, audit_log")
        ContainerDb(redis, "Redis", "Redis 7+", "BullMQ job queue + response cache + rate limit counters")
        Container(storage, "Object Storage", "Cloudflare R2", "Generated exports (30-day TTL), tournament posters")
    }

    System_Ext(razorpay, "Razorpay")
    System_Ext(email, "Email Service")
    System_Ext(cdn, "Cloudflare CDN")

    Rel(player, cdn, "Accesses platform", "HTTPS")
    Rel(organizer, cdn, "Accesses platform", "HTTPS")
    Rel(superadmin, cdn, "Accesses admin panel", "HTTPS")
    Rel(cdn, webapp, "Serves frontend", "HTTPS")
    Rel(cdn, api, "Routes API requests", "HTTPS")
    Rel(webapp, api, "REST API calls", "HTTPS / JSON")
    Rel(api, postgres, "Reads / writes data", "TCP / Prisma ORM")
    Rel(api, redis, "Enqueues jobs, reads cache, rate limit checks", "TCP")
    Rel(api, razorpay, "Creates payment orders", "HTTPS")
    Rel(razorpay, api, "Payment webhooks (HMAC signed)", "HTTPS POST")
    Rel(worker, postgres, "Reads registration + payment data", "TCP / Prisma ORM")
    Rel(worker, redis, "Consumes BullMQ jobs", "TCP")
    Rel(worker, storage, "Uploads generated files", "S3 API")
    Rel(worker, email, "Sends transactional emails", "API")
    Rel(webapp, storage, "Downloads exports via presigned URL", "HTTPS")
```

### Level 3 — Backend API Component Diagram

```mermaid
C4Component
    title API Server — Component Diagram (NestJS Modules)

    Container_Boundary(api, "API Server (NestJS)") {
        Component(auth_mod, "Auth Module", "NestJS Module", "JWT login, token refresh, role guards")
        Component(user_mod, "Users Module", "NestJS Module", "Organizer accounts, admin seeding, verification")
        Component(tournament_mod, "Tournaments Module", "NestJS Module", "CRUD, lifecycle state machine, CANCELLED status handling")
        Component(registration_mod, "Registrations Module", "NestJS Module", "Form processing, age validation, duplicate check, phone rate limiting, SELECT FOR UPDATE seat locking")
        Component(payment_mod, "Payments Module", "NestJS Module", "Razorpay orders, HMAC webhook verification, state machine, reconciliation")
        Component(reports_mod, "Reports Module", "NestJS Module", "Export job trigger, presigned download URLs")
        Component(notification_mod, "Notifications Module", "NestJS Module", "Email dispatch, tournament cancellation notifications")
        Component(admin_mod, "Admin Module", "NestJS Module", "Approval, rejection, cancellation, audit log API, analytics")
        Component(queue_mod, "Queue Module", "BullMQ / Redis", "Shared BullMQ producer for all modules")
    }

    ContainerDb(postgres, "PostgreSQL")
    ContainerDb(redis, "Redis")

    Rel(auth_mod, postgres, "Validates credentials")
    Rel(tournament_mod, postgres, "Tournament + category CRUD")
    Rel(registration_mod, postgres, "Registrations with SELECT FOR UPDATE")
    Rel(registration_mod, redis, "Phone rate limit counters")
    Rel(payment_mod, postgres, "Payment state transitions")
    Rel(admin_mod, postgres, "Cross-tenant reads + audit_log queries")
    Rel(reports_mod, queue_mod, "Enqueues export jobs")
    Rel(notification_mod, queue_mod, "Enqueues notification jobs")
    Rel(queue_mod, redis, "Publishes to BullMQ queues")
```

---

## 4. Technology Stack

### Frontend

| Concern | Technology | Rationale |
|---|---|---|
| Framework | Next.js 14+ (App Router) | SSR for tournament discovery SEO |
| Language | TypeScript | End-to-end type safety |
| Styling | TailwindCSS | Rapid UI development |
| Server state | TanStack Query (React Query) | Cache + optimistic updates |
| Forms | react-hook-form + zod | Type-safe validation matching backend schemas |
| Hosting | Vercel | Zero-config Next.js deployment |

### Backend

| Concern | Technology | Rationale |
|---|---|---|
| Framework | NestJS 10+ | DI container enables clean modular monolith |
| Language | TypeScript | Shared types with frontend |
| ORM | Prisma 5+ | Schema-first, type-safe DB client |
| Connection pooling | PgBouncer (transaction mode) | Prevents `max_connections` exhaustion on multiple replicas |
| API style | REST (JSON) | Appropriate for this domain and scale |
| Auth | Passport.js JWT strategy | NestJS-native, role guards |
| Validation | class-validator + class-transformer | DTO-level input validation on all endpoints |

### Data Layer

| Concern | Technology | Rationale |
|---|---|---|
| Primary DB | PostgreSQL 15+ | ACID, referential integrity, row locking for seat management |
| Cache / Queue | Redis 7+ | BullMQ queues, response caching, rate limit counters |
| Object storage | Cloudflare R2 | Zero egress fees, S3-compatible, CDN-native |

---

## 5. Backend Module Architecture

### Module Dependency Graph

```mermaid
graph TD
    AuthMod["Auth Module\n(JWT, Guards)"]
    UserMod["Users Module\n(Organizer accounts)"]
    TournMod["Tournaments Module\n(CRUD, Lifecycle, Cancellation)"]
    CatMod["Categories Module\n(seat limits, age bounds)"]
    RegMod["Registrations Module\n(form, seat locking, phone rate limit)"]
    PayMod["Payments Module\n(Razorpay, Webhooks, Reconciliation)"]
    ReportMod["Reports Module\n(Export trigger + signed URL)"]
    NotifMod["Notifications Module\n(Email dispatch)"]
    AdminMod["Admin Module\n(Approval, Cancellation, Audit Logs)"]
    QueueMod["Queue Module\n(BullMQ producers)"]
    WorkerMod["Worker Process\n(Separate Docker container)"]

    AuthMod --> UserMod
    UserMod --> TournMod
    TournMod --> CatMod
    CatMod --> RegMod
    RegMod --> PayMod
    PayMod --> NotifMod
    RegMod --> NotifMod
    ReportMod --> QueueMod
    NotifMod --> QueueMod
    QueueMod --> WorkerMod
    AdminMod --> TournMod
    AdminMod --> UserMod
```

### Key Module Responsibilities

#### `tournaments`
- Tournament lifecycle (see §6 state diagram)
- Admin can transition: `APPROVED → CANCELLED` or `ACTIVE → CANCELLED` with a `cancellation_reason`
- On `CANCELLED`: all `CONFIRMED` registrations are fetched and notification jobs enqueued; refunds handled manually by admin via Razorpay dashboard

#### `registrations`
- Age validation against category `min_age` / `max_age`
- Duplicate detection: same phone + `tournament_id` → `409 Conflict`
- **Phone-based rate limiting** (new in v2.2): max 3 attempts per phone per tournament per hour, evaluated before DB seat check via Redis counter
- **Seat locking**: `SELECT ... FOR UPDATE` on the category row inside a Prisma `$transaction`
- `expires_at = NOW() + 2 hours` set on every `PENDING_PAYMENT` registration

#### `payments`
- Creates Razorpay payment orders
- Validates HMAC-SHA256 on raw webhook body
- Idempotency guard: unique constraint on `razorpay_payment_id`
- Triggers registration `CONFIRMED` on successful webhook
- Reconciliation scheduled job (every 15 min): polls Razorpay for orders `PENDING > 30 min`

#### `admin`
- Approval, rejection, and cancellation of tournaments (with `audit_log` insert on every action)
- Organizer verification (`PENDING_VERIFICATION → ACTIVE`)
- Audit log query API (`GET /api/v1/admin/audit-logs`) with filter support
- Platform-wide analytics

---

## 6. Database Design

### Entity-Relationship Diagram

```mermaid
erDiagram
    USERS {
        uuid id PK
        varchar email UK
        varchar password_hash
        varchar role "SUPER_ADMIN | ORGANIZER"
        varchar status "PENDING_VERIFICATION | ACTIVE | SUSPENDED"
        timestamptz created_at
        timestamptz updated_at
    }

    ORGANIZERS {
        uuid id PK
        uuid user_id FK
        varchar academy_name
        varchar contact_phone
        varchar city
        varchar state
        text description
        timestamptz verified_at
        uuid verified_by FK
    }

    TOURNAMENTS {
        uuid id PK
        uuid organizer_id FK
        varchar title
        text description
        varchar city
        varchar venue
        date start_date
        date end_date
        date registration_deadline
        varchar status "DRAFT|PENDING_APPROVAL|APPROVED|ACTIVE|CLOSED|REJECTED|CANCELLED"
        text rejection_reason
        text cancellation_reason
        timestamptz approved_at
        uuid approved_by FK
        timestamptz cancelled_at
        uuid cancelled_by FK
        timestamptz created_at
        timestamptz updated_at
    }

    CATEGORIES {
        uuid id PK
        uuid tournament_id FK
        varchar name "U10|U14|U18|Open"
        int min_age
        int max_age
        integer entry_fee_paise
        int max_seats
        int registered_count
        timestamptz created_at
    }

    REGISTRATIONS {
        uuid id PK
        uuid tournament_id FK
        uuid category_id FK
        uuid player_user_id FK "nullable — Phase 2 player accounts"
        varchar player_name
        date player_dob
        varchar phone
        varchar email
        varchar city
        varchar fide_id "nullable"
        integer fide_rating "nullable"
        varchar status "PENDING_PAYMENT|CONFIRMED|FAILED|CANCELLED"
        varchar entry_number UK
        timestamptz registered_at
        timestamptz confirmed_at
        timestamptz expires_at "PENDING_PAYMENT entries expire 2h after creation"
    }

    PAYMENTS {
        uuid id PK
        uuid registration_id FK
        varchar razorpay_order_id UK
        varchar razorpay_payment_id UK
        integer amount_paise
        varchar currency "INR"
        varchar status "INITIATED|PENDING|PAID|FAILED|REFUNDED"
        jsonb gateway_response
        timestamptz created_at
        timestamptz updated_at
    }

    AUDIT_LOG {
        uuid id PK
        varchar entity_type "tournament|organizer|registration|payment"
        uuid entity_id
        varchar action "APPROVED|REJECTED|CANCELLED|VERIFIED|PAYMENT_CONFIRMED|REFUNDED"
        jsonb old_value
        jsonb new_value
        uuid performed_by FK
        timestamptz performed_at
    }

    NOTIFICATION_LOG {
        uuid id PK
        uuid registration_id FK
        varchar channel "EMAIL"
        varchar type "REGISTRATION_CONFIRMED|PAYMENT_CONFIRMED|TOURNAMENT_CANCELLED|REMINDER"
        varchar status "QUEUED|SENT|FAILED"
        timestamptz sent_at
    }

    EXPORT_JOBS {
        uuid id PK
        uuid organizer_id FK
        uuid tournament_id FK
        varchar format "XLSX|CSV"
        varchar status "QUEUED|PROCESSING|DONE|FAILED"
        varchar storage_key "nulled after expiry"
        timestamptz requested_at
        timestamptz completed_at
        timestamptz expires_at "storage deleted 30 days after requested_at"
    }

    USERS ||--o| ORGANIZERS : "has profile"
    ORGANIZERS ||--o{ TOURNAMENTS : "creates"
    TOURNAMENTS ||--o{ CATEGORIES : "has"
    CATEGORIES ||--o{ REGISTRATIONS : "contains"
    TOURNAMENTS ||--o{ REGISTRATIONS : "receives"
    REGISTRATIONS ||--|| PAYMENTS : "settled by"
    REGISTRATIONS ||--o{ NOTIFICATION_LOG : "triggers"
    ORGANIZERS ||--o{ EXPORT_JOBS : "requests"
```

### Tournament Status State Machine

```mermaid
stateDiagram-v2
    [*] --> DRAFT : Organizer creates tournament
    DRAFT --> PENDING_APPROVAL : Organizer submits for review
    PENDING_APPROVAL --> APPROVED : Admin approves
    PENDING_APPROVAL --> REJECTED : Admin rejects (with reason)
    APPROVED --> ACTIVE : Registration window opens
    APPROVED --> CANCELLED : Admin cancels post-approval
    ACTIVE --> CLOSED : Registration deadline passes
    ACTIVE --> CANCELLED : Admin cancels during registration
    CLOSED --> [*]
    REJECTED --> [*]
    CANCELLED --> [*] : All confirmed registrations notified;\nRefunds handled manually by Admin
```

### Seat Locking Pattern

```sql
-- Every registration attempt runs inside a Prisma $transaction
BEGIN;

SELECT registered_count, max_seats
FROM categories
WHERE id = $categoryId
FOR UPDATE;  -- acquires row lock; concurrent registrations wait here

-- Application checks: registered_count < max_seats
-- If full → ROLLBACK → return 409 Conflict

UPDATE categories
SET registered_count = registered_count + 1
WHERE id = $categoryId;

INSERT INTO registrations (
  tournament_id, category_id, player_name, player_dob,
  phone, email, city, fide_id, fide_rating,
  status, entry_number, expires_at
) VALUES (
  ..., 'PENDING_PAYMENT', generate_entry_number(),
  NOW() + INTERVAL '2 hours'
);

COMMIT;
```

### Seat Release on Expiry

`PURGE_EXPIRED_REGISTRATIONS` (runs every 15 min) must **decrement `registered_count`** for every seat it releases:

```sql
-- Executed atomically per expired registration
BEGIN;

UPDATE categories
SET registered_count = registered_count - 1
WHERE id = (SELECT category_id FROM registrations WHERE id = $registrationId);

UPDATE registrations
SET status = 'CANCELLED'
WHERE id = $registrationId
  AND status = 'PENDING_PAYMENT'
  AND expires_at < NOW();

COMMIT;
```

> **Critical:** Omitting the `registered_count` decrement would permanently lock seats for abandoned registrations.

### Export File Lifecycle

`expires_at = requested_at + 30 days` is set at job creation. The `CLEANUP_EXPORT_FILES` scheduled job:
1. Queries `export_jobs WHERE status='DONE' AND expires_at < NOW()`
2. Deletes the R2 object at `storage_key`
3. Sets `storage_key = NULL` and `status = 'EXPIRED'` in the DB

Exports are fully reproducible — organizers can re-trigger the export at any time.

### Required Indexes

```sql
-- Registrations
CREATE INDEX idx_reg_tournament ON registrations(tournament_id);
CREATE INDEX idx_reg_tournament_status ON registrations(tournament_id, status);
CREATE INDEX idx_reg_phone_tournament ON registrations(phone, tournament_id);
CREATE INDEX idx_reg_expires ON registrations(expires_at) WHERE status = 'PENDING_PAYMENT';

-- Payments
CREATE INDEX idx_pay_order_id ON payments(razorpay_order_id);
CREATE INDEX idx_pay_payment_id ON payments(razorpay_payment_id);
CREATE INDEX idx_pay_registration ON payments(registration_id);

-- Tournaments
CREATE INDEX idx_tourn_organizer ON tournaments(organizer_id);
CREATE INDEX idx_tourn_status ON tournaments(status);
CREATE INDEX idx_tourn_start_date ON tournaments(start_date);

-- Audit log (admin filter patterns)
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_performer ON audit_log(performed_by);
CREATE INDEX idx_audit_performed_at ON audit_log(performed_at DESC);

-- Export cleanup
CREATE INDEX idx_export_expires ON export_jobs(expires_at) WHERE status = 'DONE';
```

---

## 7. Sequence Diagrams

### 7.1 Player Registration & Payment

```mermaid
sequenceDiagram
    autonumber
    actor Player
    participant FE as Frontend
    participant API as NestJS API
    participant DB as PostgreSQL
    participant Redis
    participant Razorpay
    participant Queue as BullMQ
    participant Worker

    Player->>FE: Fill registration form
    FE->>API: POST /api/v1/tournaments/:id/categories/:catId/register
    API->>API: Validate DTO
    API->>Redis: Phone rate-limit check (≤3/phone/tournament/hour)
    Redis-->>API: attempts = 1 ✓
    API->>DB: Check duplicate (phone + tournament_id)
    DB-->>API: No duplicate ✓
    API->>DB: BEGIN; SELECT categories FOR UPDATE
    DB-->>API: registered_count < max_seats ✓
    API->>DB: UPDATE registered_count+1; INSERT registration (PENDING_PAYMENT, expires_at)
    API->>DB: COMMIT
    API->>Razorpay: Create payment order
    Razorpay-->>API: {order_id, amount}
    API->>DB: INSERT payment (INITIATED)
    API-->>FE: {order_id, key_id, amount}
    FE->>Razorpay: Open checkout
    Player->>Razorpay: Completes payment
    Razorpay-->>FE: Success callback (never trusted)
    FE-->>Player: "Awaiting confirmation..."
    Razorpay->>API: POST /payments/webhook (HMAC signed)
    API->>API: Verify HMAC-SHA256 on raw body
    API->>DB: Idempotency check (razorpay_payment_id unique?)
    API->>DB: UPDATE payment=PAID; UPDATE registration=CONFIRMED
    API->>DB: INSERT audit_log (PAYMENT_CONFIRMED)
    API->>Queue: Enqueue SEND_EMAIL {REGISTRATION_CONFIRMED}
    Queue->>Worker: Deliver
    Worker->>Player: Confirmation email + entry number
```

### 7.2 Tournament Approval

```mermaid
sequenceDiagram
    autonumber
    actor Org as Organizer
    actor Adm as Super Admin
    participant API
    participant DB
    participant Queue
    participant Worker

    Org->>API: POST /organizer/tournaments
    API->>DB: INSERT tournament (PENDING_APPROVAL)
    API->>Queue: Enqueue SEND_EMAIL {TOURNAMENT_PENDING}
    Queue->>Worker: Deliver
    Worker->>Adm: "New tournament awaiting review"
    Adm->>API: PATCH /admin/tournaments/:id/status {APPROVED}
    API->>DB: UPDATE status=APPROVED
    API->>DB: INSERT audit_log (APPROVED, performed_by=adminId)
    API->>Queue: Enqueue SEND_EMAIL {TOURNAMENT_APPROVED}
    Queue->>Worker: Deliver
    Worker->>Org: "Your tournament is now live"
```

### 7.3 Tournament Cancellation

```mermaid
sequenceDiagram
    autonumber
    actor Adm as Super Admin
    participant API
    participant DB
    participant Queue
    participant Worker
    actor Players as Confirmed Players

    Note over Adm,API: Valid from APPROVED or ACTIVE status

    Adm->>API: PATCH /admin/tournaments/:id/status\n{status: CANCELLED, cancellation_reason: "..."}
    API->>API: Validate status transition
    API->>DB: UPDATE tournament status=CANCELLED, cancelled_by, cancelled_at
    API->>DB: INSERT audit_log (CANCELLED)
    API->>DB: SELECT registrations WHERE tournament_id AND status=CONFIRMED
    DB-->>API: List of affected registrations
    loop Each confirmed registration
        API->>Queue: Enqueue SEND_EMAIL {TOURNAMENT_CANCELLED}
    end
    API-->>Adm: {status: CANCELLED}
    Queue->>Worker: Deliver notification jobs
    Worker->>Players: Cancellation email with refund instructions
    Note over Worker,Players: Refunds issued manually by Admin\nvia Razorpay dashboard
```

### 7.4 Organizer Export Flow

```mermaid
sequenceDiagram
    autonumber
    actor Org as Organizer
    participant API
    participant DB
    participant Queue
    participant Worker
    participant R2 as Cloudflare R2

    Org->>API: POST /organizer/tournaments/:id/exports {format: xlsx}
    API->>API: Validate ownership
    API->>DB: INSERT export_jobs (QUEUED, expires_at=NOW()+30d)
    API->>Queue: Enqueue GENERATE_EXPORT {job_id}
    API-->>Org: {export_job_id, status: QUEUED}
    Queue->>Worker: Deliver job
    Worker->>DB: UPDATE status=PROCESSING
    Worker->>DB: SELECT confirmed registrations + payments
    Worker->>Worker: Generate .xlsx (ExcelJS)
    Worker->>R2: PUT /{organizer_id}/{tournament_id}/{job_id}.xlsx
    Worker->>DB: UPDATE status=DONE, storage_key
    Org->>API: GET /organizer/exports/:jobId (polling)
    API->>DB: SELECT job (with organizer_id tenant check)
    API->>R2: Generate presigned GET URL (15 min expiry)
    API-->>Org: {status: DONE, download_url}
    Note over R2: Object auto-deleted by CLEANUP_EXPORT_FILES job after 30 days
```

---

## 8. Payment Architecture

### Payment State Machine

```mermaid
stateDiagram-v2
    [*] --> INITIATED : Registration created;\nRazorpay order created
    INITIATED --> PENDING : Player opens Razorpay checkout
    PENDING --> PAID : Webhook received + HMAC verified
    PENDING --> FAILED : Webhook = failure status
    PENDING --> FAILED : Reconciliation detects timeout (>30 min)
    PAID --> REFUNDED : Manual refund by Admin (Razorpay dashboard)
    FAILED --> [*]
    REFUNDED --> [*]
```

### Webhook Security

1. Read raw request body **before** `express.json()` middleware
2. Extract `X-Razorpay-Signature` header
3. Compute `HMAC-SHA256(rawBody, RAZORPAY_WEBHOOK_SECRET)`
4. Compare using `crypto.timingSafeEqual` — constant-time to prevent timing attacks
5. Return `400` on mismatch without any processing

```
Endpoint:  POST /api/v1/payments/webhook
Auth:      None (public) — HMAC is the auth mechanism
WAF rule:  Allowlist Razorpay IP ranges via Cloudflare WAF
```

### Reconciliation Job

Runs every 15 minutes via BullMQ cron:
- Queries orders where `payments.status IN ('INITIATED','PENDING') AND created_at < NOW() - 30 min`
- Calls `GET /v1/orders/:id` on Razorpay
- Updates local payment + registration records
- Enqueues notifications for newly resolved payments

---

## 9. Background Job Architecture

### Worker Separation

BullMQ Worker runs as a **separate Docker container** from the API server.

```mermaid
graph LR
    API["API Container\n(produces jobs)"] -->|"BullMQ enqueue"| Redis["Redis\n(BullMQ Broker)"]
    Redis -->|"BullMQ dequeue"| Worker["Worker Container\n(consumes jobs)"]
    Worker --> DB["PostgreSQL"]
    Worker --> R2["Cloudflare R2"]
    Worker --> Email["Email Service"]
```

### Job Queues

| Queue | Priority | Jobs | Retry Policy | DLQ |
|---|---|---|---|---|
| `payments` | Critical (1) | `PAYMENT_RECONCILE` | 5×, exponential backoff | ✅ |
| `notifications` | High (2) | `SEND_EMAIL` | 3×, 30s intervals | ✅ |
| `exports` | Normal (5) | `GENERATE_EXPORT` | 2× | ✅ |
| `cleanup` | Low (10) | `PURGE_EXPIRED_REGISTRATIONS`, `CLEANUP_EXPORT_FILES` | 1× | ❌ |

### Scheduled Jobs

| Job | Schedule | Purpose |
|---|---|---|
| `PAYMENT_RECONCILE` | Every 15 min | Poll Razorpay for stuck PENDING payments |
| `PURGE_EXPIRED_REGISTRATIONS` | Every 15 min | Cancel PENDING_PAYMENT registrations older than 2h; **decrement `categories.registered_count` per cancelled seat** |
| `CLEANUP_EXPORT_FILES` | Daily 2:00 AM IST | Delete R2 objects for export jobs where `expires_at < NOW()`; set `storage_key = NULL` |
| `REGISTRATION_REMINDERS` | Daily 9:00 AM IST | Email confirmed players 24h before tournament |

### Dead-Letter Queue

Jobs exhausting all retries → moved to `dlq:{queue_name}`. Alert fires when DLQ depth > 0. DLQ jobs are inspected manually and can be re-queued after root cause resolution.

---

## 10. Infrastructure Architecture

### Deployment Topology

```mermaid
graph TB
    subgraph "End Users"
        U1["👤 Player"]
        U2["👤 Organizer"]
        U3["👤 Admin"]
    end

    subgraph "Cloudflare Edge"
        CF_CDN["Cloudflare CDN\n(static assets, cache)"]
        CF_WAF["Cloudflare WAF\n(DDoS, IP allowlists, rate limits)"]
    end

    subgraph "Vercel"
        FE["Next.js App\n(SSR + Static)"]
    end

    subgraph "Docker Host (VPS / Railway)"
        Nginx["Nginx\n(TLS, reverse proxy)"]
        API1["API Container\n(NestJS)"]
        API2["API Container\n(scale-out)"]
        W["Worker Container\n(BullMQ)"]
    end

    subgraph "Managed Data Services"
        PGB["PgBouncer\n(connection pooler)"]
        PG["PostgreSQL\n(managed)"]
        RD["Redis\n(managed)"]
    end

    subgraph "External Services"
        R2["Cloudflare R2\n(30-day export TTL)"]
        RPay["Razorpay"]
        ESvc["SendGrid / SES"]
    end

    U1 & U2 & U3 --> CF_CDN --> CF_WAF
    CF_WAF --> FE
    CF_WAF --> Nginx
    FE --> Nginx
    Nginx --> API1 & API2
    API1 & API2 --> PGB --> PG
    W --> PGB
    API1 & API2 & W --> RD
    API1 --> RPay
    RPay --> Nginx
    API1 & W --> R2
    W --> ESvc
```

### Environment Variables (Required)

```bash
DATABASE_URL=postgresql://user:pass@pgbouncer:5432/chess_tournament
DIRECT_URL=postgresql://user:pass@postgres:5432/chess_tournament  # Prisma migrations
REDIS_URL=redis://redis:6379
JWT_ACCESS_SECRET=<32+ chars>
JWT_REFRESH_SECRET=<32+ chars>
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
RAZORPAY_KEY_ID=rzp_live_xxx
RAZORPAY_KEY_SECRET=xxx
RAZORPAY_WEBHOOK_SECRET=xxx
R2_ACCOUNT_ID=xxx
R2_ACCESS_KEY_ID=xxx
R2_SECRET_ACCESS_KEY=xxx
R2_BUCKET_NAME=chess-tournament
SENDGRID_API_KEY=xxx
SENTRY_DSN=https://xxx@sentry.io/xxx
```

---

## 11. Multi-Tenancy Design

### Model: Shared Schema, Shared Database

`organizer_id` is the tenant discriminator on all organizer-owned entities. Appropriate for 50–500 organizers.

### Three-Layer Isolation

**Layer 1 — Prisma Middleware (auto-scoping)**

```typescript
prisma.$use(async (params, next) => {
  const tenantId = tenantContext.organizerId;
  if (tenantId && TENANT_SCOPED_MODELS.includes(params.model)) {
    params.args.where = { ...params.args.where, organizerId: tenantId };
  }
  return next(params);
});
```

**Layer 2 — Ownership Guards**

`@OrganizerOwnership()` decorator on all organizer routes:
- Verifies resource's `organizer_id` matches authenticated user
- Returns `403 Forbidden` on mismatch (not `404` — prevents enumeration attacks)

**Layer 3 — Object Storage Key Namespacing**

All R2 keys follow: `/{organizer_id}/{tournament_id}/{job_id}.xlsx`
Presigned download URLs expire after 15 minutes.

### Super Admin Bypass

Admin module bypasses tenant middleware. Admin routes require `SUPER_ADMIN` role enforced via `@Roles(Role.SUPER_ADMIN)` guard.

---

## 12. Security Architecture

### Authentication Flow

```mermaid
sequenceDiagram
    actor Org as Organizer
    participant API
    participant DB

    Org->>API: POST /auth/login {email, password}
    API->>DB: Fetch user by email
    API->>API: bcrypt.compare(password, hash)
    API-->>Org: {access_token 15min} + Set-Cookie: refresh_token (httpOnly, 7d)

    Org->>API: GET /organizer/tournaments (Bearer token)
    API->>API: Verify JWT; extract role + organizer_id
    API-->>Org: 200 Response

    Org->>API: POST /auth/refresh (Cookie: refresh_token)
    API->>DB: Validate token not revoked
    API-->>Org: {new access_token}
```

### Security Controls Matrix

| Control | Mechanism | Required for MVP |
|---|---|---|
| Authentication | JWT — 15 min access + httpOnly refresh cookie | ✅ |
| Authorization | `@Roles()` guard on all protected routes | ✅ |
| Token revocation | `refresh_token_sessions` table in DB | ✅ |
| Tenant isolation | TenantContext middleware + ownership guards | ✅ |
| Webhook integrity | HMAC-SHA256 on raw body | ✅ |
| Payment idempotency | Unique constraint on `razorpay_payment_id` | ✅ |
| Input validation | class-validator DTOs on all endpoints | ✅ |
| CORS | Strict allowlist — Next.js origin only | ✅ |
| Secure cookies | `httpOnly`, `Secure`, `SameSite=Strict` | ✅ |
| Audit logging | `audit_log` table for all sensitive mutations | ✅ |
| Admin MFA | TOTP (Google Authenticator) | Strongly recommended |

### Rate Limiting

Two complementary layers are enforced simultaneously:

**Layer 1 — Cloudflare WAF (IP-based, edge)**

| Endpoint | Limit | Window |
|---|---|---|
| `POST /auth/login` | 10 requests | 15 min / IP |
| All API endpoints | 100 requests | 1 min / IP |
| `POST /payments/webhook` | Razorpay IP allowlist only | — |

**Layer 2 — Application (Phone-based, registrations)**

| Rule | Limit | Window | Scope |
|---|---|---|---|
| Registration attempts | **3 attempts** | 1 hour | Per phone number + per tournament |

Implementation uses Redis sorted sets keyed as `rate:reg:{tournamentId}:{phone}`. Evaluated **before** the DB seat check. Exceeding the limit returns `429 Too Many Requests` with `Retry-After` header.

```typescript
// Pseudocode — phone rate limit check (in RegistrationsService)
const key = `rate:reg:${tournamentId}:${phone}`;
const count = await redis.incr(key);
if (count === 1) await redis.expire(key, 3600); // 1-hour window
if (count > 3) throw new TooManyRequestsException('Registration limit reached. Try again in 1 hour.');
```

---

## 13. API Design Reference

### Conventions

- **Base path:** `/api/v1`
- **Authentication:** `Authorization: Bearer <access_token>`
- **Success:** `{ "data": {}, "meta": {} }`
- **Error:** `{ "error": { "code": "SEAT_LIMIT_REACHED", "message": "..." } }`
- **Pagination:** Cursor-based (`cursor` + `limit` query params)

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/login` | None | Organizer / Admin login |
| POST | `/auth/refresh` | Cookie | Refresh access token |
| POST | `/auth/logout` | Bearer | Revoke refresh token |

### Organizer — Tournaments

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/organizer/tournaments` | Organizer | List own tournaments |
| POST | `/organizer/tournaments` | Organizer | Create tournament + categories |
| GET | `/organizer/tournaments/:id` | Organizer | Tournament detail |
| PATCH | `/organizer/tournaments/:id` | Organizer | Edit (DRAFT only) |
| GET | `/organizer/tournaments/:id/registrations` | Organizer | Confirmed registrations |
| POST | `/organizer/tournaments/:id/exports` | Organizer | Trigger async export |
| GET | `/organizer/exports/:jobId` | Organizer | Poll export status + download URL |

### Player — Public

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/tournaments` | None | List APPROVED / ACTIVE tournaments |
| GET | `/tournaments/:id` | None | Tournament detail + categories |
| POST | `/tournaments/:id/categories/:catId/register` | None | Submit registration + get payment order |
| GET | `/registrations/:entryNumber/status` | None | Check registration status |

### Payments

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/payments/webhook` | None (HMAC) | Razorpay webhook receiver |

### Admin

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/admin/tournaments` | Super Admin | All tournaments (filter by status) |
| PATCH | `/admin/tournaments/:id/status` | Super Admin | Approve / reject / cancel tournament |
| GET | `/admin/organizers` | Super Admin | List organizers |
| PATCH | `/admin/organizers/:id/verify` | Super Admin | Activate organizer |
| GET | `/admin/analytics` | Super Admin | Platform metrics |
| GET | `/admin/audit-logs` | Super Admin | Audit log with filters |

### `GET /admin/audit-logs` — Query Parameters

| Parameter | Type | Description |
|---|---|---|
| `entity_type` | enum | `tournament`, `organizer`, `registration`, `payment` |
| `performed_by` | UUID | Filter by acting user |
| `from` | ISO 8601 | `performed_at >= from` |
| `to` | ISO 8601 | `performed_at <= to` |
| `cursor` | string | Pagination cursor |
| `limit` | integer | Records per page (default: 50, max: 200) |

**Response item example:**

```json
{
  "id": "uuid",
  "entity_type": "tournament",
  "entity_id": "uuid",
  "action": "CANCELLED",
  "old_value": { "status": "ACTIVE" },
  "new_value": { "status": "CANCELLED", "cancellation_reason": "Venue unavailable" },
  "performed_by": { "id": "uuid", "email": "admin@easychess.in" },
  "performed_at": "2026-03-06T04:30:00Z"
}
```

---

## 14. Scaling Strategy

### Phase 1 — MVP (0–50 organizers, 50K registrations/year)

- Single Docker host (2 vCPU / 4 GB): 1× API, 1× Worker, 1× PgBouncer
- Managed PostgreSQL (single instance)
- Managed Redis (single instance)
- PgBouncer in **transaction pooling mode** — limits to 10–20 real Postgres connections

### Phase 2 — Growth (50–500 organizers, 500K registrations/year)

- 2–4× API containers behind Nginx load balancer
- 2× Worker containers (scale by queue depth)
- PostgreSQL read replica (analytics + dashboard queries)
- Redis Sentinel or Upstash (high availability)

### Phase 3 — Platform Scale (500+ organizers, 2M+ registrations)

- Autoscaling container fleet (ECS / Cloud Run / Fly.io)
- Postgres table partitioning on `registrations` and `payments` by `created_at` month
- Separate read/write datasource endpoints in Prisma
- Materialized views for analytics; consider ClickHouse for heavy aggregation

---

## 15. Development Roadmap

### Phase 1 — MVP Build Order

| Step | Module | Deliverable |
|---|---|---|
| 1 | Database | Prisma schema + initial migration |
| 2 | Auth | JWT login, refresh, role guards |
| 3 | Users / Organizers | Organizer signup + admin verification |
| 4 | Tournaments | CRUD + categories + full status machine (incl. CANCELLED) |
| 5 | Admin | Approval, rejection, cancellation + audit_log writes |
| 6 | Registrations | Form + seat locking + age validation + phone rate limiting |
| 7 | Payments | Razorpay order + webhook + reconciliation job |
| 8 | Notifications | Email on confirmation + cancellation |
| 9 | Reports | Async Excel export + R2 + 30-day cleanup job |
| 10 | Frontend | Organizer dashboard + public registration form |

### Phase 2 — Platform Expansion

- Tournament discovery with city-based search
- QR code check-in
- Optional player accounts
- WhatsApp notifications (initiate Meta approval 6 weeks before Phase 2 target date)

### Phase 3 — Advanced Platform

- Swiss pairing export, live results, national rating integration
- Mobile app (React Native), organizer subscription billing

---

## 16. Open Decisions

| # | Topic | Options | Architectural Impact |
|---|---|---|---|
| 1 | **Payment collection model** | **Option A (MVP-safe):** Platform collects full fee; admin manually transfers net to organizer. **Option B:** Razorpay Route auto-splits at payment time. | Option A: no schema change. Option B: adds `transfer_id` field, organizer bank KYC flow, GST treatment changes. |
| 2 | **Refund workflow** | **Confirmed for MVP:** Admin-initiated manual refunds via Razorpay dashboard. No automated system. | `payments.status` supports `REFUNDED` as a terminal state set manually by admin. No `RefundRequests` table for MVP. |
| 3 | **Player accounts** | **Confirmed for MVP:** Anonymous form-based. `registrations.player_user_id` is a nullable FK reserved for Phase 2. | No player auth flow in MVP. Field present in schema to avoid future migration cost. |
| 4 | **Notification channels** | **Confirmed for MVP:** Email only (SendGrid / SES). WhatsApp + SMS deferred to Phase 2. | Notification module built with pluggable channel interface from day one. |
| 5 | **FIDE ID validation** | **Confirmed for MVP:** Self-declared, stored as-is. No FIDE API call. | `fide_id VARCHAR` nullable. Async validation addable later without schema change. |
| 6 | **GST / invoicing** | Deferred to Phase 3 when subscription billing is introduced. | Not an MVP concern. |

---

## 17. Observability Architecture

### Structured Logging — Pino

**Library:** `nestjs-pino` (5–10× faster than Winston, JSON-native output)

```typescript
// main.ts
import { Logger } from 'nestjs-pino';
const app = await NestFactory.create(AppModule, { bufferLogs: true });
app.useLogger(app.get(Logger));
```

**Sensitive field redaction (required):**
```typescript
PinoLogger.forRoot({
  pinoHttp: {
    redact: ['req.headers.authorization', 'req.body.password', 'req.body.razorpay_signature']
  }
})
```

| Environment | Level | Output |
|---|---|---|
| `local` | `debug` | stdout pretty-printed |
| `staging` | `info` | stdout JSON |
| `production` | `info` | stdout JSON → log agent (Promtail / Datadog) |

### Error Tracking — Sentry

- Global NestJS exception filter → all unhandled exceptions captured
- BullMQ worker job failure hooks → job name + payload in context
- `@sentry/nextjs` on frontend
- Alert on every new error group in `production`

### Metrics & Monitoring — Prometheus + Grafana

> Use **Grafana Cloud** free tier for MVP to avoid self-hosting Prometheus.

**Key metrics (`/metrics` — internal only):**

| Metric | Type | Description |
|---|---|---|
| `http_request_duration_seconds` | Histogram | API latency by route |
| `http_requests_total` | Counter | Request count |
| `bullmq_jobs_failed_total` | Counter | Failed jobs per queue |
| `bullmq_dlq_depth` | Gauge | Dead-letter queue depth |
| `db_pool_connections_waiting` | Gauge | PgBouncer queue depth |

**Minimum production alerts:**

| Alert | Condition | Severity |
|---|---|---|
| High error rate | 5xx > 1% over 5 min | Critical |
| High latency | p95 > 2 s over 5 min | Warning |
| DLQ has items | `bullmq_dlq_depth` > 0 | Critical |
| DB connections near limit | `db_pool_connections_waiting` > 5 | Warning |

### Observability Stack

```mermaid
graph LR
    API["API Container"] -->|"stdout JSON"| LA["Log Agent\n(Promtail)"]
    Worker["Worker Container"] -->|"stdout JSON"| LA
    LA --> Loki["Grafana Loki"]
    API & Worker -->|"Sentry SDK"| Sentry["Sentry"]
    API -->|"/metrics"| Prom["Prometheus"]
    Prom & Loki --> Grafana["Grafana\n(Dashboards + Alerts)"]
    Grafana -->|"Alerts"| Notif["Slack / Email"]
```

---

## 18. Backup Strategy

### PostgreSQL

| Parameter | Value |
|---|---|
| Backup type | Automated daily snapshots + continuous WAL archiving |
| Retention | **7 days minimum** (30 days for production) |
| Point-in-time recovery | **Required** |
| Encryption | AES-256 at rest |

Recommended providers satisfying this by default: **Neon**, **Railway**, **Supabase** (Pro plan).

**Quarterly restore drill:**
1. Restore to new instance at target point-in-time
2. Update `DATABASE_URL` in staging
3. Smoke test: auth, tournament query, registration query, payment lookup
4. Document restore duration (target < 30 min)

### Redis

- RDB snapshots every 15 min
- On Redis failure: API continues serving; background jobs pause
- If outage > 15 min: manually trigger `PAYMENT_RECONCILE` after recovery

### Cloudflare R2

11-nines durability natively. No additional backup needed. Exports are reproducible.

### Recovery Objectives

| Objective | Target |
|---|---|
| RPO (max data loss) | < 15 minutes |
| RTO (restore to service) | < 60 minutes |

---

## 19. CI/CD Pipeline

### Platform: GitHub Actions

| Pipeline | Trigger | Targets |
|---|---|---|
| CI | PR to `main` | Validation only |
| CD — Staging | Merge to `main` | Staging |
| CD — Production | Release tag `v*` | Production |

### CI Pipeline

```mermaid
flowchart LR
    PR["PR opened"] --> L["✅ Lint\n(ESLint + Prettier)"]
    L --> T["✅ Type Check\n(tsc --noEmit)"]
    T --> U["✅ Unit Tests\n(Jest + ephemeral Postgres + Redis)"]
    U --> B["✅ Docker Build\n(API + Worker)"]
```

### CD Pipeline

```mermaid
flowchart LR
    M["Merge to main"] --> BP["🐳 Build & Push\nimages to GHCR"]
    Tag["Release tag v*"] --> BP
    BP --> SM["🗄️ Migrate DB\n(staging)"]
    SM --> DS["🚀 Deploy Staging"]
    DS --> ST["🧪 Smoke Tests"]
    ST -->|"tag only"| PM["🗄️ Migrate DB\n(prod)"]
    PM --> DP["🚀 Deploy Production"]
```

### Container Images

| Image | Dockerfile | Entry Point |
|---|---|---|
| `chess-api` | `Dockerfile.api` | `node dist/main.js` |
| `chess-worker` | `Dockerfile.worker` | `node dist/worker.js` |

### Secrets Management

All secrets in GitHub Secrets (per environment), injected as Docker environment variables. `.env` files are gitignored. Local dev uses `.env.local` copied from `.env.example`.

---

## 20. Environment Topology

### Environment Comparison

| Component | Local | Staging | Production |
|---|---|---|---|
| Frontend | `localhost:3000` | Vercel preview | Vercel production |
| API | `localhost:3001` | 1× Docker container | 1–2× Docker containers |
| Worker | Same process (dev mode) | Separate container | Separate container |
| PostgreSQL | Local Docker | Managed staging DB | Managed prod DB (isolated) |
| Redis | Local Docker | Managed Redis | Managed Redis |
| Object Storage | MinIO (local Docker) | R2 staging bucket | R2 production bucket |
| Payments | Razorpay **test** keys | Razorpay **test** keys | Razorpay **live** keys |
| Email | Mailtrap (not delivered) | SendGrid test inbox | SendGrid live delivery |
| Sentry | Disabled | `staging` env | `production` env |
| Log level | `debug` | `info` | `info` |

### Key Rules

- **Staging:** Always test payment keys. Fully isolated DB. Auto-deploys on merge to `main`.
- **Production:** Tag-gated (`v*` only). Migrations run before new containers start. Additive-only schema changes required. Env vars managed via CI secrets — never manually edited on server.

### Local Development Setup

```yaml
# docker-compose.dev.yml
services:
  postgres:
    image: postgres:15
    environment: { POSTGRES_DB: chess_tournament, POSTGRES_PASSWORD: localpassword }
    ports: ['5432:5432']
    volumes: ['pgdata:/var/lib/postgresql/data']
  redis:
    image: redis:7
    ports: ['6379:6379']
  minio:
    image: minio/minio
    command: server /data --console-address ':9001'
    ports: ['9000:9000', '9001:9001']
    environment: { MINIO_ROOT_USER: minioadmin, MINIO_ROOT_PASSWORD: minioadmin }
    volumes: ['miniodata:/data']
volumes:
  pgdata:
  miniodata:
```

**Onboarding (5 commands):**

```bash
docker compose -f docker-compose.dev.yml up -d
cp .env.example .env.local
npx prisma migrate dev
npx prisma db seed        # creates super admin account
npm run start:dev
```

---

*Document Version: 2.2 | Last Updated: 2026-03-06 | Owner: Easy Chess Academy | Final Implementation Baseline*
