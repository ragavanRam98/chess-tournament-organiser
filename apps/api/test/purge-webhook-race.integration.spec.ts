/**
 * Integration test: PurgeExpiredProcessor vs payment.captured webhook — race condition.
 *
 * ── THE RACE ──────────────────────────────────────────────────────────────────
 *
 * Two processes run concurrently against the same PENDING_PAYMENT registration:
 *
 *   1. PaymentsService.handleWebhook  (payments.service.ts:67–79)
 *      Triggered when Razorpay fires payment.captured.
 *      Runs a $transaction that sets registration → CONFIRMED, payment → PAID.
 *
 *   2. PurgeExpiredProcessor.process  (purge-expired.processor.ts:25–66)
 *      Runs every 15 minutes, cancels PENDING_PAYMENT rows with expiresAt < now.
 *      Pattern: findMany first → loop → update each row individually.
 *
 * ── EXACT FAILURE PATH (Scenario C — purge wins the list read, webhook wins
 *    the DB commit, purge overwrites) ─────────────────────────────────────────
 *
 *   T_purge:   findMany(status=PENDING_PAYMENT, expiresAt<now)  → [reg.id] (stale read)
 *   T_webhook: payment.findUnique(razorpayOrderId) → existing (razorpayPaymentId=null)
 *   T_webhook: $transaction([payment→PAID, registration→CONFIRMED])  → COMMIT
 *   T_purge:   $transaction([
 *                registration.update(WHERE id=reg.id, SET status=CANCELLED),  ← NO status guard
 *                category.update(decrement)
 *              ])  → COMMIT  ← silently overwrites CONFIRMED with CANCELLED
 *
 *   Final (wrong):
 *     registration.status     = CANCELLED   (should be CONFIRMED)
 *     category.registeredCount = 0           (should be 1 — player paid and confirmed)
 *
 * Two further inconsistencies are possible in parallel scenarios:
 *
 *   Scenario B — purge commits first, webhook re-confirms a CANCELLED registration:
 *     - Purge: CONFIRMED→nope, PENDING_PAYMENT→CANCELLED, decrement
 *     - Webhook: registration.update(WHERE id, SET CONFIRMED) — no status guard —
 *       sets CANCELLED→CONFIRMED without re-incrementing registeredCount
 *     - Final: status=CONFIRMED, registeredCount=0  (inconsistent)
 *
 * ── ROOT CAUSE ────────────────────────────────────────────────────────────────
 *
 *   purge-expired.processor.ts:47–51 uses registration.update({ where: { id } })
 *   with NO status guard. This unconditionally overwrites any status, including
 *   CONFIRMED, with CANCELLED.
 *
 *   payments.service.ts:74–75 uses registration.update({ where: { id } }) with
 *   NO status guard. This can set CANCELLED→CONFIRMED without adjusting
 *   registeredCount (which the trigger only touches on INSERT, not on UPDATE).
 *
 * ── FIX ───────────────────────────────────────────────────────────────────────
 *
 *   In purge-expired.processor.ts, replace:
 *
 *     this.prisma.registration.update({
 *       where: { id: reg.id },
 *       data: { status: 'CANCELLED' },
 *     })
 *
 *   with a guarded updateMany:
 *
 *     const result = await tx.registration.updateMany({
 *       where: { id: reg.id, status: 'PENDING_PAYMENT' },  ← status guard
 *       data: { status: 'CANCELLED' },
 *     });
 *     if (result.count === 0) continue;  // webhook confirmed it — skip decrement
 *
 *   In payments.service.ts handleWebhook, similarly guard the registration update:
 *
 *     const result = await tx.registration.updateMany({
 *       where: { id: existing.registrationId, status: 'PENDING_PAYMENT' },
 *       data: { status: 'CONFIRMED', confirmedAt: new Date() },
 *     });
 *     if (result.count === 0) { /* already cancelled — handle accordingly *\/ }
 *
 *   Both fixes implement compare-and-swap at the row level: the update is a
 *   no-op if the status changed between the initial read and the write, and the
 *   calling code can inspect the count to decide whether to proceed.
 *
 * ── WHY A REAL DATABASE IS REQUIRED ──────────────────────────────────────────
 *
 *   The bug requires two independent Postgres connections that interleave at the
 *   level of SELECT (findMany) and UPDATE ($transaction). Jest mocks run
 *   synchronously in the same process and cannot reproduce this interleaving.
 *
 *   The DB trigger (registration_count_sync, migration 20260322120000) also
 *   participates — it increments registeredCount on INSERT. A mock cannot fire it.
 *
 * ── PREREQUISITES ─────────────────────────────────────────────────────────────
 *
 *   docker compose -f docker-compose.dev.yml up postgres -d --wait
 *   DATABASE_URL=postgresql://chess:chess_dev_password@localhost:5432/chess_tournament
 *   npx prisma migrate deploy  (run from repo root)
 *   npx jest --config apps/api/test/jest-e2e.json purge-webhook-race
 *
 * The test skips automatically if DATABASE_URL is not set.
 */

