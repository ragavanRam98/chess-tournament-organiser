# Chess Tournament Entry Platform

### Full Architecture & Technical Blueprint

> **Owner:** Easy Chess Academy
> **Version:** 2.1
> **Status:** Engineering Reference Document

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

## 1. System Overview

The Chess Tournament Entry Platform is a **multi-tenant SaaS platform** that provides a centralized digital infrastructure for chess tournament management. It replaces manual workflows (WhatsApp registration, Google Forms, Excel tracking, manual payment verification) with a fully automated online system.

### Problem Statement

| Current State | Platform Solution |
|---|---|
| WhatsApp registrations | Online registration forms with validation |
| Google Forms | Structured registration with category enforcement |
| Manual Excel tracking | Real-time dashboard + async Excel export |
| Manual payment verification | Razorpay webhook-verified automated confirmation |
| Per-tournament manual comms | Automated email/SMS notifications |

### Initial Scale Targets

| Metric | Initial | Growth Target |
|---|---|---|
| Academies (Organizers) | 50 | 500+ |
| Tournaments per year | 200 | 1,000+ |
| Players per tournament | 100–500 | 1,000+ |
| Registrations per year | 50,000 | 500,000+ |

---

## 2. User Roles & Permissions

### Roles Overview

| Capability | Player | Organizer | Super Admin |
|---|---|---|---|
| View public tournaments | ✅ | ✅ | ✅ |
| Register for a tournament | ✅ | ❌ | ❌ |
| Pay entry fee | ✅ | ❌ | ❌ |
| Create tournament | ❌ | ✅ | ✅ |
| Edit own tournament | ❌ | ✅ | ✅ |
| View own tournament registrations | ❌ | ✅ | ✅ |
| Export entry reports | ❌ | ✅ | ✅ |
| Approve / reject tournaments | ❌ | ❌ | ✅ |
| Verify organizers | ❌ | ❌ | ✅ |
| View all platform analytics | ❌ | ❌ | ✅ |
| Manage disputes | ❌ | ❌ | ✅ |

### Role Assignment Rules

- A **Super Admin** account is seeded at platform deployment. It is not self-registerable.
- **Organizers** self-register and receive `PENDING_VERIFICATION` status. Super Admin manually activates.
- **Players** do not require accounts for MVP. Registration is form-based (name, DOB, phone, FIDE ID optional).

---

## 3. C4 Architecture Diagrams

### Level 1 — System Context

This diagram shows how the Chess Tournament platform interacts with external users and systems.

```mermaid
C4Context
    title Chess Tournament Entry Platform — System Context

    Person(player, "Player / Parent", "Discovers tournaments and registers online")
    Person(organizer, "Organizer", "Chess academy that runs tournaments")
    Person(superadmin, "Super Admin", "Easy Chess Academy platform operator")

    System(platform, "Chess Tournament Platform", "Central system for tournament creation, player registration, payments, and reporting")

    System_Ext(razorpay, "Razorpay", "Payment gateway for online entry fee collection")
    System_Ext(email, "Email Service\n(SendGrid / SES)", "Transactional email delivery")
    System_Ext(sms, "SMS / WhatsApp\n(MSG91)", "Notification delivery")
    System_Ext(s3, "Object Storage\n(Cloudflare R2)", "Excel/CSV exports and tournament posters")
    System_Ext(cdn, "Cloudflare CDN", "Edge caching and DDoS protection")

    Rel(player, platform, "Registers, pays entry fee", "HTTPS")
    Rel(organizer, platform, "Creates tournaments, exports entries", "HTTPS")
    Rel(superadmin, platform, "Approves tournaments, manages platform", "HTTPS")
    Rel(platform, razorpay, "Creates payment orders, verifies webhooks", "HTTPS / Webhook")
    Rel(platform, email, "Sends confirmation emails", "API")
    Rel(platform, sms, "Sends SMS / WhatsApp confirmations", "API")
    Rel(platform, s3, "Stores and retrieves exports and posters", "S3 API")
    Rel(cdn, platform, "Routes and caches traffic", "HTTPS")
```

---

### Level 2 — Container Diagram

This diagram shows the major deployable units (containers) inside the platform.

```mermaid
C4Container
    title Chess Tournament Entry Platform — Container Diagram

    Person(player, "Player / Parent")
    Person(organizer, "Organizer")
    Person(superadmin, "Super Admin")

    System_Boundary(platform, "Chess Tournament Entry Platform") {

        Container(webapp, "Web Application", "Next.js / TypeScript", "Public tournament discovery, player registration forms, organizer dashboard, admin panel")

        Container(api, "API Server", "NestJS / Node.js / TypeScript", "REST API serving all business logic: auth, tournaments, registrations, payments, exports")

        Container(worker, "Background Worker", "NestJS / BullMQ", "Async jobs: Excel/CSV generation, email/SMS notifications, payment reconciliation")

        ContainerDb(postgres, "PostgreSQL", "Managed Postgres", "Primary datastore: users, organizers, tournaments, registrations, payments")

        ContainerDb(redis, "Redis", "Redis 7+", "Job queue (BullMQ) and session/response cache")

        Container(storage, "Object Storage", "Cloudflare R2 (S3-compatible)", "Tournament posters, generated Excel exports, QR codes")
    }

    System_Ext(razorpay, "Razorpay")
    System_Ext(email, "Email Service")
    System_Ext(sms, "SMS / WhatsApp")
    System_Ext(cdn, "Cloudflare CDN")

    Rel(player, cdn, "Accesses platform", "HTTPS")
    Rel(organizer, cdn, "Accesses platform", "HTTPS")
    Rel(superadmin, cdn, "Accesses admin panel", "HTTPS")
    Rel(cdn, webapp, "Serves frontend", "HTTPS")
    Rel(cdn, api, "Routes API requests", "HTTPS")

    Rel(webapp, api, "REST API calls", "HTTPS / JSON")
    Rel(api, postgres, "Reads / writes data", "TCP / Prisma ORM")
    Rel(api, redis, "Enqueues background jobs, reads cache", "TCP")
    Rel(api, razorpay, "Creates payment orders", "HTTPS")
    Rel(razorpay, api, "Payment webhooks (HMAC signed)", "HTTPS POST")
    Rel(worker, postgres, "Reads registration data", "TCP / Prisma ORM")
    Rel(worker, redis, "Consumes BullMQ jobs", "TCP")
    Rel(worker, storage, "Uploads generated files", "S3 API")
    Rel(worker, email, "Sends transactional emails", "API")
    Rel(worker, sms, "Sends SMS / WhatsApp", "API")
    Rel(webapp, storage, "Downloads exports via signed URL", "HTTPS")
```

---

### Level 3 — Backend API Component Diagram

This diagram shows the internal NestJS module structure of the API Server.

