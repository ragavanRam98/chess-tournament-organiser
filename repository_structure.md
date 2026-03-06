# Repository Structure
## Chess Tournament Entry Platform — Monorepo Layout

```
chess-tournament/
├── .github/
│   └── workflows/
│       ├── ci.yml                    # Lint, type-check, test, Docker build (PRs)
│       └── cd.yml                    # Build, push, migrate, deploy (main + tags)
│
├── apps/
│   ├── api/                          # NestJS API server
│   │   ├── src/
│   │   │   ├── main.ts               # Bootstrap: NestFactory, Pino logger, global prefix /api/v1
│   │   │   ├── app.module.ts         # Root module — imports all feature modules
│   │   │   │
│   │   │   ├── auth/
│   │   │   │   ├── auth.module.ts
│   │   │   │   ├── auth.controller.ts     # POST /auth/login, /auth/refresh, /auth/logout
│   │   │   │   ├── auth.service.ts        # JWT issue, bcrypt verify, refresh token management
│   │   │   │   ├── strategies/
│   │   │   │   │   └── jwt.strategy.ts    # Passport JWT strategy
│   │   │   │   ├── guards/
│   │   │   │   │   ├── jwt-auth.guard.ts
│   │   │   │   │   └── roles.guard.ts     # @Roles() decorator enforcement
│   │   │   │   └── dto/
│   │   │   │       └── login.dto.ts
│   │   │   │
│   │   │   ├── users/
│   │   │   │   ├── users.module.ts
│   │   │   │   ├── users.controller.ts
│   │   │   │   ├── users.service.ts
│   │   │   │   └── dto/
│   │   │   │       ├── create-organizer.dto.ts
│   │   │   │       └── update-organizer.dto.ts
│   │   │   │
│   │   │   ├── tournaments/
│   │   │   │   ├── tournaments.module.ts
│   │   │   │   ├── tournaments.controller.ts   # Organizer tournament CRUD
│   │   │   │   ├── tournaments.service.ts      # Status machine, cancellation logic
│   │   │   │   ├── categories.service.ts       # Category management
│   │   │   │   └── dto/
│   │   │   │       ├── create-tournament.dto.ts
│   │   │   │       ├── update-tournament.dto.ts
│   │   │   │       └── create-category.dto.ts
│   │   │   │
│   │   │   ├── registrations/
│   │   │   │   ├── registrations.module.ts
│   │   │   │   ├── registrations.controller.ts  # POST register, GET status by entry number
│   │   │   │   ├── registrations.service.ts     # Age validation, duplicate check, seat lock, phone rate limit
│   │   │   │   └── dto/
│   │   │   │       └── create-registration.dto.ts
│   │   │   │
│   │   │   ├── payments/
│   │   │   │   ├── payments.module.ts
│   │   │   │   ├── payments.controller.ts      # POST /payments/webhook
│   │   │   │   ├── payments.service.ts         # Razorpay order creation, HMAC verification, state machine
│   │   │   │   └── razorpay/
│   │   │   │       └── razorpay.service.ts     # Razorpay SDK wrapper
│   │   │   │
│   │   │   ├── reports/
│   │   │   │   ├── reports.module.ts
│   │   │   │   ├── reports.controller.ts       # POST /exports, GET /exports/:jobId
│   │   │   │   └── reports.service.ts          # Job enqueue, presigned URL generation
│   │   │   │
│   │   │   ├── notifications/
│   │   │   │   ├── notifications.module.ts
│   │   │   │   └── notifications.service.ts    # Email job dispatch, template resolution
│   │   │   │
│   │   │   ├── admin/
│   │   │   │   ├── admin.module.ts
│   │   │   │   ├── admin.controller.ts         # /admin/* routes — Super Admin only
│   │   │   │   └── admin.service.ts            # Status transitions, audit log, analytics queries
│   │   │   │
│   │   │   ├── queue/
│   │   │   │   ├── queue.module.ts             # BullMQ module config (Redis connection, queue definitions)
│   │   │   │   ├── queue.service.ts            # Shared producer — add(queueName, jobName, data)
│   │   │   │   └── queue.constants.ts          # Queue name + job name enums
│   │   │   │
│   │   │   ├── tenant/
│   │   │   │   ├── tenant.module.ts
│   │   │   │   ├── tenant.middleware.ts        # Extracts organizerId from JWT, stores in AsyncLocalStorage
│   │   │   │   └── tenant-ownership.guard.ts  # @OrganizerOwnership() guard
│   │   │   │
│   │   │   ├── storage/
│   │   │   │   ├── storage.module.ts
│   │   │   │   └── storage.service.ts         # R2 upload, presigned URL generation
│   │   │   │
│   │   │   └── common/
│   │   │       ├── decorators/
│   │   │       │   ├── roles.decorator.ts
│   │   │       │   └── organizer-ownership.decorator.ts
│   │   │       ├── filters/
│   │   │       │   └── global-exception.filter.ts   # Sentry capture + standardized error envelope
│   │   │       ├── interceptors/
│   │   │       │   └── response-transform.interceptor.ts  # Wraps all responses in { data: ... }
│   │   │       └── pipes/
│   │   │           └── validation.pipe.ts
│   │   │
│   │   └── test/
│   │       ├── auth.e2e-spec.ts
│   │       ├── tournaments.e2e-spec.ts
│   │       └── registrations.e2e-spec.ts
│   │
│   ├── worker/                       # NestJS BullMQ Worker (separate Docker container)
│   │   ├── src/
│   │   │   ├── worker.ts             # Bootstrap worker-only NestJS app
│   │   │   ├── worker.module.ts      # Imports only queue consumers and their dependencies
│   │   │   │
│   │   │   ├── processors/
│   │   │   │   ├── export.processor.ts          # GENERATE_EXPORT: query DB, ExcelJS, upload R2
│   │   │   │   ├── notification.processor.ts    # SEND_EMAIL: SendGrid dispatch
│   │   │   │   ├── payment-reconcile.processor.ts  # PAYMENT_RECONCILE: Razorpay polling
│   │   │   │   ├── seat-expiry.processor.ts     # PURGE_EXPIRED_REGISTRATIONS: cancel + decrement
│   │   │   │   └── cleanup-exports.processor.ts # CLEANUP_EXPORT_FILES: R2 delete + DB null
│   │   │   │
│   │   │   └── templates/
│   │   │       ├── registration-confirmed.html
│   │   │       ├── tournament-approved.html
│   │   │       ├── tournament-cancelled.html
│   │   │       └── tournament-reminder.html
│   │   │
│   │   └── test/
│   │       └── export.processor.spec.ts
│   │
│   └── web/                          # Next.js frontend
│       ├── src/
│       │   ├── app/                  # Next.js App Router
│       │   │   ├── layout.tsx
│       │   │   ├── page.tsx                      # Public tournament listing
│       │   │   ├── tournaments/
│       │   │   │   ├── [id]/
│       │   │   │   │   ├── page.tsx              # Tournament detail
│       │   │   │   │   └── register/
│       │   │   │   │       └── page.tsx          # Registration form + Razorpay checkout
│       │   │   ├── registration/
│       │   │   │   └── [entryNumber]/
│       │   │   │       └── page.tsx              # Registration status / confirmation page
│       │   │   ├── organizer/
│       │   │   │   ├── login/page.tsx
│       │   │   │   ├── dashboard/page.tsx
│       │   │   │   ├── tournaments/
│       │   │   │   │   ├── page.tsx              # Tournament list
│       │   │   │   │   ├── new/page.tsx          # Create tournament
│       │   │   │   │   └── [id]/
│       │   │   │   │       ├── page.tsx          # Tournament detail
│       │   │   │   │       └── registrations/page.tsx
│       │   │   └── admin/
│       │   │       ├── page.tsx                  # Admin dashboard
│       │   │       ├── tournaments/page.tsx       # Pending approval list
│       │   │       ├── organizers/page.tsx        # Organizer verification
│       │   │       └── audit-logs/page.tsx        # Audit log viewer
│       │   │
│       │   ├── components/
│       │   │   ├── ui/               # Generic: Button, Input, Modal, Table, Badge
│       │   │   ├── tournament/       # TournamentCard, TournamentStatus, CategoryBadge
│       │   │   ├── registration/     # RegistrationForm, PaymentInfo, ConfirmationCard
│       │   │   └── layout/           # Navbar, Sidebar, Footer
│       │   │
│       │   ├── lib/
│       │   │   ├── api.ts            # Typed fetch wrapper around /api/v1
│       │   │   ├── auth.ts           # Client-side auth state + token management
│       │   │   └── razorpay.ts       # Razorpay checkout loader utility
│       │   │
│       │   └── hooks/
│       │       ├── use-tournaments.ts
│       │       ├── use-registrations.ts
│       │       └── use-export-job.ts   # Polling hook for export job status
│       │
│       └── public/
│
├── packages/
│   └── shared/                       # Shared TypeScript types (imported by api + web)
│       ├── src/
│       │   ├── types/
│       │   │   ├── tournament.ts     # TournamentStatus enum, Tournament interface
│       │   │   ├── registration.ts   # RegistrationStatus enum
│       │   │   ├── payment.ts        # PaymentStatus enum
│       │   │   └── api.ts            # ApiResponse<T>, PaginatedResponse<T>, ErrorCode enum
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
│
├── prisma/
│   ├── schema.prisma                 # Single source of truth for DB schema
│   ├── migrations/                   # Generated migration files (committed)
│   │   └── 20260306_init/
│   │       └── migration.sql
│   └── seed.ts                       # Seeds super admin account + example data
│
├── docker/
│   ├── Dockerfile.api                # Multi-stage build: node:20-alpine
│   ├── Dockerfile.worker             # Multi-stage build: node:20-alpine
│   └── nginx.conf                    # Reverse proxy config
│
├── docker-compose.dev.yml            # Local dev: Postgres, Redis, MinIO
├── docker-compose.prod.yml           # Production: API, Worker, PgBouncer, Nginx
│
├── .env.example                      # Template — all required env vars listed, no values
├── .gitignore                        # Includes .env, .env.local, dist/, node_modules/
│
├── package.json                      # Monorepo root — npm workspaces
├── turbo.json                        # Turborepo pipeline (build, test, lint)
├── tsconfig.base.json                # Shared TypeScript config
└── README.md
```

