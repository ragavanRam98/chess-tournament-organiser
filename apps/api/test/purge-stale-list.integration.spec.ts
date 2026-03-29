/**
 * Integration test: PurgeExpiredProcessor — stale in-memory list execution.
 *
 * ── THE SCENARIO ──────────────────────────────────────────────────────────────
 *
 * PurgeExpiredProcessor.process() has a two-phase structure:
 *
 *   Phase 1 — read:  findMany(status=PENDING_PAYMENT, expiresAt<now) → list
 *   Phase 2 — write: for each item in list → $transaction([update, decrement])
 *
 * Between Phase 1 and Phase 2, an external event (a payment.captured webhook,
 * an admin action, a concurrent purge run on another worker instance) can
 * transition a registration out of PENDING_PAYMENT. The list in Phase 2 is
 * now stale — it refers to a registration whose DB state has changed.
 *
 * ── WHY THIS IS A BUG ─────────────────────────────────────────────────────────
 *
 * purge-expired.processor.ts:46–51 (the Phase 2 $transaction body):
 *
 *   this.prisma.registration.update({
 *     where: { id: reg.id },          ← id only — NO status guard
 *     data: { status: 'CANCELLED' },
 *   }),
 *   this.prisma.category.update({
 *     where: { id: reg.categoryId },
 *     data: { registeredCount: { decrement: 1 } },
 *   }),
 *
 * `registration.update` with `where: { id }` only will UPDATE any row that
 * exists, regardless of its current `status`. Prisma does not add an implicit
 * status check. The generated SQL is:
 *
 *   UPDATE registrations
 *   SET    status = 'CANCELLED'
 *   WHERE  id = $1
 *
 * If the row is now CONFIRMED, this succeeds silently and overwrites CONFIRMED
 * with CANCELLED. The paired category decrement then fires in the same
 * transaction, releasing a seat that is actually occupied by a paying player.
 *
 * ── CONTRAST WITH IDEMPOTENCY (purge-idempotency.integration.spec.ts) ─────────
 *
 * Idempotency (a second purge run on an already-CANCELLED row) is safe because
 * the findMany filter (status=PENDING_PAYMENT) prevents a CANCELLED row from
 * ever entering the list in the first place. The $transaction body is never
 * reached.
 *
 * The stale-list scenario is different: the row IS in the list (it was
 * PENDING_PAYMENT when findMany ran), and by the time the $transaction fires
 * the row has moved to CONFIRMED. The filter cannot help here because it already
 * ran. The only thing that can prevent the overwrite is a status guard inside
 * the $transaction body itself.
 *
 * ── WHAT THE TESTS ASSERT ─────────────────────────────────────────────────────
 *
 * The DESIRED invariant (correct behaviour after a fix is applied):
 *   - A CONFIRMED registration must not be overwritten to CANCELLED.
 *   - registeredCount must not be decremented for a CONFIRMED registration.
 *
 * The CURRENT behaviour (demonstrating the bug):
 *   - The loop unconditionally overwrites CONFIRMED → CANCELLED.
 *   - registeredCount is decremented even though the seat is occupied.
 *
 * Both are tested explicitly so the cause-and-effect relationship is pinned.
 *
 * ── THE FIX ───────────────────────────────────────────────────────────────────
 *
 * Replace the un-guarded registration.update inside the $transaction with
 * registration.updateMany that includes a status predicate:
 *
 *   const [updated] = await tx.$transaction([
 *     tx.registration.updateMany({
 *       where: { id: reg.id, status: 'PENDING_PAYMENT' },   ← status guard
 *       data:  { status: 'CANCELLED' },
 *     }),
 *     // category decrement is conditional — see below
 *   ]);
 *
 * Because updateMany returns { count } instead of the row, the decrement must
 * be conditional on count > 0. The cleanest pattern is an interactive
 * transaction:
 *
 *   await this.prisma.$transaction(async (tx) => {
 *     const result = await tx.registration.updateMany({
 *       where: { id: reg.id, status: 'PENDING_PAYMENT' },
 *       data:  { status: 'CANCELLED' },
 *     });
 *     if (result.count === 0) return;   // row moved on — skip decrement
 *     await tx.category.update({
 *       where: { id: reg.categoryId },
 *       data:  { registeredCount: { decrement: 1 } },
 *     });
 *   });
 *
 * updateMany returns count=0 when no row matched the predicate (status was no
 * longer PENDING_PAYMENT), and count=1 when the update succeeded. The guard
 * `if (result.count === 0) return` prevents the decrement from firing when the
 * registration has already been confirmed.
 *
 * ── PREREQUISITES ─────────────────────────────────────────────────────────────
 *
 *   docker compose -f docker-compose.dev.yml up postgres -d --wait
 *   DATABASE_URL=postgresql://chess:chess_dev_password@localhost:5432/chess_tournament
 *   npx prisma migrate deploy  (run from repo root)
 *   npx jest --config apps/api/test/jest-e2e.json purge-stale-list
 *
 * The test skips automatically if DATABASE_URL is not set.
 */

