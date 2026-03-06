# Database Migration Plan
## Chess Tournament Entry Platform — v2.2

---

## Migration Strategy

- **Tool:** Prisma Migrate (`prisma migrate dev` for local, `prisma migrate deploy` in CI/CD)
- **Pattern:** Additive-only changes. Never drop columns or rename columns in a single migration — always add new, migrate data, then remove in a subsequent release.
- **Execution:** Migrations run automatically in the CD pipeline **before** new API containers start. If migration fails, deployment halts — no code rollout occurs.
- **Bypass PgBouncer:** Prisma Migrate must use `DIRECT_URL` (direct Postgres connection) — not the PgBouncer URL — because migrations are DDL and require session-mode connections.

---

## Migration 001 — Initial Schema

**File:** `prisma/migrations/20260306_001_init/migration.sql`

**Creates:** All core entities for MVP.

```sql
-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enums
CREATE TYPE user_role AS ENUM ('SUPER_ADMIN', 'ORGANIZER');
CREATE TYPE user_status AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED');
CREATE TYPE tournament_status AS ENUM (
  'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'CLOSED', 'REJECTED', 'CANCELLED'
);
CREATE TYPE registration_status AS ENUM ('PENDING_PAYMENT', 'CONFIRMED', 'FAILED', 'CANCELLED');
CREATE TYPE payment_status AS ENUM ('INITIATED', 'PENDING', 'PAID', 'FAILED', 'REFUNDED');
CREATE TYPE export_format AS ENUM ('XLSX', 'CSV');
CREATE TYPE export_status AS ENUM ('QUEUED', 'PROCESSING', 'DONE', 'FAILED', 'EXPIRED');
CREATE TYPE notification_channel AS ENUM ('EMAIL');
CREATE TYPE notification_type AS ENUM (
  'REGISTRATION_CONFIRMED', 'PAYMENT_CONFIRMED',
  'TOURNAMENT_APPROVED', 'TOURNAMENT_CANCELLED', 'REMINDER'
);
CREATE TYPE notification_status AS ENUM ('QUEUED', 'SENT', 'FAILED');
CREATE TYPE audit_action AS ENUM (
  'APPROVED', 'REJECTED', 'CANCELLED', 'VERIFIED', 'SUSPENDED',
  'PAYMENT_CONFIRMED', 'REFUNDED'
);

-- Users
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          user_role NOT NULL,
  status        user_status NOT NULL DEFAULT 'PENDING_VERIFICATION',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Refresh token sessions (for JWT revocation)
CREATE TABLE refresh_token_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    VARCHAR(255) NOT NULL UNIQUE,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_rts_user ON refresh_token_sessions(user_id);
CREATE INDEX idx_rts_expires ON refresh_token_sessions(expires_at);

-- Organizers
CREATE TABLE organizers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  academy_name  VARCHAR(255) NOT NULL,
  contact_phone VARCHAR(20) NOT NULL,
  city          VARCHAR(100) NOT NULL,
  state         VARCHAR(100),
  description   TEXT,
  verified_at   TIMESTAMPTZ,
  verified_by   UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tournaments
CREATE TABLE tournaments (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id            UUID NOT NULL REFERENCES organizers(id),
  title                   VARCHAR(255) NOT NULL,
  description             TEXT,
  city                    VARCHAR(100) NOT NULL,
  venue                   VARCHAR(255) NOT NULL,
  start_date              DATE NOT NULL,
  end_date                DATE NOT NULL,
  registration_deadline   DATE NOT NULL,
  status                  tournament_status NOT NULL DEFAULT 'DRAFT',
  rejection_reason        TEXT,
  cancellation_reason     TEXT,
  approved_at             TIMESTAMPTZ,
  approved_by             UUID REFERENCES users(id),
  cancelled_at            TIMESTAMPTZ,
  cancelled_by            UUID REFERENCES users(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tournaments_organizer ON tournaments(organizer_id);
CREATE INDEX idx_tournaments_status ON tournaments(status);
CREATE INDEX idx_tournaments_start_date ON tournaments(start_date);

-- Categories
CREATE TABLE categories (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id     UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name              VARCHAR(50) NOT NULL,
  min_age           INT NOT NULL DEFAULT 0,
  max_age           INT NOT NULL DEFAULT 999,
  entry_fee_paise   INT NOT NULL DEFAULT 0,
  max_seats         INT NOT NULL,
  registered_count  INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_age_range CHECK (min_age <= max_age),
  CONSTRAINT chk_seats CHECK (max_seats >= 1),
  CONSTRAINT chk_registered CHECK (registered_count >= 0)
);
CREATE INDEX idx_categories_tournament ON categories(tournament_id);

-- Entry number sequence (human-readable)
CREATE SEQUENCE entry_number_seq START 1;

-- Registrations
CREATE TABLE registrations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id     UUID NOT NULL REFERENCES tournaments(id),
  category_id       UUID NOT NULL REFERENCES categories(id),
  player_user_id    UUID REFERENCES users(id),  -- nullable, Phase 2
  player_name       VARCHAR(255) NOT NULL,
  player_dob        DATE NOT NULL,
  phone             VARCHAR(20) NOT NULL,
  email             VARCHAR(255),
  city              VARCHAR(100),
  fide_id           VARCHAR(20),
  fide_rating       INT,
  status            registration_status NOT NULL DEFAULT 'PENDING_PAYMENT',
  entry_number      VARCHAR(30) NOT NULL UNIQUE
                    DEFAULT 'ECA-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(NEXTVAL('entry_number_seq')::TEXT, 6, '0'),
  registered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at      TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ  -- PENDING_PAYMENT entries expire 2h after creation
);
CREATE INDEX idx_reg_tournament ON registrations(tournament_id);
CREATE INDEX idx_reg_tournament_status ON registrations(tournament_id, status);
CREATE INDEX idx_reg_phone_tournament ON registrations(phone, tournament_id);
CREATE INDEX idx_reg_expires ON registrations(expires_at) WHERE status = 'PENDING_PAYMENT';

-- Payments
CREATE TABLE payments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id       UUID NOT NULL UNIQUE REFERENCES registrations(id),
  razorpay_order_id     VARCHAR(100) NOT NULL UNIQUE,
  razorpay_payment_id   VARCHAR(100) UNIQUE,  -- null until payment captured
  amount_paise          INT NOT NULL,
  currency              VARCHAR(10) NOT NULL DEFAULT 'INR',
  status                payment_status NOT NULL DEFAULT 'INITIATED',
  gateway_response      JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pay_order_id ON payments(razorpay_order_id);
CREATE INDEX idx_pay_payment_id ON payments(razorpay_payment_id);
CREATE INDEX idx_pay_registration ON payments(registration_id);
CREATE INDEX idx_pay_status_created ON payments(status, created_at) WHERE status IN ('INITIATED', 'PENDING');

-- Audit log
CREATE TABLE audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type   VARCHAR(50) NOT NULL,
  entity_id     UUID NOT NULL,
  action        audit_action NOT NULL,
  old_value     JSONB,
  new_value     JSONB,
  performed_by  UUID REFERENCES users(id),
  performed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_performer ON audit_log(performed_by);
CREATE INDEX idx_audit_at ON audit_log(performed_at DESC);

-- Notification log
CREATE TABLE notification_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id   UUID REFERENCES registrations(id),
  channel           notification_channel NOT NULL DEFAULT 'EMAIL',
  type              notification_type NOT NULL,
  status            notification_status NOT NULL DEFAULT 'QUEUED',
  sent_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_notif_registration ON notification_log(registration_id);

-- Export jobs
CREATE TABLE export_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id    UUID NOT NULL REFERENCES organizers(id),
  tournament_id   UUID NOT NULL REFERENCES tournaments(id),
  format          export_format NOT NULL DEFAULT 'XLSX',
  status          export_status NOT NULL DEFAULT 'QUEUED',
  storage_key     VARCHAR(500),
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ  -- storage_key deleted after this date (30 days)
);
CREATE INDEX idx_export_organizer ON export_jobs(organizer_id);
CREATE INDEX idx_export_tournament ON export_jobs(tournament_id);
CREATE INDEX idx_export_expires ON export_jobs(expires_at) WHERE status = 'DONE';
```

