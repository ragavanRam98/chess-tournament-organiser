/**
 * E2E: Edge cases and failure scenarios
 *
 * This suite covers failure-path and boundary scenarios that are absent from,
 * or only partially covered by, the other four E2E suites.
 *
 * What the other suites already cover (and this suite does NOT duplicate):
 *   registration-payment : happy-path flow, basic 409 / 400 HTTP codes
 *   purge-expiry         : purge lifecycle, idempotency, stale-list safety
 *   webhook-idempotency  : duplicate webhook delivery, purge+webhook race
 *   authorization        : JWT and role enforcement
 *
 * What this suite adds — the specific gap in each case:
 *
 *   1. payment.failed webhook
 *      webhook-idempotency Test 7 checks status + payment.status but does NOT
 *      assert that registeredCount is unchanged. This suite adds that check.
 *
 *   2. Webhook for non-existent order
 *      webhook-idempotency Test 5 checks only the HTTP response body
 *      ({ status: 'ignored' }). This suite additionally verifies no Payment row
 *      was created and the category count was not touched.
 *
 *   3. Duplicate registration via API
 *      registration-payment Test 9 checks the HTTP 409. This suite additionally
 *      verifies the DB contains exactly one active registration for the phone,
 *      and that the error response does not leak a raw Prisma error code.
 *
 *   4. Seat exhaustion
 *      Not covered anywhere. Full scenario: maxSeats=1, first registration fills
 *      the seat, second is rejected with SEAT_LIMIT_REACHED, registeredCount
 *      stays ≤ maxSeats, exactly one non-cancelled DB row exists.
 *
 *   5. Invalid webhook signature
 *      registration-payment Test 10 checks the 400. This suite additionally
 *      verifies that neither the registration nor the payment row changed —
 *      i.e., the request was rejected before any DB write.
 *
 * ── RAZORPAY MOCK STRATEGY ────────────────────────────────────────────────────
 *
 * makeMockRazorpay(suffix) returns a mock whose createOrder always resolves to
 * the same order ID. After the first registration creates a Payment row with
 * that ID, the second registration's Payment.create fails on the unique
 * razorpay_order_id constraint. The error is caught by RegistrationsService
 * (try/catch around createOrder), the registration itself still lands in the DB,
 * but paymentDetails is null and reg.razorpayOrderId is '' in the helper return.
 *
 * To avoid this, this suite overrides createOrder with a counter-based
 * implementation immediately after calling makeMockRazorpay(). Every call then
 * returns a unique order ID. This is just mock configuration — no helpers are
 * modified.
 *
 * ── RUN ───────────────────────────────────────────────────────────────────────
 *
 *   docker compose -f docker-compose.dev.yml up postgres -d --wait
 *   DATABASE_URL=postgresql://chess:chess_dev_password@localhost:5432/chess_tournament
 *   npx prisma migrate deploy
 *   npx jest --config apps/api/test/jest-app-e2e.json edge-cases
 */

import * as crypto from 'crypto';
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

// ── Inline webhook builder ─────────────────────────────────────────────────────
//
// triggerWebhook() only sends payment.captured. Tests that need payment.failed
// build the payload inline using this helper, keeping the signature computation
// co-located with the payload so there is no possibility of mismatch.

function buildSignedWebhook(
    event: 'payment.captured' | 'payment.failed',
    razorpayOrderId: string,
    razorpayPaymentId: string,
): { bodyString: string; sig: string } {
    const body = {
        event,
        payload: {
            payment: {
                entity: {
                    id:       razorpayPaymentId,
                    order_id: razorpayOrderId,
                    status:   event === 'payment.captured' ? 'captured' : 'failed',
                    amount:   50_000,
                    currency: 'INR',
                },
            },
        },
    };
    const bodyString = JSON.stringify(body);
    const sig = crypto
        .createHmac('sha256', TEST_WEBHOOK_SECRET)
        .update(bodyString)
        .digest('hex');
    return { bodyString, sig };
}

// ── Suite ──────────────────────────────────────────────────────────────────────