```mermaid
C4Component
    title API Server — Component Diagram (NestJS Modules)

    Container_Boundary(api, "API Server (NestJS)") {

        Component(auth_mod, "Auth Module", "NestJS Module", "Organizer/Admin JWT login, token refresh, role guards")
        Component(user_mod, "Users Module", "NestJS Module", "Organizer account management, admin account seeding")
        Component(tournament_mod, "Tournaments Module", "NestJS Module", "Tournament CRUD, approval workflow, category management")
        Component(registration_mod, "Registrations Module", "NestJS Module", "Player registration form, age validation, duplicate detection, seat locking")
        Component(payment_mod, "Payments Module", "NestJS Module", "Razorpay order creation, webhook verification, payment state machine")
        Component(reports_mod, "Reports Module", "NestJS Module", "Enqueues Excel/CSV export jobs, returns signed download URLs")
        Component(notification_mod, "Notifications Module", "NestJS Module", "Enqueues email/SMS jobs, manages notification templates")
        Component(admin_mod, "Admin Module", "NestJS Module", "Super admin actions: approve/reject tournaments, verify organizers, platform analytics")
        Component(queue_mod, "Queue Module", "BullMQ / Redis", "Shared BullMQ producer used by all modules to dispatch async jobs")
    }

    ContainerDb(postgres, "PostgreSQL")
    ContainerDb(redis, "Redis")

    Rel(auth_mod, postgres, "Validates credentials, stores sessions")
    Rel(tournament_mod, postgres, "Tournament CRUD")
    Rel(registration_mod, postgres, "Registration writes with seat locking (SELECT FOR UPDATE)")
    Rel(payment_mod, postgres, "Payment state transitions")
    Rel(admin_mod, postgres, "Cross-tenant reads (admin only)")
    Rel(reports_mod, queue_mod, "Enqueues export jobs")
    Rel(notification_mod, queue_mod, "Enqueues notification jobs")
    Rel(queue_mod, redis, "Publishes to BullMQ queues")
```

---

## 4. Technology Stack

### Frontend

| Concern | Technology | Rationale |
|---|---|---|
| Framework | Next.js 14+ (App Router) | SSR for tournament discovery SEO; RSC reduces client bundle |
| Language | TypeScript | End-to-end type safety with shared API types |
| Styling | TailwindCSS | Rapid UI development; consistent design tokens |
| Server state | TanStack Query (React Query) | Caching, background refetch, optimistic updates |
| Forms | react-hook-form + zod | Type-safe form validation matching backend schemas |
| Hosting | Vercel | Zero-config Next.js deployment for MVP |

### Backend

| Concern | Technology | Rationale |
|---|---|---|
| Framework | NestJS 10+ | DI container + module system enables clean modular monolith |
| Language | TypeScript | Shared types with frontend |
| ORM | Prisma 5+ | Type-safe DB client; schema-first migrations |
| DB connections | PgBouncer (transaction mode) | Prevents exhausting Postgres `max_connections` under load |
| API style | REST (JSON) | Simpler for the domain than GraphQL at this scale |
| Auth | Passport.js (JWT strategy) | NestJS-native JWT, role guards |
| Validation | class-validator + class-transformer | DTO-level validation on all incoming requests |

### Data Layer

| Concern | Technology | Rationale |
|---|---|---|
| Primary DB | PostgreSQL 15+ | ACID, referential integrity, row locking for seat management |
| Cache / Queue broker | Redis 7+ | BullMQ job queue + response caching |
| Object storage | Cloudflare R2 | Zero egress fees; S3-compatible API; CDN native integration |
| ORM migrations | Prisma Migrate | Version-controlled schema migrations |

### Infrastructure

| Concern | Technology | Rationale |
|---|---|---|
| CDN / WAF | Cloudflare | DDoS protection, edge caching, rate limiting at edge |
| Frontend hosting | Vercel | Managed Next.js; scales automatically |
| Backend hosting | Docker (VPS / Railway / Fly.io) | Portable; can run on Hetzner VPS to minimize cost |
| DB hosting | Managed Postgres (Railway / Neon / Supabase) | Automated backups, connection pooling, point-in-time recovery |
| Container registry | Docker Hub / GHCR | Stores versioned API and worker images |
| Secrets | Environment variables (inject via hosting provider) | Never committed to repository |

---

## 5. Backend Module Architecture

### Module Dependency Graph

```mermaid
graph TD
    AuthMod["Auth Module<br/>(JWT, Guards, Strategies)"]
    UserMod["Users Module<br/>(Organizer accounts)"]
    TournMod["Tournaments Module<br/>(CRUD, Approval)"]
    CatMod["Categories Module<br/>(U10, U14, Open — seat limits)"]
    RegMod["Registrations Module<br/>(Player form, seat locking)"]
    PayMod["Payments Module<br/>(Razorpay, Webhook, State machine)"]
    ReportMod["Reports Module<br/>(Export trigger + signed URL)"]
    NotifMod["Notifications Module<br/>(Email / SMS queue dispatch)"]
    AdminMod["Admin Module<br/>(Platform-wide operations)"]
    QueueMod["Queue Module<br/>(BullMQ producers)"]
    WorkerMod["Worker Process<br/>(Separate Docker container)"]

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

### Module Responsibilities

#### `auth`
- `POST /auth/login` — Organizer/Admin JWT login
- `POST /auth/refresh` — Access token refresh
- Issues short-lived access tokens (15 min) + long-lived refresh tokens (7 days, stored in `httpOnly` cookie)
- Provides `@Roles()` decorator and `RolesGuard` consumed by all other modules

#### `users`
- Organizer account registration, profile update
- Admin account seeding (not self-registerable)
- Organizer verification status management (`PENDING_VERIFICATION → ACTIVE`)

#### `tournaments`
- Tournament CRUD (organizer-scoped)
- Tournament lifecycle: `DRAFT → PENDING_APPROVAL → APPROVED → ACTIVE → CLOSED`
- Manages `categories` as child entities (each category has `max_seats`, `min_age`, `max_age`)

#### `registrations`
- Player registration form processing
- Age validation against category bounds
- Duplicate detection (phone + tournament)
- **Seat locking**: Uses `SELECT ... FOR UPDATE` on `Category.registered_count` to prevent overselling
- Registration lifecycle: `PENDING_PAYMENT → CONFIRMED | FAILED | CANCELLED`

#### `payments`
- Creates Razorpay payment orders
- Receives and **validates HMAC-SHA256 signatures** on all incoming webhooks
- Payment lifecycle: `INITIATED → PENDING → PAID | FAILED | REFUNDED`
- Idempotency check: duplicate `razorpay_payment_id` is rejected
- Triggers registration confirmation on `PAID`
- Scheduled reconciliation: polls Razorpay for orders stuck in `PENDING` > 30 min

#### `reports`
- Accepts export requests from authenticated organizers
- Enqueues an export job with validated `organizer_id` + `tournament_id`
- Returns a polling endpoint or webhook URL for download link
- Download URLs are **presigned S3 URLs** (15-minute expiry, path includes `organizer_id`)

#### `notifications`
- Enqueues notification jobs (email, SMS) triggered by registration and payment events
- Templates: registration confirmation, payment confirmation, tournament approval, tournament reminder

#### `admin`
- Thin façade: all data access delegated to other modules' services
- Tournament approval/rejection with audit note
- Organizer verification
- Platform-wide analytics aggregation (read replica in future)

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
        varchar status "DRAFT|PENDING_APPROVAL|APPROVED|ACTIVE|CLOSED|REJECTED"
        timestamptz approved_at
        uuid approved_by FK
        text rejection_reason
        timestamptz created_at
        timestamptz updated_at
    }

    CATEGORIES {
        uuid id PK
        uuid tournament_id FK
        varchar name "U10 | U14 | U18 | Open"
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
        varchar player_name
        date player_dob
        varchar phone
        varchar email
        varchar city
        varchar fide_id
        integer fide_rating
        varchar status "PENDING_PAYMENT|CONFIRMED|FAILED|CANCELLED"
        varchar entry_number UK
        timestamptz registered_at
        timestamptz confirmed_at
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
        varchar entity_type
        uuid entity_id
        varchar action
        jsonb old_value
        jsonb new_value
        uuid performed_by FK
        timestamptz performed_at
    }

    NOTIFICATION_LOG {
        uuid id PK
        uuid registration_id FK
        varchar channel "EMAIL | SMS | WHATSAPP"
        varchar type "REGISTRATION_CONFIRMED | PAYMENT_CONFIRMED | REMINDER"
        varchar status "QUEUED | SENT | FAILED"
        timestamptz sent_at
    }

    EXPORT_JOBS {
        uuid id PK
        uuid organizer_id FK
        uuid tournament_id FK
        varchar format "XLSX | CSV"
        varchar status "QUEUED | PROCESSING | DONE | FAILED"
        varchar storage_key
        timestamptz requested_at
        timestamptz completed_at
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

### Schema Design Notes

#### Seat Locking (Critical)
Seat limits are enforced with database-level locking to prevent overselling:

```sql
-- Inside a transaction for each registration attempt:
BEGIN;

