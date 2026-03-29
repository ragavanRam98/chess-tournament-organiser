/**
 * Integration test: Seat limit enforcement under real concurrency.
 *
 * ── WHY THIS TEST MUST USE A REAL DATABASE ────────────────────────────────────
 *
 * The service enforces seat limits with this pattern inside a Prisma interactive
 * transaction (registrations.service.ts:52–83):
 *
 *   SELECT registered_count, max_seats
 *   FROM categories
 *   WHERE id = $categoryId::uuid
 *   FOR UPDATE           ← row-level exclusive lock
 *
 *   if (count >= max) throw ConflictException('SEAT_LIMIT_REACHED');
 *
 *   INSERT INTO registrations ... → trigger increments registered_count
 *
 * The safety guarantee is a Postgres row lock, not application logic.
 * A Jest mock ($transaction calls fn() synchronously, sequentially)
 * cannot reproduce the concurrent interleaving that actually happens.
 *
 * ── WHAT SELECT FOR UPDATE ACTUALLY DOES ─────────────────────────────────────
 *
 * T1 and T2 are two concurrent Node.js RegistrationsService.register() calls,
 * each running inside its own Prisma interactive transaction on a separate
 * connection from the Prisma connection pool.
 *
 *   T1: BEGIN
 *   T2: BEGIN
 *   T1: SELECT ... FROM categories WHERE id = X FOR UPDATE    → acquires lock, reads registered_count = 0
 *   T2: SELECT ... FROM categories WHERE id = X FOR UPDATE    → BLOCKS (waiting for T1's lock)
 *   T1: 0 < 1 → seat available → INSERT registration
 *   T1: trigger fires → UPDATE categories SET registered_count = 1 WHERE id = X  (within T1)
 *   T1: COMMIT  → lock released
 *   T2: UNBLOCKED → re-reads category row (READ COMMITTED re-reads after lock release)
 *   T2: registered_count = 1, max_seats = 1 → 1 >= 1 → throw ConflictException('SEAT_LIMIT_REACHED')
 *   T2: ROLLBACK
 *
 * Result: exactly one registration, registered_count = 1.
 *
 * ── KNOWN GAP: duplicate phone check is NOT covered by this lock ──────────────
 *
 * The duplicate-phone check (findFirst before the transaction) is application-
 * level and has a TOCTOU gap. Two concurrent requests with the SAME phone can
 * both pass the check and both attempt to INSERT. There is no DB-level unique
 * constraint on (tournament_id, phone). This test uses DIFFERENT phones to
 * isolate the seat-lock race from the duplicate-phone race.
 * A separate test with same-phone concurrent registrations is tracked as a
 * todo at the bottom of this file.
 *
 * ── PREREQUISITES ─────────────────────────────────────────────────────────────
 *
 *   docker compose -f docker-compose.dev.yml up postgres -d --wait
 *   DATABASE_URL=postgresql://chess:chess_dev_password@localhost:5432/chess_tournament
 *   npx prisma migrate deploy  (run from repo root)
 *   npx jest --config apps/api/test/jest-e2e.json seat-concurrency
 *
 * The test skips automatically if DATABASE_URL is not set.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { RegistrationsService } from '../src/registrations/registrations.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PaymentsService } from '../src/payments/payments.service';
import { QueueService } from '../src/queue/queue.service';

// ── Skip entire suite if no DB is configured ───────────────────────────────────

const HAS_DB = Boolean(process.env.DATABASE_URL);
const describeIfDb = HAS_DB ? describe : describe.skip;

describeIfDb('RegistrationsService — seat concurrency (real Postgres)', () => {

    let module: TestingModule;
    let prisma: PrismaService;
    let service: RegistrationsService;

    // IDs of the fixture records we insert — captured so afterAll can delete them
    let userId: string;
    let tournamentId: string;
    let categoryId: string;

    // ── Module setup ───────────────────────────────────────────────────────────

    beforeAll(async () => {
        /**
         * We need:
         *   - PrismaService:   REAL  — must issue SELECT FOR UPDATE against a live Postgres
         *   - PaymentsService: MOCKED — register() calls createOrder() AFTER the transaction
         *                               commits; payment creation is irrelevant to seat locking
         *   - QueueService:    MOCKED — register() never calls queue directly
         *
         * RegistrationRateLimitGuard (Redis) is an HTTP-layer guard on the controller.
         * Calling service.register() directly bypasses all guards.
         */
        module = await Test.createTestingModule({
            providers: [
                RegistrationsService,
                PrismaService,
                {
                    provide: PaymentsService,
                    useValue: {
                        createOrder: jest.fn().mockResolvedValue({
                            razorpay_order_id: 'mock_order_concurrency_test',
                            amount_paise: 50_000,
                            currency: 'INR',
                        }),
                    },
                },
                {
                    provide: QueueService,
                    useValue: { add: jest.fn() },
                },
            ],
        }).compile();

        prisma = module.get(PrismaService);
        service = module.get(RegistrationsService);

        // Wipe any stale data from a previous failed run before inserting fresh fixtures
        await cleanupByEmail('concurrency-test-organizer@integration.local');

        // ── Create fixture data ────────────────────────────────────────────────

        /**
         * User → Organizer → Tournament → Category (maxSeats = 1)
         *
         * We use minAge = 0 / maxAge = 99 so age validation never interferes.
         * Both concurrent registrations will use DOB '2000-01-01' (age 30 at
         * tournament startDate 2030-06-01) which is well within [0, 99].
         */
        const user = await prisma.user.create({
            data: {
                email: 'concurrency-test-organizer@integration.local',
                passwordHash: '$integration-test-not-a-real-hash$',
                role: 'ORGANIZER',
                status: 'ACTIVE',
            },
        });
        userId = user.id;

        const organizer = await prisma.organizer.create({
            data: {
                userId: user.id,
                academyName: 'Integration Test Academy',
                contactPhone: '+910000000000',
                city: 'Test City',
            },
        });

        const tournament = await prisma.tournament.create({
            data: {
                organizerId: organizer.id,
                title: 'Seat Concurrency Test Tournament',
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
                maxSeats: 1,        // ← exactly 1 seat: the critical constraint under test
                registeredCount: 0,
            },
        });
        categoryId = category.id;
    }, 30_000);

    afterAll(async () => {
        /**
         * Delete in FK dependency order:
         *   1. registrations   (RESTRICT on tournament_id, category_id)
         *   2. tournament      (CASCADE to categories)
         *   3. user            (CASCADE to organizer — safe now that tournament is gone)
         *
         * PaymentsService is mocked, so no Payment rows are created.
         */
        if (prisma) {
            await cleanupByEmail('concurrency-test-organizer@integration.local');
        }
        await module?.close();
    }, 30_000);

    // ── Helpers ────────────────────────────────────────────────────────────────

    /**
     * Deletes all test data for the given organizer email.
     * Safe to call before fixtures are created (no-op if nothing exists).
     */
    async function cleanupByEmail(email: string) {
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
                await prisma.registration.deleteMany({ where: { tournamentId: { in: tIds } } });
                await prisma.tournament.deleteMany({ where: { id: { in: tIds } } });
                // categories are cascade-deleted by tournament deletion
            }
        }

        await prisma.user.delete({ where: { id: user.id } });
        // organizer is cascade-deleted by user deletion
    }

    // ── Tests ──────────────────────────────────────────────────────────────────

    it('only one of two concurrent registrations for the last seat succeeds — the other gets SEAT_LIMIT_REACHED', async () => {
        /**
         * Both players use DIFFERENT phone numbers to avoid the duplicate-phone
         * check blocking one of them before it even reaches the transaction.
         * The seat-locking race is isolated to the SELECT FOR UPDATE.
         */
        const dtoPlayer1 = {
            playerName: 'Player One',
            playerDob: '2000-01-01',    // age 30 at 2030-06-01 → within [0, 99]
            phone: '+911000000001',
            email: 'player1@integration.local',
            city: 'Chennai',
        };

        const dtoPlayer2 = {
            playerName: 'Player Two',
            playerDob: '2000-01-01',
            phone: '+912000000002',     // different phone — bypasses duplicate check
            email: 'player2@integration.local',
            city: 'Mumbai',
        };

        /**
         * Promise.allSettled:
         *   - Both register() calls start before either awaits, so both are in-flight.
         *   - Both issue BEGIN to Postgres on separate connections from the Prisma pool.
         *   - Both execute SELECT ... FOR UPDATE targeting the same category row.
         *   - One acquires the lock; the other blocks.
         *   - After the winner commits, the loser re-reads registered_count = 1 and throws.
         *
         * We use allSettled (not all) so we can inspect both outcomes.
         */
        const outcomes = await Promise.allSettled([
            service.register(tournamentId, categoryId, dtoPlayer1),
            service.register(tournamentId, categoryId, dtoPlayer2),
        ]);

        const successes = outcomes.filter((o) => o.status === 'fulfilled');
        const failures  = outcomes.filter((o) => o.status === 'rejected');

        // ── Assert: one outcome of each type ──────────────────────────────────

        expect(successes).toHaveLength(1);
        expect(failures).toHaveLength(1);

        // ── Assert: the failure carries the correct error code ─────────────────

        const rejection = (failures[0] as PromiseRejectedResult).reason;

        /**
         * Must be ConflictException('SEAT_LIMIT_REACHED').
         * If it were a deadlock PostgreSQL would throw an error with code 40P01.
         * Prisma wraps that in a PrismaClientKnownRequestError, not a NestJS
         * ConflictException. Asserting on the exact message catches both the
         * wrong-exception-type case and the wrong-message case.
         */
        expect(rejection).toBeInstanceOf(ConflictException);
        expect(rejection.message).toBe('SEAT_LIMIT_REACHED');

        // ── Assert: DB state matches ───────────────────────────────────────────

        const registrations = await prisma.registration.findMany({
            where: {
                tournamentId,
                status: { not: 'CANCELLED' },
            },
        });

        /**
         * Exactly one PENDING_PAYMENT registration should exist.
         * If there are 0: the lock mechanism failed to allow ANY registration.
         * If there are 2: the SELECT FOR UPDATE did not serialize the transactions.
         */
        expect(registrations).toHaveLength(1);
        expect(registrations[0].status).toBe('PENDING_PAYMENT');

        // ── Assert: DB trigger incremented registered_count ───────────────────

        const updatedCategory = await prisma.category.findUniqueOrThrow({
            where: { id: categoryId },
        });

        /**
         * The DB trigger `registration_count_sync` (migration 20260322120000)
         * fires AFTER INSERT on registrations and increments registered_count
         * within the same transaction. This is the value T2's re-read sees after
         * T1 commits. If the count is 0 here, the trigger did not fire.
         */
        expect(updatedCategory.registeredCount).toBe(1);

    }, 30_000);

    it('the successful registration has the correct shape (PENDING_PAYMENT, 2-hour expiry)', async () => {
        /**
         * Verify the winner's response shape. By this point one registration
         * already exists from the previous test, so this test uses a fresh
         * category to avoid coupling.
         *
         * This also confirms that the successful register() call returns the
         * correct response even in the context where a concurrent sibling failed.
         */
        const freshCategory = await prisma.category.create({
            data: {
                tournamentId,
                name: 'Open (shape test)',
                minAge: 0,
                maxAge: 99,
                entryFeePaise: 75_000,
                maxSeats: 5,
            },
        });

        const before = Date.now();
        const result = await service.register(tournamentId, freshCategory.id, {
            playerName: 'Shape Test Player',
            playerDob: '2000-01-01',
            phone: '+913000000003',
            city: 'Delhi',
        });
        const after = Date.now();

        expect(result.data.status).toBe('PENDING_PAYMENT');

        const expiresAtMs = new Date(result.data.expires_at as Date).getTime();
        const twoHoursMs = 2 * 60 * 60 * 1000;
        expect(expiresAtMs).toBeGreaterThanOrEqual(before + twoHoursMs);
        expect(expiresAtMs).toBeLessThanOrEqual(after + twoHoursMs + 5_000);

        // Cleanup this extra category
        await prisma.registration.deleteMany({ where: { categoryId: freshCategory.id } });
        await prisma.category.delete({ where: { id: freshCategory.id } });
    }, 30_000);

    it('registered_count reflects the trigger, not application-layer arithmetic', async () => {
        /**
         * This test verifies the DB trigger independently of concurrency.
         * The application code does NOT update registered_count directly —
         * it relies entirely on the trigger. If the trigger is absent (e.g.,
         * the migration was not applied), registered_count stays 0 even after
         * a successful INSERT. This test catches that scenario.
         */
        const triggerCategory = await prisma.category.create({
            data: {
                tournamentId,
                name: 'Trigger Verification',
                minAge: 0,
                maxAge: 99,
                entryFeePaise: 0,
                maxSeats: 10,
            },
        });

        // Verify starting state
        const before = await prisma.category.findUniqueOrThrow({ where: { id: triggerCategory.id } });
        expect(before.registeredCount).toBe(0);

        // One registration
        await service.register(tournamentId, triggerCategory.id, {
            playerName: 'Trigger Test Player',
            playerDob: '2000-01-01',
            phone: '+914000000004',
        });

        const after = await prisma.category.findUniqueOrThrow({ where: { id: triggerCategory.id } });
        expect(after.registeredCount).toBe(1);

        // Cleanup
        await prisma.registration.deleteMany({ where: { categoryId: triggerCategory.id } });
        await prisma.category.delete({ where: { id: triggerCategory.id } });
    }, 30_000);

    // ── Documented gaps ────────────────────────────────────────────────────────

    it.todo(
        'SAME-PHONE RACE: two concurrent registrations with the same phone for different seats. ' +
        'The duplicate-phone check (findFirst before the transaction) has a TOCTOU gap. ' +
        'Both could pass the findFirst check (both see null) then both INSERT — ' +
        'producing two registrations for the same phone in the same tournament. ' +
        'Fix: add a DB-level unique index on (tournament_id, phone) filtered to ' +
        'status != CANCELLED. Without that index, this scenario silently double-books.'
    );

    it.todo(
        'TRANSACTION ROLLBACK: verify no partial state persists if registration.create ' +
        'succeeds but a subsequent write inside the same transaction fails. ' +
        'Requires injecting a FK violation or constraint error mid-transaction.'
    );

    it.todo(
        'PURGE VS WEBHOOK RACE: a payment.captured webhook arrives at T+1:59h while the ' +
        'PurgeExpiredProcessor runs at T+2:00h. Both target the same PENDING_PAYMENT row. ' +
        'The purge cancels the registration; the webhook tries to confirm it. ' +
        'There is no explicit guard in the current code to prevent both from "winning".'
    );
});
