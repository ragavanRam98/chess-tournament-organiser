/**
 * DB-level integration test: duplicate phone registration prevention.
 *
 * ── THE QUESTION ──────────────────────────────────────────────────────────────
 *
 * If two concurrent registration requests arrive for the same phone + tournament,
 * does the DATABASE prevent a double-booking when the application-level check
 * is bypassed (e.g., via a TOCTOU race)?
 *
 * This test inserts directly via prisma.registration.create() — bypassing all
 * service logic — to isolate whether the DB itself has the constraint.
 *
 * ── CURRENT STATE: THE DB HAS NO SUCH CONSTRAINT ─────────────────────────────
 *
 * Every migration has been checked. The only indexes on (phone, tournament_id) are:
 *
 *   CREATE INDEX "idx_reg_phone_tournament"
 *   ON "registrations"("phone", "tournament_id");            ← plain index, NOT unique
 *
 * This is a B-tree index added purely for query performance.
 * It does NOT prevent duplicate (phone, tournament_id) rows.
 *
 * The only UNIQUE index on registrations is:
 *   CREATE UNIQUE INDEX "registrations_entry_number_key" ON "registrations"("entry_number");
 *
 * ── THE CONSEQUENCE ──────────────────────────────────────────────────────────
 *
 * The service checks for duplicates in application code:
 *
 *   const duplicate = await this.prisma.registration.findFirst({
 *       where: { tournamentId, phone: dto.phone, status: { not: 'CANCELLED' } },
 *   });
 *   if (duplicate) throw new ConflictException('DUPLICATE_REGISTRATION');
 *
 * This has a TOCTOU (Time-of-Check-Time-of-Use) race:
 *
 *   T1: findFirst(phone) → null        ← no duplicate seen
 *   T2: findFirst(phone) → null        ← no duplicate seen (T1 hasn't inserted yet)
 *   T1: INSERT registration            ← succeeds
 *   T2: INSERT registration            ← also succeeds — DB allows it
 *
 * Result: two registrations for the same phone in the same tournament.
 *
 * ── THIS TEST WILL CURRENTLY FAIL ─────────────────────────────────────────────
 *
 * The main test asserts the correct business rule: only one insert should succeed.
 * Against the current schema, BOTH inserts succeed, so:
 *   expect(successes).toHaveLength(1)  → FAILS  (both are fulfilled)
 *   expect(failures).toHaveLength(1)   → FAILS  (no failure)
 *   expect(rows).toHaveLength(1)       → FAILS  (two rows in DB)
 *
 * ── THE FIX ───────────────────────────────────────────────────────────────────
 *
 * A partial unique index scoped to non-cancelled registrations:
 *
 *   CREATE UNIQUE INDEX uq_reg_active_phone_per_tournament
 *   ON registrations (tournament_id, phone)
 *   WHERE status != 'CANCELLED';
 *
 * Why partial (WHERE status != 'CANCELLED')?
 *   A player whose registration was CANCELLED must be able to re-register.
 *   A full unique index would reject that re-registration with a constraint error.
 *   The partial filter mirrors the application's own check exactly:
 *     `status: { not: 'CANCELLED' }` in findFirst.
 *
 * Why this must be a raw SQL migration (not Prisma schema):
 *   Prisma's schema DSL (@unique) does not support partial indexes (WHERE clauses).
 *   The index must be added via a hand-written migration file.
 *
 * Migration file to create:
 *   prisma/migrations/YYYYMMDD_add_phone_unique_per_tournament/migration.sql
 *
 *   -- Enforce one active registration per phone per tournament at the DB level.
 *   -- "Active" means any status that is not CANCELLED.
 *   -- Partial index: CANCELLED rows are excluded so re-registration is allowed.
 *   CREATE UNIQUE INDEX uq_reg_active_phone_per_tournament
 *   ON registrations (tournament_id, phone)
 *   WHERE status != 'CANCELLED';
 *
 *   -- The old non-unique performance index is superseded by the unique index,
 *   -- which also serves as a B-tree index for the same column pair.
 *   DROP INDEX IF EXISTS idx_reg_phone_tournament;
 *
 * After applying this migration, all three assertions in the main test will pass,
 * and the "current state" describe block will become permanently obsolete.
 *
 * ── PREREQUISITES ─────────────────────────────────────────────────────────────
 *   docker compose -f docker-compose.dev.yml up postgres -d --wait
 *   DATABASE_URL=postgresql://chess:chess_dev_password@localhost:5432/chess_tournament
 *   npx prisma migrate deploy          (run from repo root)
 *   npx jest --config apps/api/test/jest-e2e.json phone-duplicate
 */