SELECT registered_count, max_seats
FROM categories
WHERE id = $categoryId
FOR UPDATE;  -- acquires row lock

-- Only proceed if registered_count < max_seats
UPDATE categories
SET registered_count = registered_count + 1
WHERE id = $categoryId;

INSERT INTO registrations (...) VALUES (...);

COMMIT;
```

#### Payment Amounts
All monetary amounts are stored in **paise (smallest unit)** — never floating point. Display layer divides by 100.

#### Entry Number Generation
`entry_number` is a human-readable identifier (`ECA-2025-000001`) generated using a sequence, used on confirmation emails and tournament sheets.

#### Required Indexes

```sql
-- Registration lookups
CREATE INDEX idx_registrations_tournament ON registrations(tournament_id);
CREATE INDEX idx_registrations_tournament_status ON registrations(tournament_id, status);
CREATE INDEX idx_registrations_phone_tournament ON registrations(phone, tournament_id);

-- Payment lookups
CREATE INDEX idx_payments_order_id ON payments(razorpay_order_id);
CREATE INDEX idx_payments_payment_id ON payments(razorpay_payment_id);
CREATE INDEX idx_payments_registration ON payments(registration_id);

-- Tournament discovery
CREATE INDEX idx_tournaments_organizer ON tournaments(organizer_id);
CREATE INDEX idx_tournaments_status ON tournaments(status);
CREATE INDEX idx_tournaments_start_date ON tournaments(start_date);
```

---

## 7. Sequence Diagrams

### 7.1 Player Registration & Payment Flow

```mermaid
sequenceDiagram
    autonumber
    actor Player
    participant Frontend as Next.js Frontend
    participant API as NestJS API
    participant DB as PostgreSQL
    participant Razorpay
    participant Queue as BullMQ / Redis
    participant Worker

    Player->>Frontend: Select tournament + category
    Player->>Frontend: Fill registration form (name, DOB, phone, FIDE ID)
    Frontend->>API: POST /api/v1/tournaments/:id/categories/:catId/register
    API->>API: Validate DTO (class-validator)
    API->>DB: Check duplicate (phone + tournament_id)
    DB-->>API: No duplicate found

    API->>DB: BEGIN TRANSACTION
    API->>DB: SELECT categories FOR UPDATE (seat check)
    DB-->>API: registered_count < max_seats ✓
    API->>DB: INSERT registration (status=PENDING_PAYMENT)
    API->>DB: UPDATE categories SET registered_count = registered_count + 1
    API->>DB: COMMIT

    API->>Razorpay: Create payment order (amount, currency, receipt)
    Razorpay-->>API: {order_id, amount, currency}
    API->>DB: INSERT payment (status=INITIATED, razorpay_order_id)
    API-->>Frontend: {registration_id, order_id, key_id, amount}

    Frontend->>Razorpay: Open Razorpay checkout (order_id)
    Player->>Razorpay: Completes payment
    Razorpay-->>Frontend: Payment success callback (never trusted)
    Frontend-->>Player: "Payment submitted, awaiting confirmation..."

    Razorpay->>API: POST /api/v1/payments/webhook (HMAC signed)
    API->>API: Verify HMAC-SHA256 signature
    API->>DB: Check payment idempotency (razorpay_payment_id exists?)
    DB-->>API: New payment ✓
    API->>DB: UPDATE payments SET status=PAID
    API->>DB: UPDATE registrations SET status=CONFIRMED, confirmed_at=NOW()
    API->>Queue: Enqueue REGISTRATION_CONFIRMED notification job
    Queue->>Worker: Deliver notification job
    Worker->>Player: Email / SMS confirmation + entry number
```

---

### 7.2 Tournament Approval Workflow

```mermaid
sequenceDiagram
    autonumber
    actor Organizer
    actor Admin as Super Admin
    participant Frontend
    participant API as NestJS API
    participant DB as PostgreSQL
    participant Queue as BullMQ
    participant Worker

    Organizer->>Frontend: Fill tournament details + categories
    Frontend->>API: POST /api/v1/organizer/tournaments (Bearer token)
    API->>API: Validate JWT, confirm role=ORGANIZER
    API->>DB: INSERT tournament (status=PENDING_APPROVAL, organizer_id)
    API->>DB: INSERT categories[]
    API-->>Organizer: {tournament_id, status: PENDING_APPROVAL}

    Note over API,DB: Admin is notified asynchronously
    API->>Queue: Enqueue TOURNAMENT_PENDING_ADMIN notification
    Queue->>Worker: Deliver job
    Worker->>Admin: Email notification: "New tournament awaiting review"

    Admin->>Frontend: Views pending tournaments list
    Frontend->>API: GET /api/v1/admin/tournaments?status=PENDING_APPROVAL
    API->>API: Validate JWT, confirm role=SUPER_ADMIN
    API->>DB: Query tournaments WHERE status=PENDING_APPROVAL
    DB-->>API: Tournament list
    API-->>Admin: Tournament list + details

    Admin->>Frontend: Reviews and approves tournament
    Frontend->>API: PATCH /api/v1/admin/tournaments/:id/status {status: APPROVED}
    API->>DB: UPDATE tournaments SET status=APPROVED, approved_by, approved_at
    API->>DB: INSERT audit_log (entity=tournament, action=APPROVED, by=adminId)
    API->>Queue: Enqueue TOURNAMENT_APPROVED notification
    Queue->>Worker: Deliver job
    Worker->>Organizer: Email: "Your tournament has been approved and is now public"
    API-->>Admin: {status: APPROVED}
