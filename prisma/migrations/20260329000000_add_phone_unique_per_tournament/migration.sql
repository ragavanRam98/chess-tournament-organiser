-- ════════════════════════════════════════════════════════════════════════════
-- Migration: Enforce one active registration per phone per tournament at DB level
-- ════════════════════════════════════════════════════════════════════════════
--
-- PROBLEM:
--   The application prevents duplicate registrations via a findFirst check:
--     WHERE tournamentId = X AND phone = Y AND status != 'CANCELLED'
--
--   This check has a TOCTOU race condition. Two concurrent requests can both
--   see null from findFirst (no duplicate), then both INSERT, producing two
--   registrations for the same phone in the same tournament.
--
--   The existing idx_reg_phone_tournament index is a plain (non-unique) B-tree
--   index added for query performance only. It does NOT enforce uniqueness.
--
-- FIX:
--   A partial unique index covering only non-cancelled registrations.
--
-- WHY PARTIAL (WHERE status != 'CANCELLED'):
--   A player whose registration was CANCELLED must be allowed to re-register.
--   The partial filter excludes CANCELLED rows, so:
--     - INSERT when no matching active row exists:  ✓ succeeds
--     - INSERT when matching active row exists:     ✗ P2002 unique violation
--     - INSERT after matching row is CANCELLED:     ✓ succeeds (excluded from index)
--
--   This mirrors the application's own logic exactly.
--
-- NOTE: Prisma's schema DSL does not support partial unique indexes.
--   This index cannot be expressed via @@unique in schema.prisma.
--   It must remain as a raw SQL migration.
-- ════════════════════════════════════════════════════════════════════════════

-- Enforce one active registration per phone per tournament.
-- "Active" = any status other than CANCELLED.
CREATE UNIQUE INDEX uq_reg_active_phone_per_tournament
ON registrations (tournament_id, phone)
WHERE status != 'CANCELLED';

-- The old non-unique performance index is now superseded.
-- The new unique index also functions as a B-tree scan index for the same columns,
-- so query plans that used idx_reg_phone_tournament will automatically use this one.
DROP INDEX IF EXISTS idx_reg_phone_tournament;