---

## Migration 002 — Seed Super Admin

**File:** `prisma/migrations/20260306_002_seed_admin/migration.sql`

> This migration seeds the initial Super Admin account. Password must be changed on first login. The bcrypt hash below corresponds to a temporary password set at deployment time via an environment variable.

```sql
-- Super admin seeded via application seed script (prisma/seed.ts)
-- NOT via raw SQL migration — password hash is environment-specific
-- Run: npx prisma db seed
```

The `seed.ts` script:
```typescript
const admin = await prisma.users.create({
  data: {
    email: process.env.ADMIN_EMAIL,
    password_hash: await bcrypt.hash(process.env.ADMIN_INITIAL_PASSWORD, 12),
    role: 'SUPER_ADMIN',
    status: 'ACTIVE',
  }
});
console.log(`Super admin created: ${admin.email}`);
```

---

## Migration 003 — Updated Triggers (updated_at automation)

**File:** `prisma/migrations/20260306_003_updated_at_triggers/migration.sql`

```sql
-- Function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to tables with updated_at
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_tournaments_updated_at
    BEFORE UPDATE ON tournaments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_payments_updated_at
    BEFORE UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

---

## Future Migration Guidelines

### Additive-Only Changes (safe to deploy with zero downtime)

| Change | Safe? |
|---|---|
| Add new nullable column | ✅ Yes |
| Add new table | ✅ Yes |
| Add index (use `CONCURRENTLY`) | ✅ Yes |
| Add new enum value | ✅ Yes (with Postgres 12+) |
| Add NOT NULL column with default | ✅ Yes |
| **Rename column** | ❌ No — breaks old app reading old column name |
| **Drop column** | ❌ No — breaks old app reading deleted column |
| **Change column type** | ❌ No — potential data cast failure in production |
| **Remove enum value** | ❌ No — breaks rows referencing removed value |

### Safe Rename Pattern (3-step)

1. **Migration A:** Add `new_column_name` (nullable), copy data from `old_column_name`
2. **App release:** Deploy app that writes to both columns, reads from `new_column_name`
3. **Migration B:** Drop `old_column_name`

### Adding Indexes in Production

Always use `CREATE INDEX CONCURRENTLY` to avoid locking the table:

```sql
-- Note: Cannot run inside a transaction block
CREATE INDEX CONCURRENTLY idx_new_index ON table_name(column_name);
```

For Prisma, use `@@index` in `schema.prisma` and generate the migration — then manually edit the SQL to add `CONCURRENTLY`.

---

## Backup Verification — Pre-Migration Checklist

Before running any migration on production:

```
[ ] Verify latest database backup completed successfully
[ ] Test migration on staging with production data snapshot
[ ] Check migration is backwards-compatible with currently running API version
[ ] Prepare rollback plan (redeploy previous API image — schema must remain readable)
[ ] Schedule migration during low-traffic window if table is large (> 1M rows)
```