```

---

### 7.3 Organizer Excel Export Flow

```mermaid
sequenceDiagram
    autonumber
    actor Organizer
    participant Frontend
    participant API as NestJS API
    participant DB as PostgreSQL
    participant Queue as BullMQ / Redis
    participant Worker
    participant R2 as Cloudflare R2

    Organizer->>Frontend: Click "Export Entry List" for tournament
    Frontend->>API: POST /api/v1/organizer/tournaments/:id/exports {format: xlsx}
    API->>API: Validate JWT + organizer_id ownership of tournament
    API->>DB: INSERT export_jobs (organizer_id, tournament_id, status=QUEUED)
    API->>Queue: Enqueue GENERATE_EXPORT job {export_job_id}
    API-->>Organizer: {export_job_id, status: QUEUED}

    Note over Queue,Worker: Worker picks up job from BullMQ queue
    Queue->>Worker: Deliver GENERATE_EXPORT job
    Worker->>DB: UPDATE export_jobs SET status=PROCESSING
    Worker->>DB: SELECT registrations + payments WHERE tournament_id (+ confirmed only)
    DB-->>Worker: Registration rows (100–1000 records)
    Worker->>Worker: Generate .xlsx file (ExcelJS library)
    Worker->>R2: PUT /{organizer_id}/{tournament_id}/{job_id}.xlsx
    R2-->>Worker: Upload confirmed
    Worker->>DB: UPDATE export_jobs SET status=DONE, storage_key

    Organizer->>Frontend: Poll GET /api/v1/organizer/exports/:jobId
    Frontend->>API: GET /api/v1/organizer/exports/:jobId
    API->>DB: SELECT export_job WHERE id + organizer_id (tenant check)
    DB-->>API: {status: DONE, storage_key}
    API->>R2: Generate presigned GET URL (15 min expiry)
    R2-->>API: Signed URL
    API-->>Frontend: {status: DONE, download_url: <signed URL>}
    Frontend-->>Organizer: Triggers browser file download
```

---

## 8. Payment Architecture

### Payment State Machine

```mermaid
stateDiagram-v2
    [*] --> INITIATED: Registration created,\nRazorpay order created

    INITIATED --> PENDING: Player opens\nRazorpay checkout

    PENDING --> PAID: Webhook received\n+ HMAC verified

    PENDING --> FAILED: Webhook received\nwith failure status

    PENDING --> FAILED: Reconciliation job\ndetects timeout (>30 min)

    PAID --> REFUNDED: Manual refund\ninitiated by Admin

    FAILED --> [*]: No further transitions
    REFUNDED --> [*]: Terminal state
```

### Webhook Security Design

Razorpay signs all webhook payloads with `HMAC-SHA256` using a shared secret. The API must:

1. Read the **raw request body** before any JSON parsing (`rawBody` middleware in NestJS)
2. Extract `X-Razorpay-Signature` header
3. Compute `HMAC-SHA256(rawBody, RAZORPAY_WEBHOOK_SECRET)`
4. Compare with constant-time comparison (`crypto.timingSafeEqual`)
5. **Reject** any request where signatures do not match — return `400` without processing

```
Payment Webhook Endpoint: POST /api/v1/payments/webhook
Auth: None (public) — protected exclusively by HMAC signature
Body parsing: rawBody middleware must run BEFORE express.json()
```

### Payment Reconciliation (Background Job)

A scheduled BullMQ cron job runs every 15 minutes:
- Queries all payments in `PENDING` or `INITIATED` status where `created_at < NOW() - 30 minutes`
- Calls Razorpay `GET /v1/payments/:id` to fetch current status
- Updates local payment + registration records accordingly
- Enqueues notification jobs for newly resolved payments

---

## 9. Background Job Architecture

### Worker as Separate Process

The BullMQ **Worker is deployed as a separate Docker container** from the API server. This prevents CPU-intensive jobs (Excel generation) from blocking API event loop.

```mermaid
graph LR
    API["API Container\n(NestJS API Server)\nProduces jobs"]
    Worker["Worker Container\n(NestJS Worker)\nConsumes jobs"]
    Redis["Redis\n(BullMQ Broker)"]
    DB["PostgreSQL"]
    R2["Cloudflare R2"]
    Email["Email Service"]
    SMS["SMS Service"]

    API -->|"BullMQ enqueue"| Redis
    Redis -->|"BullMQ dequeue"| Worker
    Worker --> DB
    Worker --> R2
    Worker --> Email
    Worker --> SMS
```

### Job Queue Design

| Queue Name | Priority | Jobs | Retry Policy | DLQ? |
|---|---|---|---|---|
| `payments` | Critical (1) | `PAYMENT_RECONCILE` | 5x, exponential backoff | ✅ Yes |
| `notifications` | High (2) | `SEND_EMAIL`, `SEND_SMS` | 3x, 30s intervals | ✅ Yes |
| `exports` | Normal (5) | `GENERATE_EXPORT` | 2x | ✅ Yes |
| `cleanup` | Low (10) | `PURGE_EXPIRED_REGISTRATIONS` | 1x | ❌ No |

### Dead-Letter Queue (DLQ) Policy

- Jobs that exhaust all retries are moved to a `dlq:{queue_name}` queue
- An alert is fired when DLQ depth > 0 (Slack/email alert via monitoring)
- DLQ jobs are manually inspected and can be re-queued after root cause resolution

### Scheduled Jobs

| Job | Schedule | Purpose |
|---|---|---|
| `PAYMENT_RECONCILE` | Every 15 min | Poll Razorpay for stuck PENDING payments |
| `REGISTRATION_REMINDERS` | Daily 9:00 AM IST | Email players 24h before tournament |
| `PURGE_EXPIRED_REGISTRATIONS` | Hourly | Cancel PENDING_PAYMENT registrations >2h old, release seats |

---

## 10. Infrastructure Architecture

### Deployment Topology

```mermaid
graph TB
    subgraph "End Users"
        Player["👤 Player Browser"]
        OrgBrowser["👤 Organizer Browser"]
        AdminBrowser["👤 Admin Browser"]
    end

    subgraph "Cloudflare Edge"
        CF_CDN["Cloudflare CDN\n(Static assets, edge cache)"]
        CF_WAF["Cloudflare WAF\n(DDoS, rate limiting)"]
    end

    subgraph "Vercel (Frontend)"
        Vercel["Next.js App\n(Vercel Managed)\nSSR + Static"]
    end

    subgraph "Docker Host (VPS / Railway)"
        Nginx["Nginx Reverse Proxy\n(TLS termination, load balance)"]
        API1["API Container\n(NestJS)"]
        API2["API Container\n(NestJS) (scale-out)"]
        Worker["Worker Container\n(BullMQ)"]
    end

    subgraph "Managed Data Services"
        PgBouncer["PgBouncer\n(Connection Pooler)"]
        Postgres["PostgreSQL\n(Managed - Neon / Railway)"]
        Redis["Redis\n(Managed - Railway / Upstash)"]
    end

    subgraph "External Services"
        R2["Cloudflare R2\n(Object Storage)"]
        Razorpay["Razorpay\n(Payment Gateway)"]
        EmailSvc["SendGrid / SES\n(Email)"]
        SMSSvc["MSG91\n(SMS / WhatsApp)"]
    end

    Player --> CF_CDN
    OrgBrowser --> CF_CDN
    AdminBrowser --> CF_CDN
    CF_CDN --> CF_WAF
    CF_WAF --> Vercel
    CF_WAF --> Nginx
    Vercel --> Nginx
    Nginx --> API1
    Nginx --> API2
    API1 --> PgBouncer
    API2 --> PgBouncer
    Worker --> PgBouncer
    PgBouncer --> Postgres
    API1 --> Redis
    API2 --> Redis
    Worker --> Redis
    API1 --> Razorpay
    API1 --> R2
    Worker --> R2
    Worker --> EmailSvc
    Worker --> SMSSvc
    Razorpay --> Nginx