import * as crypto from 'crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { PaymentsService } from '../src/payments/payments.service';

// ── Skip guard ─────────────────────────────────────────────────────────────────

const HAS_DB = Boolean(process.env.DATABASE_URL);
const describeIfDb = HAS_DB ? describe : describe.skip;

// ── Webhook construction helper ────────────────────────────────────────────────

const WEBHOOK_SECRET = 'purge-webhook-race-test-secret';

function buildWebhookArgs(
    razorpayOrderId: string,
    razorpayPaymentId: string,
): { rawBody: Buffer; sig: string; body: object } {
    const body = {
        event: 'payment.captured',
        payload: {
            payment: {
                entity: {
                    id: razorpayPaymentId,
                    order_id: razorpayOrderId,
                    status: 'captured',
                    amount: 50_000,
                    currency: 'INR',
                },
            },
        },
    };
    const rawBody = Buffer.from(JSON.stringify(body));
    const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
    return { rawBody, sig, body };
}

// ── Suite ──────────────────────────────────────────────────────────────────────

describeIfDb('PurgeExpiredProcessor vs payment.captured webhook — race condition', () => {

    let prisma: PrismaService;
    let paymentsService: PaymentsService;
    let tournamentId: string;

    const RUN_TS = Date.now();

    // ── Module setup ─────────────────────────────────────────────────────────────

    beforeAll(async () => {
        /**
         * PaymentsService dependencies:
         *   PrismaService  — REAL  (must issue real SQL)
         *   QueueService   — MOCKED (handleWebhook calls queue.add after the transaction
         *                           to enqueue a confirmation email; irrelevant to the race)
         *   RazorpayService — MOCKED (handleWebhook does not call any RazorpayService method;
         *                            only createOrder/refundPayment do)
         */
        process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
        process.env.RAZORPAY_KEY_ID = 'rzp_test_dummy';

        prisma = new PrismaService();
        // PrismaClient auto-connects on first query, but explicit connect is cleaner
        await prisma.$connect();

        paymentsService = new PaymentsService(
            prisma,
            { add: jest.fn() } as any,
            {} as any,           // RazorpayService — no methods called in handleWebhook
        );

        // Wipe any stale data from a previous failed run
        await cleanupByEmail('purge-webhook-race@integration.local');

        // ── Create base fixtures: User → Organizer → Tournament ──────────────────
        const user = await prisma.user.create({
            data: {
                email: 'purge-webhook-race@integration.local',
                passwordHash: '$integration-test-not-a-real-hash$',
                role: 'ORGANIZER',
                status: 'ACTIVE',
            },
        });

        const organizer = await prisma.organizer.create({
            data: {
                userId: user.id,
                academyName: 'Race Test Academy',
                contactPhone: '+910000000099',
                city: 'Test City',
            },
        });

        const tournament = await prisma.tournament.create({
            data: {
                organizerId: organizer.id,
                title: 'Purge Webhook Race Tournament',
                city: 'Test City',
                venue: 'Test Venue',
                startDate: new Date('2030-06-01'),
                endDate: new Date('2030-06-03'),
                registrationDeadline: new Date('2030-05-31'),
                status: 'APPROVED',
            },
        });
        tournamentId = tournament.id;
    }, 30_000);

    afterAll(async () => {
        if (prisma) await cleanupByEmail('purge-webhook-race@integration.local');
        await prisma?.$disconnect();
    }, 30_000);

    // ── Helpers ───────────────────────────────────────────────────────────────────

    /**
     * Deletes all test fixture data for the given email in FK-safe order.
     * Safe to call even if some or all fixtures are absent (no-op per entity).
     */
    async function cleanupByEmail(email: string): Promise<void> {
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return;

        const organizer = await prisma.organizer.findUnique({ where: { userId: user.id } });
        if (organizer) {
            const tIds = (await prisma.tournament.findMany({
                where: { organizerId: organizer.id },
                select: { id: true },
            })).map((t) => t.id);

            if (tIds.length > 0) {
                // Must delete Payment rows before Registration (FK RESTRICT)
                const regIds = (await prisma.registration.findMany({
                    where: { tournamentId: { in: tIds } },
                    select: { id: true },
                })).map((r) => r.id);

                if (regIds.length > 0) {
                    await prisma.payment.deleteMany({ where: { registrationId: { in: regIds } } });
                }
                await prisma.registration.deleteMany({ where: { tournamentId: { in: tIds } } });
                // Tournament deletion cascades to categories
                await prisma.tournament.deleteMany({ where: { id: { in: tIds } } });
            }
        }
        // User deletion cascades to organizer
        await prisma.user.delete({ where: { id: user.id } });
    }

    /**
     * Creates a fresh Category + Registration (PENDING_PAYMENT, already expired) +
     * Payment (INITIATED, razorpayPaymentId=null) in one go.
     *
     * Each call uses a unique seq to avoid entry_number and razorpayOrderId collisions.
     *
     * The DB trigger `registration_count_sync` fires on INSERT and increments
     * category.registeredCount automatically — no manual increment needed here.
     */
    async function createFixture(seq: number): Promise<{
        categoryId: string;
        regId: string;
        razorpayOrderId: string;
        razorpayPaymentId: string;
    }> {
        const razorpayOrderId  = `order_pwr_${RUN_TS}_${seq}`;
        const razorpayPaymentId = `pay_pwr_${RUN_TS}_${seq}`;

        const category = await prisma.category.create({
            data: {
                tournamentId,
                name: `Race Category ${seq}`,
                minAge: 0,
                maxAge: 99,
                entryFeePaise: 50_000,
                maxSeats: 5,
                registeredCount: 0,
            },
        });

        const reg = await prisma.registration.create({
            data: {
                tournamentId,
                categoryId: category.id,
                playerName: `Race Player ${seq}`,
                playerDob: new Date('2000-01-01'),
                phone: `+9171${String(RUN_TS).slice(-7)}${seq}`,  // unique per run + seq, ≤ 15 chars
                entryNumber: `PWR-${RUN_TS}-${seq}`,              // unique per run + seq, ≤ 25 chars
                status: 'PENDING_PAYMENT',
                expiresAt: new Date(Date.now() - 2_000),          // expired 2 seconds ago
            },
        });

        // Payment in INITIATED state — razorpayPaymentId is null (not yet captured)
        await prisma.payment.create({
            data: {
                registrationId: reg.id,
                razorpayOrderId,
                amountPaise: 50_000,
                status: 'INITIATED',
            },
        });

        return { categoryId: category.id, regId: reg.id, razorpayOrderId, razorpayPaymentId };
    }

    // ── Tests ──────────────────────────────────────────────────────────────────────

    it('STAGED RACE: purge overwrites CONFIRMED with CANCELLED (demonstrates the bug in current code)', async () => {
        /**
         * This test manually stages the exact interleaving that causes the bug.
         * It is deterministic — the bug ALWAYS manifests under this sequence.
         *
         * The three steps below correspond to the actual production execution order
         * that triggers the failure (Scenario C from the header comment).
         */
        const { categoryId, regId, razorpayOrderId, razorpayPaymentId } = await createFixture(1);
        const { rawBody, sig, body } = buildWebhookArgs(razorpayOrderId, razorpayPaymentId);

        // ── STEP 1: Purge reads the list of expired registrations ─────────────────
        //
        // PurgeExpiredProcessor.process() (purge-expired.processor.ts:32–38):
        //
        //   const expired = await this.prisma.registration.findMany({
        //     where: { status: 'PENDING_PAYMENT', expiresAt: { lt: now } },
        //     select: { id, categoryId, entryNumber },
        //   });
        //
        // After this read, the processor holds reg.id in memory.
        // No lock is held — any concurrent transaction can change the status
        // between this findMany and the upcoming update loop.
        const staleList = await prisma.registration.findMany({
            where: {
                tournamentId,        // scope to test data
                id: regId,           // further scope to this fixture
                status: 'PENDING_PAYMENT',
                expiresAt: { lt: new Date() },
            },
            select: { id: true, categoryId: true, entryNumber: true },
        });
        expect(staleList).toHaveLength(1); // sanity check — fixture is in the list

        // ── STEP 2: Webhook arrives and confirms the payment ──────────────────────
        //
        // payment.captured event: handleWebhook() runs its $transaction
        // (payments.service.ts:67–79) and commits:
        //   payment  → PAID  (razorpayPaymentId set)
        //   registration → CONFIRMED (confirmedAt set)
        //
        // After this COMMIT, the registration is CONFIRMED in Postgres.
        // The purge processor still holds the stale list from step 1 in memory.
        await paymentsService.handleWebhook(rawBody, sig, body);

        const afterWebhook = await prisma.registration.findUniqueOrThrow({ where: { id: regId } });
        expect(afterWebhook.status).toBe('CONFIRMED'); // webhook succeeded

        const catAfterWebhook = await prisma.category.findUniqueOrThrow({ where: { id: categoryId } });
        const countAfterWebhook = catAfterWebhook.registeredCount; // trigger set this to 1 on INSERT

        // ── STEP 3: Purge runs its update loop with the stale list ────────────────
        //
        // PurgeExpiredProcessor.process() (purge-expired.processor.ts:44–57):
        //
        //   for (const reg of expired) {
        //     await this.prisma.$transaction([
        //       this.prisma.registration.update({
        //         where: { id: reg.id },           ← NO status guard
        //         data: { status: 'CANCELLED' },
        //       }),
        //       this.prisma.category.update({
        //         where: { id: reg.categoryId },
        //         data: { registeredCount: { decrement: 1 } },
        //       }),
        //     ]);
        //   }
        //
        // The WHERE clause filters only by id, not by status. The UPDATE succeeds
        // regardless of the current status — it blindly overwrites CONFIRMED
        // with CANCELLED and decrements the seat counter.
        for (const reg of staleList) {
            await prisma.$transaction([
                prisma.registration.update({
                    where: { id: reg.id },
                    data: { status: 'CANCELLED' },
                }),
                prisma.category.update({
                    where: { id: reg.categoryId },
                    data: { registeredCount: { decrement: 1 } },
                }),
            ]);
        }

        // ── ASSERT: the bug manifests ─────────────────────────────────────────────

        const afterPurge = await prisma.registration.findUniqueOrThrow({ where: { id: regId } });
        const catAfterPurge = await prisma.category.findUniqueOrThrow({ where: { id: categoryId } });

        /**
         * THE BUG:
         *   The player completed payment. The webhook confirmed them. But the purge
         *   job — which captured the registration ID before the webhook ran —
         *   overwrites CONFIRMED → CANCELLED and decrements the seat counter.
         *
         *   Correct final state:  status=CONFIRMED,  registeredCount=countAfterWebhook
         *   Actual final state:   status=CANCELLED,  registeredCount=countAfterWebhook-1
         *
         * FIX (purge-expired.processor.ts):
         *   Replace registration.update({ where: { id } }) with:
         *
         *     const result = await tx.registration.updateMany({
         *       where: { id: reg.id, status: 'PENDING_PAYMENT' },
         *       data: { status: 'CANCELLED' },
         *     });
         *     if (result.count === 0) continue;  // already confirmed — skip decrement
         *
         *   updateMany returns 0 rows if the status is no longer PENDING_PAYMENT,
         *   which means the webhook beat this loop iteration. The `continue` preserves
         *   the seat counter, which is correct because the CONFIRMED player occupies the seat.
         */
        expect(afterPurge.status).toBe('CANCELLED');                              // BUG — should be CONFIRMED
        expect(catAfterPurge.registeredCount).toBe(countAfterWebhook - 1);        // BUG — should be countAfterWebhook
    }, 30_000);

    it('Promise.allSettled concurrent run — final state must be consistent: status matches registeredCount', async () => {
        /**
         * Runs the real purge DB operations and the real webhook handler in parallel.
         * The race is non-deterministic: which interleaving occurs depends on Postgres
         * connection scheduling and timing within the connection pool.
         *
         * This test documents the INVARIANT that must hold regardless of interleaving:
         *   CONFIRMED → registeredCount equals the count set by the INSERT trigger (baseCount)
         *   CANCELLED → registeredCount equals baseCount - 1 (purge decremented)
         *
         * On the CURRENT code (no status guard on either update), this test may FAIL
         * when Scenario B or C from the header occurs:
         *   Scenario B: status=CONFIRMED, registeredCount=baseCount-1  (inconsistent)
         *   Scenario C: status=CANCELLED, registeredCount=baseCount-1  (possible, but here
         *               the webhook has no further effect since purge ran the decrement)
         *
         * The test will reliably pass only after both fixes (purge updateMany guard +
         * webhook updateMany guard) are applied.
         */
        const { categoryId, regId, razorpayOrderId, razorpayPaymentId } = await createFixture(2);
        const { rawBody, sig, body } = buildWebhookArgs(razorpayOrderId, razorpayPaymentId);

        // Capture registeredCount right after INSERT (trigger has incremented it)
        const afterInsert = await prisma.category.findUniqueOrThrow({ where: { id: categoryId } });
        const baseCount = afterInsert.registeredCount; // expected: 1

        const [purgeOutcome, webhookOutcome] = await Promise.allSettled([
            /**
             * Purge path — replicates PurgeExpiredProcessor.process() exactly:
             *   1. findMany(status=PENDING_PAYMENT, expiresAt<now)
             *   2. for each: $transaction([update(CANCELLED), category decrement])
             *
             * Scoped to this fixture's registration so other concurrent DB data is
             * not affected. The production query has no such scope but the semantic
             * is identical.
             */
            (async () => {
                const expired = await prisma.registration.findMany({
                    where: {
                        tournamentId,
                        id: regId,
                        status: 'PENDING_PAYMENT',
                        expiresAt: { lt: new Date() },
                    },
                    select: { id: true, categoryId: true, entryNumber: true },
                });
                for (const reg of expired) {
                    await prisma.$transaction([
                        prisma.registration.update({
                            where: { id: reg.id },
                            data: { status: 'CANCELLED' },
                        }),
                        prisma.category.update({
                            where: { id: reg.categoryId },
                            data: { registeredCount: { decrement: 1 } },
                        }),
                    ]);
                }
            })(),

            /**
             * Webhook path — calls PaymentsService.handleWebhook() directly,
             * which runs the full production code including HMAC verification,
             * idempotency check, and $transaction(payment→PAID, registration→CONFIRMED).
             */
            paymentsService.handleWebhook(rawBody, sig, body),
        ]);

        // Neither operation is expected to throw under normal conditions
        if (purgeOutcome.status  === 'rejected') throw purgeOutcome.reason;
        if (webhookOutcome.status === 'rejected') throw webhookOutcome.reason;

        const finalReg = await prisma.registration.findUniqueOrThrow({ where: { id: regId } });
        const finalCat = await prisma.category.findUniqueOrThrow({ where: { id: categoryId } });

        /**
         * Valid consistent outcomes:
         *
         *   A) Webhook commits BEFORE purge's findMany:
         *      - findMany returns empty (status already CONFIRMED ≠ PENDING_PAYMENT)
         *      - purge is a no-op for this registration
         *      - Final: status=CONFIRMED, registeredCount=baseCount  ✓
         *
         *   D) Purge commits BEFORE webhook reads:
         *      - Purge cancels and decrements
         *      - Webhook's idempotency check: existing.razorpayPaymentId is null → proceeds
         *      - Webhook sets CANCELLED→CONFIRMED (no status guard — see Scenario B above)
         *      - registeredCount stays at baseCount-1 (no re-increment)
         *      - Final: status=CONFIRMED, registeredCount=baseCount-1  ✗ (Scenario B bug)
         *
         * The assertion below encodes the DESIRED invariant (after fix).
         * On current code it may fail when the interleaving produces Scenario B or C.
         */
        expect(['CONFIRMED', 'CANCELLED']).toContain(finalReg.status);

        if (finalReg.status === 'CONFIRMED') {
            // Seat is occupied — count must equal what the trigger set on INSERT
            expect(finalCat.registeredCount).toBe(baseCount);
        } else {
            // Seat was released by purge
            expect(finalCat.registeredCount).toBe(baseCount - 1);
        }
    }, 30_000);

    it('purge in isolation — correctly cancels PENDING_PAYMENT and decrements registeredCount', async () => {
        /**
         * Baseline: no concurrent webhook. Purge runs alone and must produce a
         * consistent CANCELLED state with the seat counter decremented.
         */
        const { categoryId, regId } = await createFixture(3);

        const afterInsert = await prisma.category.findUniqueOrThrow({ where: { id: categoryId } });
        const countBefore = afterInsert.registeredCount; // trigger set this to 1

        // Purge logic (purge-expired.processor.ts:32–57), scoped to fixture
        const expired = await prisma.registration.findMany({
            where: {
                tournamentId,
                id: regId,
                status: 'PENDING_PAYMENT',
                expiresAt: { lt: new Date() },
            },
            select: { id: true, categoryId: true, entryNumber: true },
        });
        for (const reg of expired) {
            await prisma.$transaction([
                prisma.registration.update({
                    where: { id: reg.id },
                    data: { status: 'CANCELLED' },
                }),
                prisma.category.update({
                    where: { id: reg.categoryId },
                    data: { registeredCount: { decrement: 1 } },
                }),
            ]);
        }

        const finalReg = await prisma.registration.findUniqueOrThrow({ where: { id: regId } });
        const finalCat = await prisma.category.findUniqueOrThrow({ where: { id: categoryId } });

        expect(finalReg.status).toBe('CANCELLED');
        expect(finalCat.registeredCount).toBe(countBefore - 1);
    }, 30_000);

    it('webhook in isolation — correctly confirms and leaves registeredCount unchanged', async () => {
        /**
         * Baseline: no concurrent purge. Webhook runs alone. The registration must
         * end up CONFIRMED, confirmedAt must be set, and registeredCount must be
         * unchanged — the webhook does NOT touch registeredCount (only the DB trigger
         * on INSERT does).
         */
        const { categoryId, regId, razorpayOrderId, razorpayPaymentId } = await createFixture(4);
        const { rawBody, sig, body } = buildWebhookArgs(razorpayOrderId, razorpayPaymentId);

        const afterInsert = await prisma.category.findUniqueOrThrow({ where: { id: categoryId } });
        const countBefore = afterInsert.registeredCount; // trigger set this to 1

        await paymentsService.handleWebhook(rawBody, sig, body);

        const finalReg = await prisma.registration.findUniqueOrThrow({ where: { id: regId } });
        const finalCat = await prisma.category.findUniqueOrThrow({ where: { id: categoryId } });

        expect(finalReg.status).toBe('CONFIRMED');
        expect(finalReg.confirmedAt).not.toBeNull();
        expect(finalCat.registeredCount).toBe(countBefore); // webhook does NOT touch registeredCount
    }, 30_000);

    it('webhook idempotency — a duplicate payment.captured event for the same order is ignored', async () => {
        /**
         * Verifies the existing idempotency guard in handleWebhook (payments.service.ts:61–64):
         *
         *   if (existing.razorpayPaymentId) { return { status: 'ok' } }
         *
         * A second webhook call after the first has set razorpayPaymentId must be
         * a no-op, leaving the registration CONFIRMED and not creating any corruption.
         */
        const { categoryId, regId, razorpayOrderId, razorpayPaymentId } = await createFixture(5);
        const { rawBody, sig, body } = buildWebhookArgs(razorpayOrderId, razorpayPaymentId);

        // First webhook — confirms the registration
        await paymentsService.handleWebhook(rawBody, sig, body);

        const afterFirst = await prisma.registration.findUniqueOrThrow({ where: { id: regId } });
        expect(afterFirst.status).toBe('CONFIRMED');

        const catAfterFirst = await prisma.category.findUniqueOrThrow({ where: { id: categoryId } });
        const countAfterFirst = catAfterFirst.registeredCount;

        // Second webhook — same payload, same signature — must be a no-op
        const secondResult = await paymentsService.handleWebhook(rawBody, sig, body);
        expect(secondResult).toEqual({ status: 'ok' });

        const afterSecond = await prisma.registration.findUniqueOrThrow({ where: { id: regId } });
        const catAfterSecond = await prisma.category.findUniqueOrThrow({ where: { id: categoryId } });

        // State must be identical to after the first webhook
        expect(afterSecond.status).toBe('CONFIRMED');
        expect(catAfterSecond.registeredCount).toBe(countAfterFirst);
    }, 30_000);

    // ── Documented gaps ────────────────────────────────────────────────────────────

    it.todo(
        'FIX VERIFICATION (purge status guard): after replacing registration.update with ' +
        'registration.updateMany({ where: { id, status: "PENDING_PAYMENT" } }) in ' +
        'purge-expired.processor.ts, the staged race (test 1) should leave the registration ' +
        'CONFIRMED and registeredCount unchanged. updateMany returns count=0 when the ' +
        'status is already CONFIRMED, which skips the decrement.'
    );

    it.todo(
        'FIX VERIFICATION (webhook status guard): when purge wins the race (cancels first) ' +
        'and the webhook fires after, the webhook must NOT set CANCELLED→CONFIRMED without ' +
        're-incrementing registeredCount. Fix: use registration.updateMany with status guard ' +
        '{ where: { id, status: "PENDING_PAYMENT" } } in payments.service.ts handleWebhook. ' +
        'If count=0 (registration was cancelled), the webhook should return early or trigger ' +
        'a refund rather than silently confirming a cancelled registration.'
    );

    it.todo(
        'TRIPLE INTERLEAVING: two concurrent webhooks (duplicate delivery) PLUS a concurrent ' +
        'purge all targeting the same registration. Razorpay can deliver the same webhook event ' +
        'more than once during retries. The idempotency guard (razorpayPaymentId check) only ' +
        'handles the second webhook arriving after the first committed. It does not handle the ' +
        'case where both arrive before either has set razorpayPaymentId — a TOCTOU on the ' +
        'payment.findUnique check itself.'
    );
});