---

## Monorepo Tooling

| Concern | Tool |
|---|---|
| Monorepo management | npm Workspaces + Turborepo |
| TypeScript compilation | tsc (each app has own `tsconfig.json` extending base) |
| Linting | ESLint + `@typescript-eslint` + Prettier |
| Testing | Jest (unit) + Supertest (API e2e) |
| Build cache | Turborepo remote cache |

---

## Docker Multi-Stage Build Pattern

Both `Dockerfile.api` and `Dockerfile.worker` use the same pattern:

```dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci
COPY . .
RUN npm run build:api     # or build:worker

# Stage 2: Production image
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
EXPOSE 3001
CMD ["node", "dist/main.js"]   # or dist/worker.js
```

---

## Key Configuration Files

### `prisma/schema.prisma` excerpt

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")      // PgBouncer URL for app
  directUrl = env("DIRECT_URL")        // Direct Postgres URL for prisma migrate
}

enum TournamentStatus {
  DRAFT
  PENDING_APPROVAL
  APPROVED
  ACTIVE
  CLOSED
  REJECTED
  CANCELLED
}

enum RegistrationStatus {
  PENDING_PAYMENT
  CONFIRMED
  FAILED
  CANCELLED
}

enum PaymentStatus {
  INITIATED
  PENDING
  PAID
  FAILED
  REFUNDED
}
```

### `turbo.json`

```json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "test": { "dependsOn": ["build"] },
    "lint": {},
    "type-check": {}
  }
}
```