```

### Environment Configuration

| Environment | Frontend | Backend | Database |
|---|---|---|---|
| `local` | `localhost:3000` | `localhost:3001` | Local Docker Postgres |
| `staging` | Vercel preview URL | Staging Docker host | Shared staging DB |
| `production` | Vercel production | Production VPS | Managed Postgres (prod) |

### Environment Variables (Required — Never Committed to Repo)

```
# Database
DATABASE_URL=postgresql://user:pass@host:5432/chess_tournament
DIRECT_URL=postgresql://user:pass@host:5432/chess_tournament   # Prisma migrations

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_ACCESS_SECRET=<32+ char random>
JWT_REFRESH_SECRET=<32+ char random>
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# Razorpay
RAZORPAY_KEY_ID=rzp_live_xxx
RAZORPAY_KEY_SECRET=xxx
RAZORPAY_WEBHOOK_SECRET=xxx

# Object Storage (Cloudflare R2)
R2_ACCOUNT_ID=xxx
R2_ACCESS_KEY_ID=xxx
R2_SECRET_ACCESS_KEY=xxx
R2_BUCKET_NAME=chess-tournament
R2_PUBLIC_URL=https://pub-xxx.r2.dev

# Notifications
SENDGRID_API_KEY=xxx
MSG91_AUTH_KEY=xxx
```

---

## 11. Multi-Tenancy Design

### Tenancy Model

The platform uses **shared schema, shared database** multi-tenancy with `organizer_id` as the tenant discriminator. This is the correct approach for the current scale (50 → 500 organizers).

### Tenant Isolation Enforcement

Isolation is enforced at three layers:

#### Layer 1 — Application (NestJS Guard + Prisma Middleware)

A request-scoped `TenantContext` is set by the JWT guard. A Prisma middleware automatically appends `where: { organizerId: ctx.organizerId }` to all queries issued by organizer-role requests.

```typescript
// Conceptual Prisma middleware
prisma.$use(async (params, next) => {
  const tenantId = tenantContext.organizerId;
  if (tenantId && TENANT_SCOPED_MODELS.includes(params.model)) {
    if (params.action === 'findMany') {
      params.args.where = { ...params.args.where, organizerId: tenantId };
    }
    if (params.action === 'findFirst' || params.action === 'findUnique') {
      params.args.where = { ...params.args.where, organizerId: tenantId };
    }
  }
  return next(params);
});
```

#### Layer 2 — API Route Guards

All organizer routes carry a `@OrganizerOwnership()` decorator that validates:
- The resource's `organizer_id` matches the authenticated user's organizer ID
- Returns `403 Forbidden` on mismatch (not `404`) for audit purposes

#### Layer 3 — Object Storage Key Namespacing

All files stored in R2 follow the pattern:
```
/{organizer_id}/{tournament_id}/{export_job_id}.xlsx
/{organizer_id}/posters/{tournament_id}.jpg
```

Presigned URLs are generated per-request and expire in 15 minutes.

### Super Admin Cross-Tenant Access

The `admin` module bypasses tenant middleware. Queries in admin controllers do **not** include `organizerId` filters. Admin access is gated by the `SUPER_ADMIN` role, enforced at the route decorator level.

---

## 12. Security Architecture

### Authentication Flow

```mermaid
sequenceDiagram
    actor Organizer
    participant API
    participant DB

    Organizer->>API: POST /auth/login {email, password}
    API->>DB: Fetch user by email
    DB-->>API: User record
    API->>API: bcrypt.compare(password, hash)
    API-->>Organizer: {access_token (15min), Set-Cookie: refresh_token (httpOnly, 7d)}

    Note over Organizer,API: Subsequent requests
    Organizer->>API: GET /organizer/tournaments (Authorization: Bearer <access_token>)
    API->>API: Verify JWT signature + expiry
    API->>API: Extract role + organizer_id from payload
    API-->>Organizer: Response

    Note over Organizer,API: Token refresh
    Organizer->>API: POST /auth/refresh (Cookie: refresh_token)
    API->>DB: Validate refresh_token exists + not revoked
    API->>API: Issue new access_token
    API-->>Organizer: {access_token}
```

### Security Controls Matrix

| Control | Mechanism | Status |
|---|---|---|
| Authentication | JWT (RS256 or HS256) | Required from day one |
| Authorization | Role-based guards (`@Roles()`) | Required from day one |
| Token revocation | `refresh_token_sessions` DB table | Required from day one |
| Tenant isolation | TenantContext middleware | Required from day one |
| Payment webhook integrity | HMAC-SHA256 (Razorpay signature) | Required from day one |
| Payment idempotency | Unique `razorpay_payment_id` constraint | Required from day one |
| Input validation | class-validator DTOs on all endpoints | Required from day one |
| SQL injection | Prisma parameterized queries (default) | Inherent, audit raw queries |
| Rate limiting | Cloudflare WAF (edge) + `@nestjs/throttler` (API) | Required |
| CORS policy | Allowlist Next.js domain only | Required |
| Secure cookie flags | `httpOnly`, `Secure`, `SameSite=Strict` | Required |
| File upload validation | MIME type check, max size, extension allowlist | Phase 2 (posters) |
| Admin MFA | TOTP (e.g., Google Authenticator) | Strongly recommended |
| Audit logging | `audit_log` table for sensitive mutations | Required |

### API Rate Limits (Initial)

| Endpoint | Limit | Window |
|---|---|---|
| `POST /auth/login` | 10 requests | 15 min / IP |
| `POST /tournaments/:id/register` | 5 requests | 1 min / IP |
| `POST /payments/webhook` | Cloudflare WAF allowlist Razorpay IPs only | — |
| All other endpoints | 100 requests | 1 min / IP |

---

## 13. API Design Reference

### Conventions

- **Base path:** `/api/v1`
- **Authentication:** `Authorization: Bearer <access_token>`
- **Response envelope:**
  ```json
  { "data": {}, "meta": {}, "error": null }
  ```
- **Pagination:** Cursor-based using `cursor` + `limit` query params
- **Error format:**
  ```json
  { "error": { "code": "TOURNAMENT_NOT_FOUND", "message": "..." }, "data": null }
  ```

### Endpoint Summary

#### Auth
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/login` | None | Organizer/Admin login |
| POST | `/auth/refresh` | Cookie | Refresh access token |
| POST | `/auth/logout` | Bearer | Revoke refresh token |

