/**
 * E2E: Webhook idempotency
 *
 * Validates that the same payment.captured webhook can be sent multiple times
 * without corrupting registration state or misreporting the seat counter.
 *
 * The idempotency guard in PaymentsService.handleWebhook() (payments.service.ts:61–64):
 *
 *   if (existing.razorpayPaymentId) {
 *       this.logger.log(`Duplicate webhook for payment ... — skipping`);
 *       return { status: 'ok' };
 *   }
 *
 * After the FIRST webhook sets razorpayPaymentId, all subsequent webhooks for
 * the same order ID hit this early-return and are no-ops.
 *
 * Flows covered:
 *   1. First webhook → CONFIRMED
 *   2. Second (duplicate) webhook → { status: 'ok' }, state unchanged
 *   3. registeredCount incremented exactly once (by trigger on INSERT)
 *   4. Purge + webhook race — final state consistent
 *
 * Run:
 *   npx jest --config apps/api/test/jest-app-e2e.json webhook-idempotency
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as supertest from 'supertest';

import {
    createApp,
    createTestOrganizer,
    createTournamentWithCategory,
    createPendingRegistration,
    createExpiredRegistration,
    triggerWebhook,
    runPurgeJob,
    getRegistrationFromDB,
    getCategoryFromDB,
    getPaymentFromDB,
    cleanupByEmail,
    makeMockRazorpay,
    TEST_WEBHOOK_SECRET,
} from '../../helpers/e2e.helpers';

const HAS_DB = Boolean(process.env.DATABASE_URL);
const describeIfDb = HAS_DB ? describe : describe.skip;

describeIfDb('Webhook idempotency (E2E)', () => {

    let app:     INestApplication;
    let request: supertest.SuperTest<supertest.Test>;
    let prisma:  PrismaClient;

    const RUN_TS        = Date.now();
    const ORGANIZER_EMAIL = `wi-e2e-organizer-${RUN_TS}@test.local`;

    const phone    = (n: number) => `+9183${String(RUN_TS).slice(-7)}${n}`;
    const entryNum = (n: number) => `WI-${RUN_TS}-${n}`;
    const orderId  = (n: number) => `order_wi_${RUN_TS}_${n}`;
    const payId    = (n: number) => `pay_wi_${RUN_TS}_${n}`;

    let organizerId:  string;
    let tournamentId: string;
    let categoryId:   string;

    beforeAll(async () => {
        prisma  = new PrismaClient();
        await prisma.$connect();
        await cleanupByEmail(prisma, ORGANIZER_EMAIL);

        // Counter-based mock: each createOrder() call gets a distinct order ID.
        const razorpayMock = makeMockRazorpay(`wi-${RUN_TS}`);
        let orderSeq = 0;
        razorpayMock.createOrder.mockImplementation(() =>
            Promise.resolve({ id: `order_wi_${RUN_TS}_${++orderSeq}` }),
        );

        app = await createApp(razorpayMock);
        request = supertest(app.getHttpServer());

        const org = await createTestOrganizer(prisma, ORGANIZER_EMAIL, RUN_TS.toString());
        organizerId = org.organizerId;

        ({ tournamentId, categoryId } = await createTournamentWithCategory(prisma, organizerId, {
            maxSeats: 20,
        }));
    }, 30_000);

    afterAll(async () => {
        await cleanupByEmail(prisma, ORGANIZER_EMAIL);
        await prisma.$disconnect();
        await app.close();
    }, 30_000);

    // ── Test 1: First webhook sets CONFIRMED ────────────────────────────────────

    it('first payment.captured webhook sets registration to CONFIRMED and payment to PAID', async () => {
        const reg = await createPendingRegistration(request, tournamentId, categoryId, phone(1));

        await triggerWebhook(request, reg.razorpayOrderId, payId(1)).expect(200);

        const dbReg = await getRegistrationFromDB(prisma, reg.registrationId);
        expect(dbReg.status).toBe('CONFIRMED');
        expect(dbReg.confirmedAt).not.toBeNull();

        const payment = await getPaymentFromDB(prisma, reg.registrationId);
        expect(payment?.status).toBe('PAID');
        expect(payment?.razorpayPaymentId).toBe(payId(1));
    }, 30_000);

    // ── Test 2: Duplicate webhook returns ok without changing state ──────────────

    it('second (duplicate) webhook returns { status: ok } and leaves state unchanged', async () => {
        const reg = await createPendingRegistration(request, tournamentId, categoryId, phone(2));

        // First webhook
        await triggerWebhook(request, reg.razorpayOrderId, payId(2)).expect(200);

        const afterFirst = await getRegistrationFromDB(prisma, reg.registrationId);
        const payAfterFirst = await getPaymentFromDB(prisma, reg.registrationId);

        expect(afterFirst.status).toBe('CONFIRMED');

        // Second webhook — identical payload
        const res = await triggerWebhook(request, reg.razorpayOrderId, payId(2)).expect(200);
        expect(res.body).toEqual({ status: 'ok' });

        // State must be identical to after the first webhook
        const afterSecond   = await getRegistrationFromDB(prisma, reg.registrationId);
        const payAfterSecond = await getPaymentFromDB(prisma, reg.registrationId);

        expect(afterSecond.status).toBe('CONFIRMED');
        expect(afterSecond.confirmedAt?.toISOString()).toBe(afterFirst.confirmedAt?.toISOString());
        expect(payAfterSecond?.status).toBe('PAID');
        expect(payAfterSecond?.razorpayPaymentId).toBe(payAfterFirst?.razorpayPaymentId);
    }, 30_000);

    // ── Test 3: registeredCount incremented only once ────────────────────────────

    it('registeredCount increments exactly once regardless of how many webhooks arrive', async () => {
        const catBefore = await getCategoryFromDB(prisma, categoryId);
        const countBefore = catBefore.registeredCount;

        const reg = await createPendingRegistration(request, tournamentId, categoryId, phone(3));

        const catAfterInsert = await getCategoryFromDB(prisma, categoryId);
        expect(catAfterInsert.registeredCount).toBe(countBefore + 1);  // trigger fired

        // Send the webhook three times
        for (let i = 0; i < 3; i++) {
            await triggerWebhook(request, reg.razorpayOrderId, payId(3)).expect(200);
        }

        // Count must still be countBefore + 1 (webhook never touches registeredCount)
        const catFinal = await getCategoryFromDB(prisma, categoryId);
        expect(catFinal.registeredCount).toBe(countBefore + 1);
    }, 30_000);

    // ── Test 4: N duplicate webhooks — status remains CONFIRMED throughout ───────

    it('10 duplicate webhooks all return ok and registration remains CONFIRMED', async () => {
        const reg = await createPendingRegistration(request, tournamentId, categoryId, phone(4));

        for (let i = 0; i < 10; i++) {
            const res = await triggerWebhook(request, reg.razorpayOrderId, payId(4)).expect(200);
            expect(res.body).toEqual({ status: 'ok' });
        }

        const dbReg = await getRegistrationFromDB(prisma, reg.registrationId);
        expect(dbReg.status).toBe('CONFIRMED');
    }, 30_000);

    // ── Test 5: Webhook for unknown order returns ignored ────────────────────────

    it('webhook for non-existent order returns { status: ignored }', async () => {
        const res = await triggerWebhook(request, 'order_does_not_exist', payId(5)).expect(200);
        expect(res.body).toEqual({ status: 'ignored' });
    }, 30_000);

    // ── Test 6: Purge + webhook race → final state is consistent ─────────────────

    it('concurrent purge + webhook — final state is consistent: status matches registeredCount', async () => {
        /**
         * Creates an expired PENDING_PAYMENT registration, then runs the purge
         * and the webhook in parallel (Promise.allSettled). With the fixed code:
         *
         *   - If webhook wins:
         *       - webhook: updateMany(PENDING_PAYMENT → CONFIRMED) count=1 → commits
         *       - purge:   updateMany(PENDING_PAYMENT → CANCELLED) count=0 → skips decrement
         *       - Final: CONFIRMED, registeredCount unchanged
         *
         *   - If purge wins:
         *       - purge:   updateMany(PENDING_PAYMENT → CANCELLED) count=1 → decrements
         *       - webhook: updateMany(PENDING_PAYMENT → CONFIRMED) count=0 → skips
         *       - payment.update still sets status=PAID (payment record is accurate)
         *       - Final: CANCELLED, registeredCount decremented
         *
         * Both outcomes are valid consistent states. The invariant is:
         *   CONFIRMED → registeredCount = countAfterInsert
         *   CANCELLED → registeredCount = countAfterInsert - 1
         */
        const { registrationId } = await createExpiredRegistration(
            prisma, tournamentId, categoryId, phone(6), entryNum(6), orderId(6),
        );

        const catAfterInsert = await getCategoryFromDB(prisma, categoryId);
        const countAfterInsert = catAfterInsert.registeredCount;

        const [purgeOutcome, webhookOutcome] = await Promise.allSettled([
            runPurgeJob(prisma, [registrationId]),
            triggerWebhook(request, orderId(6), payId(6)),
        ]);

        if (purgeOutcome.status  === 'rejected') throw purgeOutcome.reason;
        if (webhookOutcome.status === 'rejected') throw webhookOutcome.reason;

        const finalReg = await getRegistrationFromDB(prisma, registrationId);
        const finalCat = await getCategoryFromDB(prisma, categoryId);

        expect(['CONFIRMED', 'CANCELLED']).toContain(finalReg.status);

        if (finalReg.status === 'CONFIRMED') {
            // Webhook won — seat occupied
            expect(finalCat.registeredCount).toBe(countAfterInsert);
        } else {
            // Purge won — seat released
            expect(finalCat.registeredCount).toBe(countAfterInsert - 1);
            expect(finalCat.registeredCount).toBeGreaterThanOrEqual(0);
        }
    }, 30_000);

    // ── Test 7: Webhook for payment.failed does not affect registration ──────────

    it('payment.failed webhook leaves registration in PENDING_PAYMENT, payment.status = FAILED', async () => {
        const reg = await createPendingRegistration(request, tournamentId, categoryId, phone(7));

        const failedPayload = {
            event: 'payment.failed',
            payload: {
                payment: {
                    entity: {
                        id:       payId(7),
                        order_id: reg.razorpayOrderId,
                        status:   'failed',
                        amount:   50_000,
                        currency: 'INR',
                    },
                },
            },
        };

        const bodyString = JSON.stringify(failedPayload);
        const sig = require('crypto')
            .createHmac('sha256', TEST_WEBHOOK_SECRET)
            .update(bodyString)
            .digest('hex');

        await request
            .post('/api/v1/payments/webhook')
            .set('Content-Type', 'application/json')
            .set('x-razorpay-signature', sig)
            .send(bodyString)
            .expect(200);

        const dbReg = await getRegistrationFromDB(prisma, reg.registrationId);
        // registration stays PENDING_PAYMENT — payment.failed does not change it
        expect(dbReg.status).toBe('PENDING_PAYMENT');

        const payment = await getPaymentFromDB(prisma, reg.registrationId);
        expect(payment?.status).toBe('FAILED');
    }, 30_000);
});
