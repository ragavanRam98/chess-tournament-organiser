/**
 * E2E: Registration → Payment → Webhook → CONFIRMED
 *
 * Full happy-path flow tested over real HTTP + real Postgres.
 * Razorpay and BullMQ are mocked so no external calls leave the process.
 *
 * Flow:
 *   1. POST /tournaments/:id/categories/:catId/register
 *      → 201, status = PENDING_PAYMENT, expiresAt set
 *   2. DB: registration row created, registeredCount incremented by trigger
 *   3. POST /payments/webhook  (payment.captured event, valid HMAC)
 *      → 200 { status: 'ok' }
 *   4. DB: registration.status = CONFIRMED, payment.status = PAID
 *      registeredCount unchanged (trigger fires on INSERT only)
 *
 * Run:
 *   npx jest --config apps/api/test/jest-app-e2e.json registration-payment
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as supertest from 'supertest';

import {
    createApp,
    createTestOrganizer,
    createTournamentWithCategory,
    createPendingRegistration,
    triggerWebhook,
    getRegistrationFromDB,
    getCategoryFromDB,
    getPaymentFromDB,
    cleanupByEmail,
    makeMockRazorpay,
} from '../../helpers/e2e.helpers';

const HAS_DB = Boolean(process.env.DATABASE_URL);
const describeIfDb = HAS_DB ? describe : describe.skip;

describeIfDb('Registration → Payment → Webhook → CONFIRMED (E2E)', () => {

    let app:     INestApplication;
    let request: supertest.SuperTest<supertest.Test>;
    let prisma:  PrismaClient;

    const RUN_TS        = Date.now();
    const ORGANIZER_EMAIL = `rp-e2e-organizer-${RUN_TS}@test.local`;

    // Each test gets a unique phone so the partial unique index never blocks it
    const phone = (n: number) => `+9181${String(RUN_TS).slice(-7)}${n}`;

    // Counter-based mock: each createOrder() call gets a distinct order ID.
    // Without this, multiple registrations would get the same razorpay_order_id,
    // causing a unique constraint violation on Payment.create.
    const mockRazorpay    = makeMockRazorpay(`rp-${RUN_TS}`);
    let orderSeq = 0;
    mockRazorpay.createOrder.mockImplementation(() =>
        Promise.resolve({ id: `order_rp_${RUN_TS}_${++orderSeq}` }),
    );
    const RAZORPAY_PAYMENT = `pay_e2e_rp-${RUN_TS}`;

    let organizerId:  string;
    let tournamentId: string;
    let categoryId:   string;

    beforeAll(async () => {
        prisma  = new PrismaClient();
        await prisma.$connect();
        await cleanupByEmail(prisma, ORGANIZER_EMAIL);

        app = await createApp(mockRazorpay);
        request = supertest(app.getHttpServer());

        const org = await createTestOrganizer(prisma, ORGANIZER_EMAIL, RUN_TS.toString());
        organizerId = org.organizerId;

        ({ tournamentId, categoryId } = await createTournamentWithCategory(prisma, organizerId));
    }, 30_000);

    afterAll(async () => {
        await cleanupByEmail(prisma, ORGANIZER_EMAIL);
        await prisma.$disconnect();
        await app.close();
    }, 30_000);

    // ── Test 1: Registration creates PENDING_PAYMENT row ────────────────────────

    it('POST /register → 201, body contains registration_id, entry_number, status, expires_at', async () => {
        const res = await request
            .post(`/api/v1/tournaments/${tournamentId}/categories/${categoryId}/register`)
            .send({
                playerName: 'Happy Path Player',
                playerDob:  '2000-01-01',
                phone:      phone(1),
                email:      'happy@test.local',
                city:       'Chennai',
            })
            .expect(201);

        expect(res.body.data).toMatchObject({
            status: 'PENDING_PAYMENT',
        });
        expect(res.body.data.registration_id).toBeDefined();
        expect(res.body.data.entry_number).toMatch(/^KS-\d{4}-\d{6}$/);
        expect(res.body.data.expires_at).toBeDefined();

        // Verify the 2-hour expiry window
        const expiresAt = new Date(res.body.data.expires_at).getTime();
        const twoHours  = 2 * 60 * 60 * 1000;
        expect(expiresAt).toBeGreaterThanOrEqual(Date.now() + twoHours - 5_000);
        expect(expiresAt).toBeLessThanOrEqual(Date.now() + twoHours + 5_000);
    }, 30_000);

    // ── Test 2: DB state after registration ─────────────────────────────────────

    it('DB: registration.status = PENDING_PAYMENT immediately after register', async () => {
        const res = await createPendingRegistration(request, tournamentId, categoryId, phone(2));

        const reg = await getRegistrationFromDB(prisma, res.registrationId);

        expect(reg.status).toBe('PENDING_PAYMENT');
        expect(reg.confirmedAt).toBeNull();
        expect(reg.expiresAt).not.toBeNull();
        expect(reg.phone).toBe(phone(2));
    }, 30_000);

    // ── Test 3: DB trigger increments registeredCount on INSERT ─────────────────

    it('DB: registeredCount incremented by trigger after each successful registration', async () => {
        const catBefore = await getCategoryFromDB(prisma, categoryId);
        const countBefore = catBefore.registeredCount;

        await createPendingRegistration(request, tournamentId, categoryId, phone(3));

        const catAfter = await getCategoryFromDB(prisma, categoryId);
        expect(catAfter.registeredCount).toBe(countBefore + 1);
    }, 30_000);

    // ── Test 4: Razorpay order returned in response ──────────────────────────────

    it('POST /register → response contains razorpay order details from mocked service', async () => {
        const res = await request
            .post(`/api/v1/tournaments/${tournamentId}/categories/${categoryId}/register`)
            .send({
                playerName: 'Payment Details Player',
                playerDob:  '2000-01-01',
                phone:      phone(4),
            })
            .expect(201);

        // The mock createOrder returns { id: 'order_e2e_rp-<TS>' }
        expect(res.body.data.payment).not.toBeNull();
        expect(res.body.data.payment.razorpay_order_id).toBeDefined();
        expect(res.body.data.payment.amount_paise).toBeDefined();
        expect(res.body.data.payment.currency).toBe('INR');
    }, 30_000);

    // ── Test 5: Webhook confirms the registration ────────────────────────────────

    it('POST /payments/webhook (payment.captured) → 200 { status: ok }', async () => {
        // Create a fresh registration whose Payment row we can target
        const reg = await createPendingRegistration(request, tournamentId, categoryId, phone(5));

        // The mock createOrder is set to return RAZORPAY_ORDER — but mock is called
        // per-registration so we need the actual order ID from the response
        const orderId = reg.razorpayOrderId;
        expect(orderId).toBeTruthy();

        const res = await triggerWebhook(request, orderId, RAZORPAY_PAYMENT + '-5')
            .expect(200);

        expect(res.body).toEqual({ status: 'ok' });
    }, 30_000);

    // ── Test 6: DB state after webhook ──────────────────────────────────────────

    it('DB: registration.status = CONFIRMED and payment.status = PAID after webhook', async () => {
        const reg = await createPendingRegistration(request, tournamentId, categoryId, phone(6));
        const orderId   = reg.razorpayOrderId;
        const paymentId = RAZORPAY_PAYMENT + '-6';

        // Confirm there is a Payment row in INITIATED state
        const paymentBefore = await getPaymentFromDB(prisma, reg.registrationId);
        expect(paymentBefore?.status).toBe('INITIATED');
        expect(paymentBefore?.razorpayPaymentId).toBeNull();

        await triggerWebhook(request, orderId, paymentId).expect(200);

        const regAfter     = await getRegistrationFromDB(prisma, reg.registrationId);
        const paymentAfter = await getPaymentFromDB(prisma, reg.registrationId);

        expect(regAfter.status).toBe('CONFIRMED');
        expect(regAfter.confirmedAt).not.toBeNull();

        expect(paymentAfter?.status).toBe('PAID');
        expect(paymentAfter?.razorpayPaymentId).toBe(paymentId);
    }, 30_000);

    // ── Test 7: registeredCount unchanged after webhook ──────────────────────────

    it('DB: registeredCount is NOT changed by the webhook (trigger fires on INSERT only)', async () => {
        const reg = await createPendingRegistration(request, tournamentId, categoryId, phone(7));

        const catAfterInsert = await getCategoryFromDB(prisma, categoryId);
        const countAfterInsert = catAfterInsert.registeredCount;

        await triggerWebhook(request, reg.razorpayOrderId, RAZORPAY_PAYMENT + '-7').expect(200);

        const catAfterWebhook = await getCategoryFromDB(prisma, categoryId);
        expect(catAfterWebhook.registeredCount).toBe(countAfterInsert);
    }, 30_000);

    // ── Test 8: GET /registrations/:entryNumber/status reflects CONFIRMED ────────

    it('GET /registrations/:entryNumber/status → CONFIRMED after webhook', async () => {
        const reg = await createPendingRegistration(request, tournamentId, categoryId, phone(8));
        await triggerWebhook(request, reg.razorpayOrderId, RAZORPAY_PAYMENT + '-8').expect(200);

        const res = await request
            .get(`/api/v1/registrations/${reg.entryNumber}/status`)
            .expect(200);

        expect(res.body.data.status).toBe('CONFIRMED');
        expect(res.body.data.confirmed_at).not.toBeNull();
    }, 30_000);

    // ── Test 9: Duplicate phone rejected ────────────────────────────────────────

    it('POST /register with same phone twice → second request is 409 DUPLICATE_REGISTRATION', async () => {
        const sharedPhone = phone(9);

        await request
            .post(`/api/v1/tournaments/${tournamentId}/categories/${categoryId}/register`)
            .send({ playerName: 'First',  playerDob: '2000-01-01', phone: sharedPhone })
            .expect(201);

        const second = await request
            .post(`/api/v1/tournaments/${tournamentId}/categories/${categoryId}/register`)
            .send({ playerName: 'Second', playerDob: '2000-01-01', phone: sharedPhone })
            .expect(409);

        expect(second.body.error.message).toBe('DUPLICATE_REGISTRATION');
    }, 30_000);

    // ── Test 10: Webhook with wrong signature → 400 ──────────────────────────────

    it('POST /payments/webhook with invalid signature → 400', async () => {
        const res = await request
            .post('/api/v1/payments/webhook')
            .set('Content-Type', 'application/json')
            .set('x-razorpay-signature', 'invalid-signature-hex')
            .send(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: {} } } }))
            .expect(400);

        expect(res.body.error).toBeDefined();
    }, 30_000);
});