import { PrismaClient, Prisma } from '@prisma/client';

// ── Skip if no database configured ────────────────────────────────────────────

const HAS_DB = Boolean(process.env.DATABASE_URL);
const describeIfDb = HAS_DB ? describe : describe.skip;

describeIfDb('Phone duplicate prevention — DB constraint level', () => {

    const prisma = new PrismaClient();

    // IDs of the test-run's fixture records, captured for cleanup
    let userId: string;
    let tournamentId: string;
    let categoryId: string;

    // Unique prefix for entry numbers in this test run.
    // Timestamp-based so re-runs after a crash don't collide on entry_number (unique).
    const RUN_TS = Date.now();
    const entryNum = (n: number) => `PT-${RUN_TS}-${n}`; // ≤ 30 chars

    /**
     * The phone number that both concurrent registrations will share.
     * Both inserts target the same (tournamentId, phone) pair.
     */
    const DUPLICATE_PHONE = '+919999900001';

    /**
     * Dedicated phone for the re-registration test.
     * Kept isolated so leftover PENDING_PAYMENT rows from the concurrent test
     * do not trigger a P2002 on this phone.
     */
    const REREGISTER_PHONE = '+919999900002';

    // ── Fixture management ─────────────────────────────────────────────────────

    beforeAll(async () => {
        await prisma.$connect();
        await cleanupByEmail('phone-dup-test@integration.local');
        await createFixtures();
    }, 30_000);

    afterAll(async () => {
        await cleanupByEmail('phone-dup-test@integration.local');
        await prisma.$disconnect();
    }, 30_000);

    /**
     * Delete all test fixture rows in FK-safe order.
     * Safe to call even if no data exists (no-op).
     * Handles stale data from previous test runs that crashed before afterAll.
     */
    async function cleanupByEmail(email: string): Promise<void> {
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return;

        const organizer = await prisma.organizer.findUnique({ where: { userId: user.id } });
        if (organizer) {
            const tournaments = await prisma.tournament.findMany({
                where: { organizerId: organizer.id },
                select: { id: true },
            });
            const tIds = tournaments.map((t) => t.id);
            if (tIds.length > 0) {
                // Must delete registrations before tournament (RESTRICT FK)
                await prisma.registration.deleteMany({ where: { tournamentId: { in: tIds } } });
                // Deleting tournament cascades to categories
                await prisma.tournament.deleteMany({ where: { id: { in: tIds } } });
            }
        }
        // Deleting user cascades to organizer
        await prisma.user.delete({ where: { id: user.id } });
    }

    async function createFixtures(): Promise<void> {
        /**
         * Minimal fixture chain required by FK constraints:
         *   User → Organizer → Tournament (APPROVED) → Category (maxSeats: 10)
         *
         * We use maxSeats: 10 to ensure the seat-limit trigger never interferes.
         * The seat limit is application-checked; this test is about phone uniqueness.
         * minAge: 0 / maxAge: 99 ensures age validation never interferes either.
         */
        const user = await prisma.user.create({
            data: {
                email: 'phone-dup-test@integration.local',
                passwordHash: '$integration-test-not-a-real-hash$',
                role: 'ORGANIZER',
                status: 'ACTIVE',
            },
        });
        userId = user.id;

        const organizer = await prisma.organizer.create({
            data: {
                userId: user.id,
                academyName: 'Phone Dup Test Academy',
                contactPhone: '+910000000099',
                city: 'Test City',
            },
        });

        const tournament = await prisma.tournament.create({
            data: {
                organizerId: organizer.id,
                title: 'Phone Duplicate Test Tournament',
                city: 'Test City',
                venue: 'Test Venue',
                startDate: new Date('2030-06-01'),
                endDate: new Date('2030-06-03'),
                registrationDeadline: new Date('2030-05-31'),
                status: 'APPROVED',
            },
        });
        tournamentId = tournament.id;

        const category = await prisma.category.create({
            data: {
                tournamentId: tournament.id,
                name: 'Open',
                minAge: 0,
                maxAge: 99,
                entryFeePaise: 50_000,
                maxSeats: 10,
                registeredCount: 0,
            },
        });
        categoryId = category.id;
    }

    // ── Shared registration data factory ──────────────────────────────────────

    /**
     * Returns a valid Registration create payload.
     * phone defaults to DUPLICATE_PHONE (the shared phone used for concurrency tests).
     * Pass a different phone to isolate a test from leftover rows of sibling tests.
     * Entry numbers are distinct so the registrations_entry_number_key unique
     * constraint never fires, keeping that variable out of scope.
     */
    function makeReg(seq: number, phone = DUPLICATE_PHONE) {
        return {
            tournamentId,
            categoryId,
            playerName: `Player ${seq}`,
            playerDob: new Date('2000-01-01'),
            phone,
            entryNumber: entryNum(seq),
            status: 'PENDING_PAYMENT' as const,
            expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // MAIN TEST — correct business expectation
    // Currently FAILS because no DB unique constraint exists.
    // Will PASS after applying the migration in the file header.
    // ══════════════════════════════════════════════════════════════════════════

    describe('correct behavior after migration is applied', () => {

        it('rejects the second concurrent insert when same phone is already registered in the same tournament', async () => {
            /**
             * Both inserts target (tournamentId, DUPLICATE_PHONE) simultaneously.
             * Without a DB unique constraint, both land in the table.
             * With the partial unique index, the second insert throws P2002.
             *
             * We use Promise.allSettled so we see both outcomes regardless of
             * which one "wins" the lock. Using Promise.all would swallow the
             * success if the rejection propagates first.
             */
            const outcomes = await Promise.allSettled([
                prisma.registration.create({ data: makeReg(1) }),
                prisma.registration.create({ data: makeReg(2) }),
            ]);

            const successes = outcomes.filter((o) => o.status === 'fulfilled');
            const failures  = outcomes.filter((o) => o.status === 'rejected');

            // ── Currently FAILS: both outcomes are 'fulfilled' ─────────────────
            expect(successes).toHaveLength(1);
            expect(failures).toHaveLength(1);

            // ── The failure must be a DB unique constraint error, not a timeout ─
            const rejection = (failures[0] as PromiseRejectedResult).reason;

            /**
             * Prisma wraps PostgreSQL unique constraint violations as:
             *   PrismaClientKnownRequestError { code: 'P2002' }
             * error.meta.target identifies which columns violated the constraint.
             *
             * If it were a different error (e.g., P2034 for serialization failure,
             * or a network timeout), something else is wrong — the test correctly
             * rejects that as not the right kind of failure.
             */
            expect(rejection).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
            expect((rejection as Prisma.PrismaClientKnownRequestError).code).toBe('P2002');

            // ── DB state must show exactly one registration ────────────────────
            const rows = await prisma.registration.findMany({
                where: { tournamentId, phone: DUPLICATE_PHONE },
            });

            /**
             * Currently FAILS: two rows exist.
             * After the migration: one row exists (the loser was rejected before INSERT).
             */
            expect(rows).toHaveLength(1);
        }, 30_000);

        it('allows a re-registration after the previous one is CANCELLED (partial index semantics)', async () => {
            /**
             * After the migration, the partial index applies only WHERE status != 'CANCELLED'.
             * A player whose registration was cancelled must still be able to re-register.
             * This test verifies the index does NOT block that scenario.
             *
             * Without the migration, this test passes vacuously (any insert succeeds).
             * After the migration, this test validates the partial filter is correct.
             */

            /**
             * Uses REREGISTER_PHONE — a phone distinct from DUPLICATE_PHONE — so this
             * test does not conflict with the PENDING_PAYMENT row left by the concurrent
             * test above (which also runs against DUPLICATE_PHONE in the same tournament).
             */

            // Step 1: insert an initial registration for the isolated phone
            const initial = await prisma.registration.create({
                data: makeReg(10, REREGISTER_PHONE),
            });

            // Step 2: cancel it — now it is outside the partial index's scope
            await prisma.registration.update({
                where: { id: initial.id },
                data: { status: 'CANCELLED' },
            });

            // Step 3: a new registration for the same phone should now succeed
            // After migration: the partial index allows it because the existing row is CANCELLED.
            await expect(
                prisma.registration.create({ data: makeReg(11, REREGISTER_PHONE) })
            ).resolves.toBeDefined();

            // Clean up both rows so afterAll runs cleanly
            await prisma.registration.deleteMany({
                where: { tournamentId, phone: REREGISTER_PHONE },
            });
        }, 30_000);

    });

    // ══════════════════════════════════════════════════════════════════════════
    // HISTORICAL — documents the gap that existed before the migration.
    // Skipped now that uq_reg_active_phone_per_tournament is applied.
    // These tests are kept as a record of WHY the migration was needed.
    // ══════════════════════════════════════════════════════════════════════════

    describe.skip('HISTORICAL — gap demonstration (migration 20260329000000 resolved this)', () => {

        it('EXPOSES THE BUG: both concurrent inserts succeed — the DB has no unique constraint on (phone, tournament_id)', async () => {
            /**
             * This test PASSES in the current schema.
             * It documents the incorrect behavior: both registrations land in the DB.
             *
             * The plain index idx_reg_phone_tournament is a B-tree scan accelerator.
             * It was never declared UNIQUE. Postgres freely inserts duplicate key values.
             *
             * Proof: two rows exist after two inserts for the same phone.
             */
            const outcomes = await Promise.allSettled([
                prisma.registration.create({ data: makeReg(20) }),
                prisma.registration.create({ data: makeReg(21) }),
            ]);

            const successes = outcomes.filter((o) => o.status === 'fulfilled');
            const failures  = outcomes.filter((o) => o.status === 'rejected');

            // Both succeed — this is the bug
            expect(successes).toHaveLength(2);
            expect(failures).toHaveLength(0);

            // Two rows in the DB for the same phone in the same tournament
            const rows = await prisma.registration.findMany({
                where: {
                    tournamentId,
                    phone: DUPLICATE_PHONE,
                    entryNumber: { in: [entryNum(20), entryNum(21)] },
                },
            });
            expect(rows).toHaveLength(2);

            /**
             * What idx_reg_phone_tournament looks like in the DB:
             *
             *   phone             | tournament_id
             *   ------------------+--------------------------------------
             *   +919999900001     | <tournamentId>           ← row 1
             *   +919999900001     | <tournamentId>           ← row 2  ← DUPLICATE, no error
             *
             * A UNIQUE index would have rejected the second row at INSERT time.
             */
        }, 30_000);

        it('EXPOSES THE TOCTOU GAP: sequential inserts also both succeed — concurrency is not required to reproduce the bug', async () => {
            /**
             * The bug does not require a race condition to manifest.
             * Even a sequential insert of the same (phone, tournamentId) succeeds
             * because the DB has no constraint.
             *
             * This is important: fixing the TOCTOU in application code (e.g., with
             * SELECT FOR UPDATE on phone) would not help, because the underlying
             * table allows duplicate (phone, tournament_id) anyway.
             *
             * The fix must be at the DB level.
             */
            await prisma.registration.create({ data: makeReg(30) });
            await expect(
                prisma.registration.create({ data: makeReg(31) })
            ).resolves.toBeDefined(); // succeeds — no constraint error

            const count = await prisma.registration.count({
                where: {
                    tournamentId,
                    phone: DUPLICATE_PHONE,
                    entryNumber: { in: [entryNum(30), entryNum(31)] },
                },
            });
            expect(count).toBe(2); // two rows — the bug
        }, 30_000);

    });

    // ── Documented gaps not covered here ─────────────────────────────────────

    it.todo(
        'PENDING_PAYMENT status should be included in the uniqueness scope. ' +
        'Two concurrent registrations where T1 is PENDING_PAYMENT and T2 is a new attempt: ' +
        'after the migration, T2 should be rejected (same phone, same tournament, T1 not CANCELLED). ' +
        'The partial index WHERE status != CANCELLED covers this correctly.'
    );

    it.todo(
        'FAILED status scope: a registration that moved to FAILED should behave like CANCELLED ' +
        'for re-registration purposes — or should it? Verify the business rule and adjust ' +
        'the partial index filter if FAILED should also allow re-registration: ' +
        "WHERE status NOT IN ('CANCELLED', 'FAILED')"
    );

});