#### Organizer — Tournaments
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/organizer/tournaments` | Organizer | List own tournaments |
| POST | `/organizer/tournaments` | Organizer | Create tournament + categories |
| GET | `/organizer/tournaments/:id` | Organizer | Get tournament detail |
| PATCH | `/organizer/tournaments/:id` | Organizer | Update tournament |
| GET | `/organizer/tournaments/:id/registrations` | Organizer | List confirmed registrations |
| POST | `/organizer/tournaments/:id/exports` | Organizer | Trigger async export |
| GET | `/organizer/exports/:jobId` | Organizer | Poll export status + get download URL |

#### Player — Public
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/tournaments` | None | List approved public tournaments |
| GET | `/tournaments/:id` | None | Tournament detail + categories |
| POST | `/tournaments/:id/categories/:catId/register` | None | Submit registration + create payment order |
| GET | `/registrations/:id/status` | None (entry_number) | Check registration status |

#### Payments
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/payments/webhook` | None (HMAC) | Razorpay webhook receiver |

#### Admin
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/admin/tournaments` | Super Admin | List all tournaments (filterable by status) |
| PATCH | `/admin/tournaments/:id/status` | Super Admin | Approve or reject tournament |
| GET | `/admin/organizers` | Super Admin | List organizers |
| PATCH | `/admin/organizers/:id/verify` | Super Admin | Activate organizer account |
| GET | `/admin/analytics` | Super Admin | Platform-level metrics |

---

## 14. Scaling Strategy

### Phase 1 — MVP (0–50 organizers, 50K registrations/year)

```
Single Docker host (2 vCPU / 4 GB RAM):
  - 1× API container
  - 1× Worker container
  - 1× PgBouncer container

Managed PostgreSQL (single instance, 2 vCPU / 4 GB)
Managed Redis (single instance)
Cloudflare R2 (object storage)
Vercel (frontend)
```

- Handles peak load of ~100 concurrent users easily
- PgBouncer in **transaction pooling mode** limits connections to 10–20 actual Postgres connections

### Phase 2 — Growth (50–500 organizers, 500K registrations/year)

```
Load-balanced Docker host or managed container platform:
  - 2–4× API containers (horizontal scale)
  - 2× Worker containers
  - Nginx or cloud load balancer

PostgreSQL: add 1 read replica (analytics, dashboard queries go to replica)
Redis: Redis Sentinel or Upstash (HA)
```

- API scaled horizontally (stateless — JWT, Redis session cache)
- Worker scaled separately based on queue depth
- Admin analytics queries moved to read replica

### Phase 3 — Platform Scale (1,000+ organizers, 2M+ registrations)

```
Managed container platform (ECS / Cloud Run / Fly.io):
  - Autoscaling API fleet
  - Dedicated worker fleet

PostgreSQL:
  - Table partitioning on registrations and payments (by created_at month)
  - Connection pooling via PgBouncer (horizontal)
  
Analytics:
  - Materialized views or dedicated reporting schema
  - Consider ClickHouse / DuckDB for heavy analytics
```

---

## 15. Development Roadmap

### Phase 1 — MVP (Recommended Build Order)

| Step | Module | Deliverable |
|---|---|---|
| 1 | Database | Prisma schema + initial migration |
| 2 | Auth | JWT login, refresh, role guards |
| 3 | Users / Organizers | Organizer registration + admin verification |
| 4 | Tournaments | Tournament CRUD + categories |
| 5 | Admin | Approval/rejection workflow |
| 6 | Registrations | Player form + seat locking |
| 7 | Payments | Razorpay order creation + webhook handler |
| 8 | Notifications | Email on confirmation (basic) |
| 9 | Reports | Async Excel export + R2 upload |
| 10 | Frontend | Organizer dashboard + player registration form |

### Phase 2 — Platform Expansion

- Tournament discovery with city-based search
- QR code check-in generation
- Player profiles (optional accounts)
- Organizer verification documents upload
- WhatsApp notification integration (requires Meta approval process — start early)

### Phase 3 — Advanced Platform

- Swiss pairing format export
- Live tournament results
- National rating integration
- Mobile app (React Native)
- Organizer subscription billing

---

## 16. Open Decisions

The following decisions are **pending product owner sign-off** before implementation begins. Confirmed decisions are also recorded here for reference.

### Pending Decisions

| # | Topic | Options | Architectural Impact |
|---|---|---|---|
| 1 | **Payment collection model** | **Option A:** Platform collects full fee, manually transfers net amount to organizer. **Option B:** Razorpay Route auto-splits at payment time. | Option A is simpler to implement (MVP-safe). Option B requires Razorpay Route setup, organizer bank account KYC, and changes the payment schema to include `transfer_id`. Affects GST treatment and settlement timing. |
| 2 | **Refund workflow** | **MVP:** Admin-initiated manual refunds via Razorpay dashboard (no system automation). **Phase 2:** Organizer-initiated refund requests tracked in system. | MVP manual refunds: no `RefundRequests` table needed. Payment `status` column must still support `REFUNDED` as a manually-set terminal state updated by admin. |
| 3 | **Player accounts** | **MVP:** Anonymous registration (form-only, no account required). **Phase 2:** Optional player profile linked to registration history. | For forward compatibility, include a nullable `player_user_id FK` column in `registrations` from the start. Do not enforce it in MVP. |
| 4 | **Notification channels** | **MVP:** Email only (SendGrid / AWS SES). **Phase 2:** SMS and/or WhatsApp (MSG91 / Meta Business API). | WhatsApp requires 4–6 week Meta approval — initiate the process before Phase 2 begins. Notification module must be designed with a pluggable channel abstraction from day one. |
| 5 | **FIDE ID validation** | **MVP:** Self-declared — accepted as-is, stored without verification. **Phase 2:** Optionally validate against FIDE public data. | No FIDE API integration needed for MVP. Store `fide_id` as a `VARCHAR` nullable field. Validation can be added as an async background check later without schema changes. |
| 6 | **GST / invoicing** | Applicable when Phase 3 subscription billing is introduced. Not an MVP concern. | Requires GST registration and invoice generation module. Defer to Phase 3 planning. |

---

## 17. Observability Architecture

A production system is unmanageable without structured observability. This section defines the three pillars: **Logs, Metrics, and Traces**, plus error alerting.

### 17.1 Structured Logging