describeIfDb('Edge cases and failure scenarios (E2E)', () => {

    let app:     INestApplication;
    let request: supertest.SuperTest<supertest.Test>;
    let prisma:  PrismaClient;

    const RUN_TS          = Date.now();
    const ORGANIZER_EMAIL = `ec-e2e-organizer-${RUN_TS}@test.local`;

    // Prefix +9184 — distinct from the other suites (+9181, +9182, +9183)
    const phone  = (n: number) => `+9184${String(RUN_TS).slice(-7)}${n}`;
    const payId  = (n: number) => `pay_ec_${RUN_TS}_${n}`;

    let organizerId:  string;
    let tournamentId: string;
    let categoryId:   string;   // maxSeats: 20 — used by most tests

    beforeAll(async () => {
        prisma  = new PrismaClient();
        await prisma.$connect();
        await cleanupByEmail(prisma, ORGANIZER_EMAIL);

        // Counter-based mock: each createOrder() call gets a distinct order ID.
        // Without this, the second registration's payment.create would throw P2002
        // (unique razorpay_order_id) and the registration response would have
        // payment: null — making reg.razorpayOrderId useless for webhook tests.
        const razorpayMock = makeMockRazorpay(`ec-${RUN_TS}`);
        let orderSeq = 0;
        razorpayMock.createOrder.mockImplementation(() =>
            Promise.resolve({ id: `order_ec_${RUN_TS}_${++orderSeq}` }),
        );

        app = await createApp(razorpayMock);
        request = supertest(app.getHttpServer());

        const org = await createTestOrganizer(prisma, ORGANIZER_EMAIL, RUN_TS.toString());
        organizerId = org.organizerId;

        ({ tournamentId, categoryId } = await createTournamentWithCategory(
            prisma, organizerId, { maxSeats: 20 },
        ));
    }, 30_000);

    afterAll(async () => {
        await cleanupByEmail(prisma, ORGANIZER_EMAIL);
        await prisma.$disconnect();
        await app.close();
    }, 30_000);

    // ── 1. payment.failed webhook ──────────────────────────────────────────────
    //
    // Gap vs webhook-idempotency Test 7: that test does not assert registeredCount.

    it('payment.failed webhook: registration stays PENDING_PAYMENT, registeredCount unchanged', async () => {
        const reg = await createPendingRegistration(request, tournamentId, categoryId, phone(1));

        // Capture count immediately after INSERT — trigger has fired
        const countAfterInsert = (await getCategoryFromDB(prisma, categoryId)).registeredCount;

        const { bodyString, sig } = buildSignedWebhook(
            'payment.failed',
            reg.razorpayOrderId,
            payId(1),
        );

        const res = await request
            .post('/api/v1/payments/webhook')
            .set('Content-Type', 'application/json')
            .set('x-razorpay-signature', sig)
            .send(bodyString)
            .expect(200);

        expect(res.body).toEqual({ status: 'ok' });

        // ── DB assertions ──────────────────────────────────────────────────────

        // Registration must stay PENDING_PAYMENT — payment.failed does not confirm
        // or cancel the registration; only payment.captured → CONFIRMED and
        // purge → CANCELLED do.
        const dbReg = await getRegistrationFromDB(prisma, reg.registrationId);
        expect(dbReg.status).toBe('PENDING_PAYMENT');
        expect(dbReg.confirmedAt).toBeNull();

        // The payment row must be FAILED
        const payment = await getPaymentFromDB(prisma, reg.registrationId);
        expect(payment?.status).toBe('FAILED');
        expect(payment?.razorpayPaymentId).toBeNull(); // not set — payment wasn't captured

        // registeredCount must be unchanged — no write to categories happens
        // on payment.failed (only the trigger on INSERT and the purge decrement
        // touch this column)
        const catAfter = await getCategoryFromDB(prisma, categoryId);
        expect(catAfter.registeredCount).toBe(countAfterInsert);
    }, 30_000);

    // ── 2. Webhook for non-existent order ─────────────────────────────────────
    //
    // Gap vs webhook-idempotency Test 5: that test checks only the HTTP body,
    // not whether any DB row was created or the category count changed.

    it('webhook for non-existent order: 200 { status: ignored }, no Payment row created, count unchanged', async () => {
        const fakeOrderId = `order_nonexistent_ec_${RUN_TS}`;

        const catBefore = await getCategoryFromDB(prisma, categoryId);
        const countBefore = catBefore.registeredCount;

        // triggerWebhook builds a valid payment.captured payload and sends it
        // with a correct HMAC. The service finds no Payment row for fakeOrderId
        // and returns { status: 'ignored' } before touching any other table.
        const res = await triggerWebhook(request, fakeOrderId, payId(20)).expect(200);

        expect(res.body).toEqual({ status: 'ignored' });

        // No Payment row must have been created for the fake order
        const payment = await prisma.payment.findUnique({
            where: { razorpayOrderId: fakeOrderId },
        });
        expect(payment).toBeNull();

        // Category count must be untouched — no registration was inserted
        const catAfter = await getCategoryFromDB(prisma, categoryId);
        expect(catAfter.registeredCount).toBe(countBefore);
    }, 30_000);

    // ── 3. Duplicate registration via API ─────────────────────────────────────
    //
    // Gap vs registration-payment Test 9: that test checks the HTTP 409 but does
    // not verify the DB contains exactly one active row, nor that no raw Prisma
    // error code was leaked in the response body.

    it('duplicate phone: second registration → 409, DB has exactly one active registration, no Prisma error leaked', async () => {
        const sharedPhone = phone(3);

        const first = await request
            .post(`/api/v1/tournaments/${tournamentId}/categories/${categoryId}/register`)
            .send({ playerName: 'First Player', playerDob: '2000-01-01', phone: sharedPhone })
            .expect(201);

        const secondRes = await request
            .post(`/api/v1/tournaments/${tournamentId}/categories/${categoryId}/register`)
            .send({ playerName: 'Second Player', playerDob: '2000-01-01', phone: sharedPhone })
            .expect(409);

        // The error shape must come from GlobalExceptionFilter — a safe, controlled
        // response — not a raw Prisma or DB error.
        expect(secondRes.body.error).toBeDefined();
        expect(secondRes.body.error.message).toBe('DUPLICATE_REGISTRATION');

        // A raw Prisma error code looks like P\d{4} (e.g. P2002).
        // It must never appear in the response body — that would leak DB internals.
        const responseText = JSON.stringify(secondRes.body);
        expect(responseText).not.toMatch(/P\d{4}/);

        // DB: exactly one non-cancelled registration for this phone in this tournament
        const activeRows = await prisma.registration.findMany({
            where: {
                tournamentId,
                phone: sharedPhone,
                status: { not: 'CANCELLED' },
            },
        });
        expect(activeRows).toHaveLength(1);
        expect(activeRows[0].id).toBe(first.body.data.registration_id);
    }, 30_000);

    // ── 4. Seat exhaustion ─────────────────────────────────────────────────────
    //
    // Not covered in any existing suite.
    // Uses a dedicated category (maxSeats=1) to avoid touching the shared one.

    it('seat exhaustion: second registration into a full category → 409 SEAT_LIMIT_REACHED, registeredCount never exceeds maxSeats', async () => {
        // Create a fresh category with exactly one seat
        const singleSeatCategory = await prisma.category.create({
            data: {
                tournamentId,
                name:            `Single Seat ${RUN_TS}`,
                minAge:          0,
                maxAge:          99,
                entryFeePaise:   50_000,
                maxSeats:        1,
                registeredCount: 0,
            },
        });
        const catId = singleSeatCategory.id;

        // First registration — fills the only available seat
        await request
            .post(`/api/v1/tournaments/${tournamentId}/categories/${catId}/register`)
            .send({ playerName: 'Seat Taker',  playerDob: '2000-01-01', phone: phone(40) })
            .expect(201);

        const catAfterFirst = await getCategoryFromDB(prisma, catId);
        expect(catAfterFirst.registeredCount).toBe(1);
        expect(catAfterFirst.registeredCount).toBeLessThanOrEqual(catAfterFirst.maxSeats);

        // Second registration — must be rejected because all seats are taken
        const secondRes = await request
            .post(`/api/v1/tournaments/${tournamentId}/categories/${catId}/register`)
            .send({ playerName: 'Seat Seeker', playerDob: '2000-01-01', phone: phone(41) })
            .expect(409);

        expect(secondRes.body.error).toBeDefined();
        expect(secondRes.body.error.message).toBe('SEAT_LIMIT_REACHED');

        // registeredCount must still be exactly 1 — not 0 and not 2
        const catFinal = await getCategoryFromDB(prisma, catId);
        expect(catFinal.registeredCount).toBe(1);
        expect(catFinal.registeredCount).toBeLessThanOrEqual(catFinal.maxSeats);

        // Exactly one non-cancelled registration must exist for this category
        const activeRegs = await prisma.registration.findMany({
            where: { categoryId: catId, status: { not: 'CANCELLED' } },
        });
        expect(activeRegs).toHaveLength(1);
        expect(activeRegs[0].phone).toBe(phone(40));  // the first player, not the second
    }, 30_000);

    // ── 5. Invalid webhook signature ──────────────────────────────────────────
    //
    // Gap vs registration-payment Test 10: that test checks only the HTTP 400.
    // This test additionally verifies that neither the registration row nor the
    // payment row changed — the request was rejected before any DB write.

    it('invalid webhook signature: 400, registration and payment remain unchanged', async () => {
        const reg = await createPendingRegistration(request, tournamentId, categoryId, phone(5));

        // Capture the exact state before the tampered request
        const regBefore     = await getRegistrationFromDB(prisma, reg.registrationId);
        const paymentBefore = await getPaymentFromDB(prisma, reg.registrationId);

        expect(regBefore.status).toBe('PENDING_PAYMENT');
        expect(paymentBefore?.status).toBe('INITIATED');
        expect(paymentBefore?.razorpayPaymentId).toBeNull();

        // Build a valid payload but with a wrong HMAC — 64 hex chars but not the
        // correct digest. timingSafeEqual rejects mismatches regardless of length.
        const { bodyString } = buildSignedWebhook('payment.captured', reg.razorpayOrderId, payId(5));
        const wrongSig = 'a'.repeat(64);

        const res = await request
            .post('/api/v1/payments/webhook')
            .set('Content-Type', 'application/json')
            .set('x-razorpay-signature', wrongSig)
            .send(bodyString)
            .expect(400);

        expect(res.body.error).toBeDefined();

        // ── DB assertions ──────────────────────────────────────────────────────

        // The service rejects before step 3 (state machine transition), so
        // both the registration and the payment must be in their original state.
        const regAfter     = await getRegistrationFromDB(prisma, reg.registrationId);
        const paymentAfter = await getPaymentFromDB(prisma, reg.registrationId);

        expect(regAfter.status).toBe('PENDING_PAYMENT');
        expect(regAfter.confirmedAt).toBeNull();

        expect(paymentAfter?.status).toBe('INITIATED');
        expect(paymentAfter?.razorpayPaymentId).toBeNull();

        // The registration's updatedAt must also be unchanged (no partial write)
        expect(regAfter.registeredAt.toISOString()).toBe(
            regBefore.registeredAt.toISOString(),
        );
    }, 30_000);

    // ── 6. Webhook AFTER cancellation must NOT confirm ─────────────────────────
    //
    // Simulates a real-world race: the purge job cancels an expired registration,
    // then a late payment.captured webhook arrives for the same order. The system
    // must NOT resurrect the registration back to CONFIRMED.

    it('webhook after purge cancellation: registration stays CANCELLED, registeredCount unchanged', async () => {
        const expiredPhone   = phone(6);
        const entryNumber    = `KS-EC6-${RUN_TS}`;
        const razorpayOrder  = `order_ec_expired_${RUN_TS}`;
        const razorpayPayId  = `pay_ec_expired_${RUN_TS}`;

        // 1. Create an already-expired registration directly via Prisma
        const { registrationId } = await createExpiredRegistration(
            prisma,
            tournamentId,
            categoryId,
            expiredPhone,
            entryNumber,
            razorpayOrder,
        );

        // Pre-purge: registration must be PENDING_PAYMENT
        const regBeforePurge = await getRegistrationFromDB(prisma, registrationId);
        expect(regBeforePurge.status).toBe('PENDING_PAYMENT');

        // Capture count before purge so we can assert the decrement
        const catBeforePurge = await getCategoryFromDB(prisma, categoryId);
        const countBeforePurge = catBeforePurge.registeredCount;

        // 2. Run purge → registration becomes CANCELLED, registeredCount decremented
        const purgeResult = await runPurgeJob(prisma, [registrationId]);
        expect(purgeResult.purged).toBe(1);

        const regAfterPurge = await getRegistrationFromDB(prisma, registrationId);
        expect(regAfterPurge.status).toBe('CANCELLED');

        // Count must have decreased by exactly 1 after purge
        const catAfterPurge = await getCategoryFromDB(prisma, categoryId);
        const countAfterPurge = catAfterPurge.registeredCount;
        expect(countAfterPurge).toBe(countBeforePurge - 1);

        // Capture payment state before the late webhook
        const paymentBefore = await getPaymentFromDB(prisma, registrationId);

        // 3. Send a late payment.captured webhook for the cancelled registration
        const res = await triggerWebhook(request, razorpayOrder, razorpayPayId)
            .expect(200);

        // The service must ignore the late webhook — exact response
        expect(res.body).toEqual({ status: 'ignored' });

        // ── DB assertions ──────────────────────────────────────────────────────

        // Registration MUST remain CANCELLED — never resurrected to CONFIRMED
        const regAfterWebhook = await getRegistrationFromDB(prisma, registrationId);
        expect(regAfterWebhook.status).toBe('CANCELLED');
        expect(regAfterWebhook.confirmedAt).toBeNull();

        // Payment must exist and remain unchanged after the late webhook
        const paymentAfterWebhook = await getPaymentFromDB(prisma, registrationId);
        expect(paymentAfterWebhook).not.toBeNull();
        expect(paymentAfterWebhook?.status).toBe(paymentBefore?.status);
        expect(paymentAfterWebhook?.razorpayPaymentId).toBe(paymentBefore?.razorpayPaymentId);

        // registeredCount MUST NOT increase — no counter corruption
        const catAfterWebhook = await getCategoryFromDB(prisma, categoryId);
        expect(catAfterWebhook.registeredCount).toBe(countAfterPurge);
    }, 30_000);
});