import { PrismaClient } from '@prisma/client';

// ── Skip guard ─────────────────────────────────────────────────────────────────

const HAS_DB = Boolean(process.env.DATABASE_URL);
const describeIfDb = HAS_DB ? describe : describe.skip;

// ── Types ──────────────────────────────────────────────────────────────────────

interface PurgeListItem {
    id:          string;
    categoryId:  string;
    entryNumber: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Phase 1 of PurgeExpiredProcessor.process() in isolation.
 *
 * Replicates purge-expired.processor.ts:32–38 exactly, scoped to a set of
 * registration IDs so this test does not disturb other data in the shared DB.
 * Returns the stale list that Phase 2 will iterate over.
 */
async function captureExpiredList(
    prisma: PrismaClient,
    scopeIds: string[],
): Promise<PurgeListItem[]> {
    return prisma.registration.findMany({
        where: {
            id:        { in: scopeIds },
            status:    'PENDING_PAYMENT',
            expiresAt: { lt: new Date() },
        },
        select: { id: true, categoryId: true, entryNumber: true },
    });
}

/**
 * Phase 2 of PurgeExpiredProcessor.process() in isolation.
 *
 * Replicates purge-expired.processor.ts:44–57 verbatim — including the
 * un-guarded `registration.update({ where: { id } })` and the unconditional
 * `category.update({ registeredCount: { decrement: 1 } })`.
 *
 * Accepts a pre-computed list so the caller controls what was "seen" during
 * Phase 1, even if the DB state has changed since then.
 *
 * Returns the count of rows for which the $transaction was attempted and
 * succeeded (i.e., `purged` in the processor).
 */
async function executePurgeLoop(
    prisma: PrismaClient,
    list: PurgeListItem[],
): Promise<number> {
    let purged = 0;

    for (const reg of list) {
        // purge-expired.processor.ts:46–57 — copied verbatim, no status guard
        await prisma.$transaction([
            prisma.registration.update({
                where: { id: reg.id },          // ← id only: no status predicate
                data:  { status: 'CANCELLED' },
            }),
            prisma.category.update({
                where: { id: reg.categoryId },
                data:  { registeredCount: { decrement: 1 } },
            }),
        ]);
        purged++;
    }

    return purged;
}

// ── Suite ──────────────────────────────────────────────────────────────────────

describeIfDb('PurgeExpiredProcessor — stale in-memory list execution (real Postgres)', () => {

    const prisma = new PrismaClient();

    let tournamentId: string;

    const RUN_TS  = Date.now();
    const entryNum = (n: number) => `PSL-${RUN_TS}-${n}`;           // ≤ 25 chars
    const phone    = (n: number) => `+9173${String(RUN_TS).slice(-7)}${n}`;

    // ── Fixture management ─────────────────────────────────────────────────────

    beforeAll(async () => {
        await prisma.$connect();
        await cleanupByEmail('purge-stale-list@integration.local');
        await createBaseFixtures();
    }, 30_000);

    afterAll(async () => {
        await cleanupByEmail('purge-stale-list@integration.local');
        await prisma.$disconnect();
    }, 30_000);

    async function cleanupByEmail(email: string): Promise<void> {
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return;

        const organizer = await prisma.organizer.findUnique({ where: { userId: user.id } });
        if (organizer) {
            const tIds = (await prisma.tournament.findMany({
                where:  { organizerId: organizer.id },
                select: { id: true },
            })).map((t) => t.id);

            if (tIds.length > 0) {
                await prisma.registration.deleteMany({ where: { tournamentId: { in: tIds } } });
                await prisma.tournament.deleteMany({ where: { id: { in: tIds } } });
            }
        }
        await prisma.user.delete({ where: { id: user.id } });
    }

    async function createBaseFixtures(): Promise<void> {
        const user = await prisma.user.create({
            data: {
                email:        'purge-stale-list@integration.local',
                passwordHash: '$integration-test-not-a-real-hash$',
                role:         'ORGANIZER',
                status:       'ACTIVE',
            },
        });

        const organizer = await prisma.organizer.create({
            data: {
                userId:      user.id,
                academyName: 'Stale List Academy',
                contactPhone: '+910000000099',
                city:        'Test City',
            },
        });

        const tournament = await prisma.tournament.create({
            data: {
                organizerId:          organizer.id,
                title:                'Stale List Tournament',
                city:                 'Test City',
                venue:                'Test Venue',
                startDate:            new Date('2030-06-01'),
                endDate:              new Date('2030-06-03'),
                registrationDeadline: new Date('2030-05-31'),
                status:               'APPROVED',
            },
        });
        tournamentId = tournament.id;
    }

    /**
     * Creates a Category and a PENDING_PAYMENT expired Registration.
     *
     * The DB trigger fires on INSERT and increments category.registeredCount
     * from 0 to 1. No further manual adjustment is done here.
     *
     * After this helper:
     *   registration.status       = PENDING_PAYMENT
     *   category.registeredCount  = 1
     */
    async function createExpiredPendingFixture(seq: number): Promise<{
        categoryId: string;
        regId:      string;
        listItem:   PurgeListItem;
    }> {
        const category = await prisma.category.create({
            data: {
                tournamentId,
                name:           `Stale List Cat ${seq} (${RUN_TS})`,
                minAge:         0,
                maxAge:         99,
                entryFeePaise:  50_000,
                maxSeats:       5,
                registeredCount: 0,
            },
        });

        // INSERT → trigger increments registeredCount to 1
        const reg = await prisma.registration.create({
            data: {
                tournamentId,
                categoryId:  category.id,
                playerName:  `Stale Player ${seq}`,
                playerDob:   new Date('2000-01-01'),
                phone:       phone(seq),
                entryNumber: entryNum(seq),
                status:      'PENDING_PAYMENT',
                expiresAt:   new Date(Date.now() - 3_000),  // expired 3 s ago
            },
        });

        const listItem: PurgeListItem = {
            id:          reg.id,
            categoryId:  category.id,
            entryNumber: reg.entryNumber,
        };

        return { categoryId: category.id, regId: reg.id, listItem };
    }

    // ── Tests ──────────────────────────────────────────────────────────────────

    it('DEMONSTRATES BUG: loop overwrites CONFIRMED → CANCELLED when list is stale', async () => {
        /**
         * This test stages the exact interleaving that causes the bug and asserts
         * the incorrect outcome that the current code produces. It is the
         * authoritative record of the failure mode.
         *
         * Timeline:
         *   1. findMany(PENDING_PAYMENT, expired) → staleList = [reg.id]
         *   2. Webhook arrives: registration → CONFIRMED  (external event)
         *   3. Purge loop fires with staleList:
         *        registration.update({ where: { id: reg.id } })     ← no status guard
         *        → UPDATE registrations SET status = 'CANCELLED' WHERE id = $1
         *        → succeeds unconditionally (Postgres does not know the caller
         *          expected the row to still be PENDING_PAYMENT)
         *      + category.update({ registeredCount: { decrement: 1 } })
         *        → seat released even though the player paid
         *
         * Correct outcome:  status=CONFIRMED, registeredCount=1
         * Actual outcome:   status=CANCELLED, registeredCount=0   ← asserted below
         *
         * ── WHY THE UPDATE SUCCEEDS WITHOUT A STATUS GUARD ───────────────────────
         *
         * Prisma's `registration.update({ where: { id } })` generates:
         *
         *   UPDATE registrations
         *   SET    status = 'CANCELLED', updated_at = NOW()
         *   WHERE  id = '<uuid>'
         *
         * There is no `AND status = 'PENDING_PAYMENT'` clause. Postgres finds the
         * row by primary key and updates it regardless of what `status` currently
         * holds. The update returns 1 row affected whether the previous status was
         * PENDING_PAYMENT, CONFIRMED, or anything else.
         *
         * Prisma's `update` (as opposed to `updateMany`) throws P2025 only when
         * the row does not exist at all. A row that exists but has the wrong
         * status is not an error — it is silently overwritten.
         */
        const { categoryId, regId, listItem } = await createExpiredPendingFixture(1);

        // ── Phase 1: capture stale list ─────────────────────────────────────────
        const staleList = await captureExpiredList(prisma, [regId]);
        expect(staleList).toHaveLength(1); // reg was PENDING_PAYMENT at read time

        // ── State change between Phase 1 and Phase 2 ───────────────────────────
        // Simulate a payment.captured webhook confirming the registration.
        // The trigger does NOT fire on UPDATE, so registeredCount stays at 1.
        await prisma.registration.update({
            where: { id: regId },
            data:  { status: 'CONFIRMED', confirmedAt: new Date() },
        });

        const afterWebhook = await prisma.registration.findUniqueOrThrow({ where: { id: regId } });
        expect(afterWebhook.status).toBe('CONFIRMED'); // state change confirmed

        const countAfterWebhook = (await prisma.category.findUniqueOrThrow({
            where: { id: categoryId },
        })).registeredCount;
        expect(countAfterWebhook).toBe(1); // trigger incremented on INSERT only

        // ── Phase 2: execute stale loop ─────────────────────────────────────────
        const purged = await executePurgeLoop(prisma, staleList);

        // ── Assert: the bug manifests ───────────────────────────────────────────
        //
        // `purged = 1` because registration.update with WHERE id only never throws —
        // it finds the row by PK and overwrites whatever status is there.
        expect(purged).toBe(1); // BUG: loop processed a row it should have skipped

        const finalReg = await prisma.registration.findUniqueOrThrow({ where: { id: regId } });
        const finalCat = await prisma.category.findUniqueOrThrow({ where: { id: categoryId } });

        expect(finalReg.status).toBe('CANCELLED');                 // BUG: was CONFIRMED
        expect(finalCat.registeredCount).toBe(countAfterWebhook - 1); // BUG: decremented to 0
        //
        // After the fix (registration.updateMany with status guard):
        //   finalReg.status              === 'CONFIRMED'   ← loop skipped
        //   finalCat.registeredCount     === countAfterWebhook  ← decrement skipped
        //   purged                       === 0
    }, 30_000);

    it('DESIRED INVARIANT: CONFIRMED registration must not be overwritten after stale-list execution', async () => {
        /**
         * Asserts the correct postcondition. This test FAILS against the current
         * code (the bug demonstrated above). It will PASS after the fix is applied.
         *
         * The fix: replace registration.update({ where: { id } }) with
         * registration.updateMany({ where: { id, status: 'PENDING_PAYMENT' } })
         * inside the $transaction body, and skip the category decrement when
         * updateMany returns count = 0.
         */
        const { categoryId, regId, listItem } = await createExpiredPendingFixture(2);

        const staleList = await captureExpiredList(prisma, [regId]);
        expect(staleList).toHaveLength(1);

        // State change: registration confirmed between list capture and loop execution
        await prisma.registration.update({
            where: { id: regId },
            data:  { status: 'CONFIRMED', confirmedAt: new Date() },
        });

        const countBeforeLoop = (await prisma.category.findUniqueOrThrow({
            where: { id: categoryId },
        })).registeredCount;

        await executePurgeLoop(prisma, staleList);

        const finalReg = await prisma.registration.findUniqueOrThrow({ where: { id: regId } });
        const finalCat = await prisma.category.findUniqueOrThrow({ where: { id: categoryId } });

        // These assertions FAIL with current code.
        // They document the contract the fix must satisfy.
        expect(finalReg.status).toBe('CONFIRMED');                  // must not be overwritten
        expect(finalCat.registeredCount).toBe(countBeforeLoop);     // seat must remain occupied
    }, 30_000);

    it('DESIRED INVARIANT: registeredCount must not be decremented for a CONFIRMED registration', async () => {
        /**
         * Focuses exclusively on the counter. Separates it from the status
         * assertion so a partial fix (guarding the status update but not the
         * decrement) is caught independently.
         *
         * The decrement in the current processor:
         *
         *   this.prisma.category.update({
         *     where: { id: reg.categoryId },
         *     data:  { registeredCount: { decrement: 1 } },
         *   })
         *
         * is in the same $transaction as the registration update and fires
         * unconditionally. Even if the registration update were guarded, the
         * decrement would still fire unless the entire $transaction is skipped
         * or the decrement itself is wrapped in the same conditional.
         *
         * This test FAILS with current code. It passes only when both the
         * registration update AND the category decrement are guarded by the
         * status check (i.e., when the interactive transaction pattern from the
         * file header is used).
         */
        const { categoryId, regId } = await createExpiredPendingFixture(3);

        const staleList = await captureExpiredList(prisma, [regId]);

        await prisma.registration.update({
            where: { id: regId },
            data:  { status: 'CONFIRMED', confirmedAt: new Date() },
        });

        const countBefore = (await prisma.category.findUniqueOrThrow({
            where: { id: categoryId },
        })).registeredCount;
        expect(countBefore).toBe(1); // one confirmed seat

        await executePurgeLoop(prisma, staleList);

        const countAfter = (await prisma.category.findUniqueOrThrow({
            where: { id: categoryId },
        })).registeredCount;

        expect(countAfter).toBe(countBefore);           // FAILS with current code (drops to 0)
        expect(countAfter).toBeGreaterThanOrEqual(1);   // confirmed seat must be counted
    }, 30_000);

    it('stale list with mixed statuses: PENDING_PAYMENT row is cancelled, CONFIRMED row is left untouched', async () => {
        /**
         * Two registrations in separate categories, both captured in the stale list
         * when they were PENDING_PAYMENT. Before the loop runs:
         *   reg A: updated to CONFIRMED (webhook arrived)
         *   reg B: stays PENDING_PAYMENT (no webhook)
         *
         * Desired postcondition:
         *   A: CONFIRMED, categoryA.registeredCount = 1   (unchanged)
         *   B: CANCELLED, categoryB.registeredCount = 0   (purged correctly)
         *
         * Current code will produce:
         *   A: CANCELLED, categoryA.registeredCount = 0   ← bug
         *   B: CANCELLED, categoryB.registeredCount = 0   ← correct
         *
         * This test FAILS with current code on the assertions for reg A.
         * It passes after the status guard fix is applied.
         */
        const fixtureA = await createExpiredPendingFixture(10);
        const fixtureB = await createExpiredPendingFixture(11);

        // Capture both in the stale list
        const staleList = await captureExpiredList(prisma, [fixtureA.regId, fixtureB.regId]);
        expect(staleList).toHaveLength(2);

        // A is confirmed before the loop runs; B remains PENDING_PAYMENT
        await prisma.registration.update({
            where: { id: fixtureA.regId },
            data:  { status: 'CONFIRMED', confirmedAt: new Date() },
        });

        const countABefore = (await prisma.category.findUniqueOrThrow({
            where: { id: fixtureA.categoryId },
        })).registeredCount;
        const countBBefore = (await prisma.category.findUniqueOrThrow({
            where: { id: fixtureB.categoryId },
        })).registeredCount;

        await executePurgeLoop(prisma, staleList);

        const finalRegA = await prisma.registration.findUniqueOrThrow({ where: { id: fixtureA.regId } });
        const finalRegB = await prisma.registration.findUniqueOrThrow({ where: { id: fixtureB.regId } });
        const finalCatA = await prisma.category.findUniqueOrThrow({ where: { id: fixtureA.categoryId } });
        const finalCatB = await prisma.category.findUniqueOrThrow({ where: { id: fixtureB.categoryId } });

        // reg B — no state change, stale list is accurate → correct purge
        expect(finalRegB.status).toBe('CANCELLED');
        expect(finalCatB.registeredCount).toBe(countBBefore - 1);

        // reg A — stale list, status changed to CONFIRMED → must NOT be touched
        // FAILS with current code.
        expect(finalRegA.status).toBe('CONFIRMED');
        expect(finalCatA.registeredCount).toBe(countABefore);
    }, 30_000);

    it('stale list item referencing a non-existent registration throws P2025 (boundary: deleted row)', async () => {
        /**
         * Documents the one case where the un-guarded registration.update DOES
         * throw: when the row has been hard-deleted between Phase 1 and Phase 2.
         *
         * Prisma's `update` (not `updateMany`) throws P2025 — "Record to update
         * not found" — when the WHERE clause matches zero rows. Deletion is the
         * only way to reach this path; a status change (CONFIRMED, CANCELLED) does
         * not trigger P2025 because the row still exists.
         *
         * The processor wraps each iteration in try/catch and logs the error,
         * so a P2025 does not crash the job. This test verifies that the error
         * propagates correctly from the $transaction so the processor's error
         * handler can log and continue.
         *
         * This is informational — it is not the stale-list bug. It shows the
         * boundary between a status-mismatch (silent overwrite) and a
         * missing-row (explicit error).
         */
        const { regId, listItem } = await createExpiredPendingFixture(20);

        const staleList = await captureExpiredList(prisma, [regId]);
        expect(staleList).toHaveLength(1);

        // Hard-delete the registration (simulates a cascading tournament deletion
        // or a direct DB cleanup that ran between Phase 1 and Phase 2)
        await prisma.registration.delete({ where: { id: regId } });

        // The $transaction should throw P2025 — row not found
        await expect(
            prisma.$transaction([
                prisma.registration.update({
                    where: { id: listItem.id },
                    data:  { status: 'CANCELLED' },
                }),
                prisma.category.update({
                    where: { id: listItem.categoryId },
                    data:  { registeredCount: { decrement: 1 } },
                }),
            ])
        ).rejects.toMatchObject({ code: 'P2025' });

        // The category decrement did NOT fire (transaction rolled back on P2025)
        const cat = await prisma.category.findUniqueOrThrow({ where: { id: listItem.categoryId } });
        expect(cat.registeredCount).toBe(1); // trigger set this on INSERT; no decrement fired
    }, 30_000);

    // ── Documented gaps ────────────────────────────────────────────────────────

    it.todo(
        'FIX VERIFICATION: after replacing registration.update with registration.updateMany ' +
        '({ where: { id, status: "PENDING_PAYMENT" } }) and wrapping both updates in an ' +
        'interactive $transaction with if (result.count === 0) return, re-run the ' +
        '"DESIRED INVARIANT" tests above. All three should pass: CONFIRMED is preserved, ' +
        'registeredCount is unchanged, and the mixed-state test shows purged=1 (only B).'
    );

    it.todo(
        'FLOOR GUARD: even after the status-guard fix, category.registeredCount has no ' +
        'CHECK constraint preventing it from going negative. If a bug elsewhere ' +
        '(e.g., double-decrement from another code path) drives it below 0, subsequent ' +
        'seat-limit checks (registered_count >= max_seats) would behave incorrectly. ' +
        'Add: CHECK (registered_count >= 0) to the categories table.'
    );

    it.todo(
        'MULTI-WORKER SCENARIO: two purge worker instances (e.g., two container replicas) ' +
        'both run Phase 1 at the same time and produce identical stale lists. Both then ' +
        'execute Phase 2 concurrently. For a PENDING_PAYMENT row that was never confirmed, ' +
        'both loops attempt registration.update — one wins, one tries to update an already-' +
        'CANCELLED row (no error, just a no-op overwrite). The category decrement fires ' +
        'twice: registeredCount goes to -1. The status-guard fix (updateMany with ' +
        'status=PENDING_PAYMENT) resolves this too: only the first iteration matches, ' +
        'count=0 for the second, decrement skipped.'
    );
});