**Library:** [Pino](https://getpino.io/) (preferred over Winston for NestJS — 5–10× faster, JSON-native)

NestJS integration:

```typescript
// main.ts
import { Logger } from 'nestjs-pino';
const app = await NestFactory.create(AppModule, { bufferLogs: true });
app.useLogger(app.get(Logger));
```

**Log format (JSON, all environments):**

```json
{
  "level": "info",
  "time": "2026-03-05T15:42:01.123Z",
  "pid": 1,
  "hostname": "api-container-1",
  "req": { "method": "POST", "url": "/api/v1/payments/webhook", "id": "req-abc" },
  "res": { "statusCode": 200 },
  "responseTime": 42,
  "organizerId": "uuid",
  "tournamentId": "uuid",
  "msg": "Payment webhook processed"
}
```

**Log levels by environment:**

| Environment | Level | Output |
|---|---|---|
| `local` | `debug` | stdout (pretty-printed) |
| `staging` | `info` | stdout (JSON) |
| `production` | `info` | stdout (JSON) → collected by host log agent |

**Sensitive data policy:** Passwords, payment secrets, and card data must **never** appear in logs. Use a Pino `redact` config:

```typescript
PinoLogger.forRoot({
  pinoHttp: {
    redact: ['req.headers.authorization', 'req.body.password', 'req.body.razorpay_signature']
  }
})
```

### 17.2 Error Tracking

**Service:** [Sentry](https://sentry.io) (cloud-hosted, free tier sufficient for MVP)

Integration points:
- NestJS global exception filter → captures all unhandled exceptions
- BullMQ worker → captures job failure stack traces with job payload context
- Frontend (Next.js) → `@sentry/nextjs` for client-side error capture

**What Sentry captures:**
- Unhandled API exceptions with request context (URL, method, user ID)
- BullMQ job failures with job name, data, and attempt number
- Frontend errors with component stack
- Performance traces (slow API endpoints, slow DB queries)

**Alert threshold:** Any new error group in `production` environment triggers a Slack / email alert.

### 17.3 Metrics & Monitoring

**Stack:** Prometheus (metrics scraping) + Grafana (dashboards)

> For MVP, a hosted alternative like **Grafana Cloud** (generous free tier) or **Railway's built-in metrics** removes the operational overhead of self-hosting Prometheus.

**Metrics exposed by the API (`/metrics` endpoint — internal only):**

| Metric | Type | Description |
|---|---|---|
| `http_request_duration_seconds` | Histogram | API latency by route + status code |
| `http_requests_total` | Counter | Request count by route + method |
| `bullmq_jobs_active` | Gauge | Active jobs per queue |
| `bullmq_jobs_failed_total` | Counter | Failed jobs per queue |
| `bullmq_jobs_completed_total` | Counter | Completed jobs per queue |
| `db_pool_connections_active` | Gauge | PgBouncer active connections |
| `db_pool_connections_waiting` | Gauge | PgBouncer queued connections |

**Key Grafana dashboards to build:**

1. **API Health** — request rate, error rate (5xx), p50/p95/p99 latency
2. **Queue Health** — job queue depths, failure rates, DLQ depth
3. **Registration Funnel** — registrations created vs. confirmed vs. failed per hour
4. **Payment Health** — payment success rate, reconciled payments rate

**Alerting rules (minimum for production):**

| Alert | Condition | Severity |
|---|---|---|
| API error rate high | 5xx rate > 1% over 5 min | Critical |
| API latency high | p95 > 2 s over 5 min | Warning |
| DLQ has items | `bullmq_dlq_depth` > 0 | Critical |
| DB connections near limit | `db_pool_connections_waiting` > 5 | Warning |
| Payment reconciliation failed | Reconcile job in DLQ | Critical |

### 17.4 Observability Stack Diagram

```mermaid
graph LR
    API["API Container"] -->|"stdout JSON logs"| LogAgent["Log Agent\n(Promtail / Datadog Agent)"]
    Worker["Worker Container"] -->|"stdout JSON logs"| LogAgent
    LogAgent --> Loki["Grafana Loki\n(Log Storage)"]
    API -->|"Sentry SDK"| Sentry["Sentry\n(Error Tracking)"]
    Worker -->|"Sentry SDK"| Sentry
    API -->|"/metrics scrape"| Prometheus["Prometheus\n(Metrics)"]
    Prometheus --> Grafana["Grafana\n(Dashboards + Alerts)"]
    Loki --> Grafana
    Grafana -->|"Alerts"| Slack["Slack / Email\n(On-call alerts)"]
```

---

## 18. Backup Strategy

### 18.1 PostgreSQL Backup Policy

| Parameter | Value |
|---|---|
| Backup type | Automated daily snapshots + continuous WAL archiving |
| Snapshot frequency | Daily (managed by hosting provider) |
| Retention period | **7 days minimum** (30 days recommended for production) |
| Point-in-time recovery | **Required** — enables recovery to any second within the retention window |
| Backup storage | S3-compatible storage in a **different availability zone** from the database |
| Encryption | AES-256 at rest |

**Managed Postgres providers that satisfy this policy by default:**
- [Neon](https://neon.tech) — serverless Postgres with instant branching and PITR
- [Railway](https://railway.app) — automated daily snapshots, 7-day retention
- [Supabase](https://supabase.com) — daily backups, PITR on Pro plan

**Restore procedure (must be tested quarterly):**

```
1. Provision a new Postgres instance from the provider console
2. Trigger restore to the target snapshot or point-in-time
3. Update DATABASE_URL in the staging environment to point to the restored instance
4. Run smoke tests: auth, tournament query, registration query, payment query
5. Confirm row counts match expected ranges
6. Document restore duration (target: < 30 minutes RTO)
```

### 18.2 Redis Backup Policy

Redis holds **ephemeral queues and cache** — not the system of record. However, BullMQ job data in Redis represents in-flight work that, if lost, requires manual reconciliation.

| Parameter | Value |
|---|---|
| Persistence mode | **RDB** snapshots every 15 minutes (default) |
| AOF (append-only file) | Optional — enable for queue durability in production |
| Retention | Not a primary backup concern; jobs are designed to be re-queueable |
| Managed service recommendation | Upstash Redis (persistent, HA, free tier available) |

**On Redis failure:** The API continues to function (auth, DB reads/writes). Background jobs stop until Redis recovers. Payment reconciliation must be manually triggered after recovery if the Redis outage exceeded 15 minutes.

### 18.3 Object Storage (Cloudflare R2)

Cloudflare R2 provides **11 nines (99.999999999%) durability** natively — no additional backup configuration is required for MVP.

For generated export files (Excel, CSV): these are **reproducible** — if a file is lost, the export job can be re-triggered by the organizer at no cost.

### 18.4 Recovery Objectives (MVP Targets)

| Objective | Target |
|---|---|
| **RPO** (Recovery Point Objective) — max data loss | < 15 minutes |
| **RTO** (Recovery Time Objective) — restore time | < 60 minutes |

---

## 19. CI/CD Pipeline

### 19.1 Pipeline Overview

**Platform:** GitHub Actions

Two pipelines:
1. **CI Pipeline** — runs on every pull request to `main`
2. **CD Pipeline** — runs on merge to `main` (deploys to staging) or on a release tag (deploys to production)

### 19.2 CI Pipeline (Pull Request)

```mermaid
flowchart LR
    PR["Pull Request\nopened / updated"]
    Lint["✅ Lint\n(ESLint + Prettier)"]
    TypeCheck["✅ Type Check\n(tsc --noEmit)"]
    Test["✅ Unit Tests\n(Jest)"]
    Build["✅ Docker Build\n(verify image compiles)"]
    PR --> Lint --> TypeCheck --> Test --> Build
```

**GitHub Actions workflow (CI):**

```yaml
# .github/workflows/ci.yml
name: CI
on:
  pull_request:
    branches: [main]

jobs:
  ci:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
      redis:
        image: redis:7
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run lint
      - run: npm run type-check
      - run: npm run test
        env:
          DATABASE_URL: postgresql://postgres:test@localhost:5432/test
          REDIS_URL: redis://localhost:6379
      - name: Build Docker image (API)
        run: docker build -f Dockerfile.api -t chess-api:ci .
      - name: Build Docker image (Worker)
        run: docker build -f Dockerfile.worker -t chess-worker:ci .
```

### 19.3 CD Pipeline (Deploy)

```mermaid
flowchart LR
    Merge["Merge to main"]
    Tag["OR: Release tag v*"]
    BuildPush["🐳 Build & Push\nDocker images\nto GHCR"]
    MigrateDB["🗄️ Run DB Migrations\nprisma migrate deploy"]
    DeployStaging["🚀 Deploy to Staging"]
    SmokeTest["🧪 Smoke Tests\n(health check endpoints)"]
    DeployProd["🚀 Deploy to Production\n(tag only)"]

    Merge --> BuildPush --> MigrateDB --> DeployStaging --> SmokeTest
    Tag --> BuildPush
    SmokeTest -->|"tag pipeline"| DeployProd
```

**GitHub Actions workflow (CD):**

```yaml
# .github/workflows/cd.yml
name: CD
on:
  push:
    branches: [main]
    tags: ['v*']

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Build and push API image
        uses: docker/build-push-action@v5
        with:
          file: Dockerfile.api
          push: true
          tags: ghcr.io/${{ github.repository }}/api:${{ github.sha }}
      - name: Build and push Worker image
        uses: docker/build-push-action@v5
        with:
          file: Dockerfile.worker
          push: true
          tags: ghcr.io/${{ github.repository }}/worker:${{ github.sha }}

  deploy-staging:
    needs: build-and-push
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - name: Run Prisma migrations (staging)
        run: npx prisma migrate deploy
        env:
          DATABASE_URL: ${{ secrets.STAGING_DATABASE_URL }}
      - name: Deploy to staging host
        run: |
          # SSH into staging host and pull + restart containers
          ssh deploy@${{ secrets.STAGING_HOST }} \
            "docker pull ghcr.io/${{ github.repository }}/api:${{ github.sha }} && \
             docker pull ghcr.io/${{ github.repository }}/worker:${{ github.sha }} && \
             docker compose up -d"

  deploy-production:
    needs: deploy-staging
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    environment: production
    steps:
      - name: Run Prisma migrations (production)
        run: npx prisma migrate deploy
        env:
          DATABASE_URL: ${{ secrets.PROD_DATABASE_URL }}
      - name: Deploy to production host
        run: |
          ssh deploy@${{ secrets.PROD_HOST }} \
            "docker pull ghcr.io/${{ github.repository }}/api:${{ github.sha }} && \
             docker pull ghcr.io/${{ github.repository }}/worker:${{ github.sha }} && \
             docker compose up -d"
```

### 19.4 Container Image Structure

Two separate Dockerfiles:

| Image | File | Entry point | Purpose |
|---|---|---|---|
| `chess-api` | `Dockerfile.api` | `node dist/main.js` | HTTP API server |
| `chess-worker` | `Dockerfile.worker` | `node dist/worker.js` | BullMQ job processor |

Both images share the same codebase (monorepo). The entry point determines which NestJS application instance starts.

### 19.5 Secrets Management

| Secret | Stored in | Injected via |
|---|---|---|
| `DATABASE_URL` | GitHub Secrets (per environment) | Docker env variable |
| `RAZORPAY_KEY_SECRET` | GitHub Secrets | Docker env variable |
| `JWT_ACCESS_SECRET` | GitHub Secrets | Docker env variable |
| `SENTRY_DSN` | GitHub Secrets | Docker env variable |
| All other env vars | GitHub Secrets | Docker env variable |

**Rule:** No secrets are ever committed to the repository. `.env` files are `.gitignore`d. Local development uses a `.env.local` file copied from `.env.example`.

---

## 20. Environment Topology

### 20.1 Environment Overview

Three environments are maintained:

| Environment | Purpose | Trigger | Access |
|---|---|---|---|
| `local` | Developer workstation | Manual (`docker compose up`) | Developer only |
| `staging` | Integration testing, QA, demo | Merge to `main` | Team + stakeholders |
| `production` | Live system | Release tag (`v*`) | Public |

### 20.2 Environment Comparison

| Component | Local | Staging | Production |
|---|---|---|---|
| Frontend | `localhost:3000` (Next.js dev server) | Vercel preview deployment | Vercel production deployment |
| API | `localhost:3001` (NestJS dev server) | Single Docker container on staging VPS | 1–2 Docker containers on production VPS |
| Worker | `localhost:3001` (same process, dev) | Separate Docker container | Separate Docker container |
| PostgreSQL | Local Docker container | Managed DB (staging instance) | Managed DB (production instance — isolated) |
| Redis | Local Docker container | Managed Redis (staging) | Managed Redis (production) |
| Object Storage | MinIO (local Docker) | Cloudflare R2 (staging bucket) | Cloudflare R2 (production bucket) |
| Payments | Razorpay **test** keys | Razorpay **test** keys | Razorpay **live** keys |
| Email | Mailtrap (captured, not delivered) | SendGrid (delivered to test inbox) | SendGrid (delivered to real users) |
| Sentry | Disabled | `staging` environment | `production` environment |
| Log level | `debug` | `info` | `info` |

### 20.3 Staging Environment Rules

- Staging **always** uses Razorpay test keys — never live payment credentials
- Staging database is **fully isolated** from production — no shared data
- Staging is reset with a fresh dataset before major feature releases
- Staging deployments are **automatic** (every merge to `main`)
- Staging URL follows pattern: `staging.chesstournament.in` (internal)

### 20.4 Production Deployment Rules

- Production deployments are **tag-gated** — only a `v*` tag triggers production deploy
- Database migrations run **before** the new API containers start (zero-downtime migrations enforced via additive-only schema changes)
- Rollback procedure: redeploy the previous image tag. DB migrations must be backwards-compatible with the previous API version
- Production environment variables are managed exclusively through the CI/CD secrets store — never edited manually on the server

### 20.5 Local Development Setup

```yaml
# docker-compose.dev.yml
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: chess_tournament
      POSTGRES_PASSWORD: localpassword
    ports: ['5432:5432']
    volumes: ['pgdata:/var/lib/postgresql/data']

  redis:
    image: redis:7
    ports: ['6379:6379']

  minio:
    image: minio/minio
    command: server /data --console-address ':9001'
    ports: ['9000:9000', '9001:9001']
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    volumes: ['miniodata:/data']

volumes:
  pgdata:
  miniodata:
```

Developer onboarding:

```bash
# 1. Start infrastructure
docker compose -f docker-compose.dev.yml up -d

# 2. Copy env template
cp .env.example .env.local

# 3. Run database migrations
npx prisma migrate dev

# 4. Seed initial admin account
npx prisma db seed

# 5. Start API server
npm run start:dev
```

---

*Document Version: 2.1 | Last Updated: 2026-03-05 | Owner: Easy Chess Academy*
