/**
 * E2E: Expiry → Purge → CANCELLED (+ idempotency)
 *
 * Validates the full purge lifecycle over real HTTP + real Postgres.
 * The purge logic is exercised via runPurgeJob() which replicates the FIXED
 * processor code (updateMany with status guard, conditional decrement).
 *
 * Flows covered:
 *   1. Expired registration is cancelled and seat released by purge
 *   2. Running purge twice on the same registration does NOT double-decrement
 *   3. CONFIRMED registration is NOT touched by purge (stale-list safety)
 *   4. GET /registrations/:entryNumber/status reflects CANCELLED after purge
 *
 * Run:
 *   npx jest --config apps/api/test/jest-app-e2e.json purge-expiry
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as supertest from 'supertest';

import {
    createApp,
    createTestOrganizer,
    createTournamentWithCategory,
    createExpiredRegistration,
    runPurgeJob,
    getRegistrationFromDB,
    getCategoryFromDB,
    cleanupByEmail,
    makeMockRazorpay,
} from '../../helpers/e2e.helpers';

const HAS_DB = Boolean(process.env.DATABASE_URL);
const describeIfDb = HAS_DB ? describe : describe.skip;

describeIfDb('Expiry → Purge → CANCELLED (E2E)', () => {

    let app:     INestApplication;
    let request: supertest.SuperTest<supertest.Test>;
    let prisma:  PrismaClient;

    const RUN_TS        = Date.now();
    const ORGANIZER_EMAIL = `purge-e2e-organizer-${RUN_TS}@test.local`;

    const phone      = (n: number) => `+9182${String(RUN_TS).slice(-7)}${n}`;
    const entryNum   = (n: number) => `PEX-${RUN_TS}-${n}`;
    const orderId    = (n: number) => `order_pex_${RUN_TS}_${n}`;

    let organizerId:  string;
    let tournamentId: string;
    let categoryId:   string;

    beforeAll(async () => {
        prisma  = new PrismaClient();
        await prisma.$connect();
        await cleanupByEmail(prisma, ORGANIZER_EMAIL);

        app = await createApp(makeMockRazorpay(`pex-${RUN_TS}`));
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

    // ── Test 1: Purge cancels expired registration ───────────────────────────────

    it('purge cancels PENDING_PAYMENT + expired registration and decrements registeredCount', async () => {
        const { registrationId } = await createExpiredRegistration(
            prisma, tournamentId, categoryId, phone(1), entryNum(1), orderId(1),
        );

        // DB trigger fires on INSERT → count incremented
        const catBefore = await getCategoryFromDB(prisma, categoryId);
        const countBefore = catBefore.registeredCount;
        expect(countBefore).toBeGreaterThanOrEqual(1);

        const { purged } = await runPurgeJob(prisma, [registrationId]);
        expect(purged).toBe(1);

        const reg = await getRegistrationFromDB(prisma, registrationId);
        expect(reg.status).toBe('CANCELLED');

        const catAfter = await getCategoryFromDB(prisma, categoryId);
        expect(catAfter.registeredCount).toBe(countBefore - 1);
    }, 30_000);

    // ── Test 2: GET /status reflects CANCELLED after purge ──────────────────────

    it('GET /registrations/:entryNumber/status → CANCELLED after purge', async () => {
        const entry = entryNum(2);
        const { registrationId } = await createExpiredRegistration(
            prisma, tournamentId, categoryId, phone(2), entry, orderId(2),
        );

        await runPurgeJob(prisma, [registrationId]);

        const res = await request
            .get(`/api/v1/registrations/${entry}/status`)
            .expect(200);

        expect(res.body.data.status).toBe('CANCELLED');
    }, 30_000);

    // ── Test 3: Purge idempotency — second run does NOT double-decrement ─────────

    it('running purge twice on the same expired registration does NOT double-decrement registeredCount', async () => {
        const { registrationId } = await createExpiredRegistration(
            prisma, tournamentId, categoryId, phone(3), entryNum(3), orderId(3),
        );

        // First purge run — cancels the registration, decrements count
        const { purged: purgedFirst } = await runPurgeJob(prisma, [registrationId]);
        expect(purgedFirst).toBe(1);

        const catAfterFirst = await getCategoryFromDB(prisma, categoryId);
        const countAfterFirst = catAfterFirst.registeredCount;

        // Second purge run — must be a complete no-op
        const { purged: purgedSecond } = await runPurgeJob(prisma, [registrationId]);
        expect(purgedSecond).toBe(0);

        const catAfterSecond = await getCategoryFromDB(prisma, categoryId);
        expect(catAfterSecond.registeredCount).toBe(countAfterFirst);
        expect(catAfterSecond.registeredCount).toBeGreaterThanOrEqual(0);

        // Registration remains CANCELLED
        const reg = await getRegistrationFromDB(prisma, registrationId);
        expect(reg.status).toBe('CANCELLED');
    }, 30_000);

    // ── Test 4: Three purge runs — count stays stable ────────────────────────────

    it('three consecutive purge runs on CANCELLED registration leave registeredCount unchanged', async () => {
        const { registrationId } = await createExpiredRegistration(
            prisma, tournamentId, categoryId, phone(4), entryNum(4), orderId(4),
        );

        // First purge — the real cancel
        await runPurgeJob(prisma, [registrationId]);
        const countAfterCancel = (await getCategoryFromDB(prisma, categoryId)).registeredCount;

        // Three more runs — all should be no-ops
        for (let i = 0; i < 3; i++) {
            const { purged } = await runPurgeJob(prisma, [registrationId]);
            expect(purged).toBe(0);
        }

        const finalCount = (await getCategoryFromDB(prisma, categoryId)).registeredCount;
        expect(finalCount).toBe(countAfterCancel);
        expect(finalCount).toBeGreaterThanOrEqual(0);
    }, 30_000);

    // ── Test 5: CONFIRMED registration is excluded from purge ───────────────────

    it('purge does NOT cancel or decrement a CONFIRMED registration (status guard)', async () => {
        /**
         * This directly tests the updateMany status guard added to the processor fix.
         *
         * We create an expired registration, then manually set it to CONFIRMED
         * (simulating the webhook arriving). Then we run purge with the registration
         * still in the stale-list scope. The guarded updateMany sees status=CONFIRMED,
         * matches 0 rows, and skips the decrement.
         */
        const { registrationId } = await createExpiredRegistration(
            prisma, tournamentId, categoryId, phone(5), entryNum(5), orderId(5),
        );

        // Simulate webhook confirming before purge runs
        await prisma.registration.update({
            where: { id: registrationId },
            data:  { status: 'CONFIRMED', confirmedAt: new Date() },
        });

        const countBefore = (await getCategoryFromDB(prisma, categoryId)).registeredCount;

        // Purge runs — the registration is now CONFIRMED, not PENDING_PAYMENT
        const { purged } = await runPurgeJob(prisma, [registrationId]);
        expect(purged).toBe(0);

        const reg = await getRegistrationFromDB(prisma, registrationId);
        expect(reg.status).toBe('CONFIRMED');  // unchanged

        const catAfter = await getCategoryFromDB(prisma, categoryId);
        expect(catAfter.registeredCount).toBe(countBefore);  // NOT decremented
    }, 30_000);

    // ── Test 6: Mixed — CANCELLED and PENDING coexist in same category ───────────

    it('purge only processes PENDING_PAYMENT rows — leaves CANCELLED sibling untouched', async () => {
        // Registration A — already cancelled before this purge run
        const a = await createExpiredRegistration(
            prisma, tournamentId, categoryId, phone(60), entryNum(60), orderId(60),
        );
        await runPurgeJob(prisma, [a.registrationId]);  // first purge — A is now CANCELLED
        const countAfterA = (await getCategoryFromDB(prisma, categoryId)).registeredCount;

        // Registration B — new expired PENDING_PAYMENT row
        const b = await createExpiredRegistration(
            prisma, tournamentId, categoryId, phone(61), entryNum(61), orderId(61),
        );
        // Trigger incremented count for B
        const countAfterBInsert = (await getCategoryFromDB(prisma, categoryId)).registeredCount;
        expect(countAfterBInsert).toBe(countAfterA + 1);

        // Purge run scoped to both — should process only B
        const { purged } = await runPurgeJob(prisma, [a.registrationId, b.registrationId]);
        expect(purged).toBe(1);  // only B was processed

        const regA = await getRegistrationFromDB(prisma, a.registrationId);
        const regB = await getRegistrationFromDB(prisma, b.registrationId);
        expect(regA.status).toBe('CANCELLED');  // unchanged
        expect(regB.status).toBe('CANCELLED');  // newly cancelled

        const catFinal = await getCategoryFromDB(prisma, categoryId);
        // Count decremented once for B, A was not touched
        expect(catFinal.registeredCount).toBe(countAfterA);
        expect(catFinal.registeredCount).toBeGreaterThanOrEqual(0);
    }, 30_000);
});
