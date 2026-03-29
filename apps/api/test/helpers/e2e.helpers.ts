/**
 * Shared helpers for E2E tests.
 *
 * ── DESIGN PRINCIPLES ────────────────────────────────────────────────────────
 *
 * 1. One createApp() per test suite (beforeAll), one teardown (afterAll).
 * 2. DB fixtures created via direct Prisma — faster and free of DTO validation
 *    constraints (e.g. tournament dates must be in the future).
 * 3. HTTP actions (register, webhook) go through supertest so response shape
 *    and status codes are verified alongside DB state.
 * 4. External services (Razorpay, BullMQ jobs) are mocked at the provider level.
 *    Redis for the rate-limit guard is stubbed to always allow.
 * 5. runPurgeJob() replicates the FIXED processor logic verbatim so E2E tests
 *    exercise the guarded updateMany path.
 *
 * ── EXTERNAL DEPENDENCIES ────────────────────────────────────────────────────
 *
 *   docker compose -f docker-compose.dev.yml up postgres -d --wait
 *   DATABASE_URL=postgresql://chess:chess_dev_password@localhost:5432/chess_tournament
 *   npx prisma migrate deploy
 *   npx jest --config apps/api/test/jest-app-e2e.json
 */

import * as crypto from 'crypto';
import * as cookieParser from 'cookie-parser';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as supertest from 'supertest';
import Redis from 'ioredis';

import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';
import { QueueService } from '../../src/queue/queue.service';
import { RazorpayService } from '../../src/payments/razorpay/razorpay.service';

// ── Test environment constants ─────────────────────────────────────────────────

/** Used to sign and verify JWTs in tests. Must match process.env.JWT_ACCESS_SECRET. */
export const TEST_JWT_SECRET = 'e2e-test-jwt-secret';

/** Used to compute Razorpay webhook HMAC. Must match process.env.RAZORPAY_WEBHOOK_SECRET. */
export const TEST_WEBHOOK_SECRET = 'e2e-test-webhook-secret';

// Inject before the module is compiled so JwtModule and payments service pick them up.
process.env.JWT_ACCESS_SECRET       = TEST_JWT_SECRET;
process.env.RAZORPAY_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
process.env.RAZORPAY_KEY_ID         = 'rzp_test_e2e_key';
process.env.RAZORPAY_KEY_SECRET     = 'rzp_test_e2e_secret';
// Redis URL — BullMQ uses this; QueueService is mocked so no real jobs enqueue.
process.env.REDIS_URL               = process.env.REDIS_URL ?? 'redis://localhost:6379';

// ── Mock providers ─────────────────────────────────────────────────────────────

/** Stubbed QueueService — prevents any BullMQ enqueue operations during tests. */
export const mockQueueService = { add: jest.fn().mockResolvedValue(undefined) };

/**
 * Stubbed RazorpayService — prevents HTTP calls to Razorpay during tests.
 * createOrder returns a predictable fake order; refundPayment is a no-op.
 */
export function makeMockRazorpay(orderIdSuffix: string) {
    return {
        createOrder:   jest.fn().mockResolvedValue({ id: `order_e2e_${orderIdSuffix}` }),
        refundPayment: jest.fn().mockResolvedValue({ id: `refund_e2e_${orderIdSuffix}` }),
        fetchPayment:  jest.fn(),
    };
}

/**
 * Stubbed ioredis client — prevents the RegistrationRateLimitGuard from
 * hitting a real Redis. Returns count=1 so every attempt is allowed.
 */
export const mockRedis = {
    incr:   jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
};

// ── App factory ────────────────────────────────────────────────────────────────

/**
 * Bootstraps the full NestJS app with real Prisma but mocked external services.
 * Call once in beforeAll; call app.close() in afterAll.
 *
 * Mirrors main.ts exactly: rawBody, cookieParser, ValidationPipe, GlobalPrefix,
 * GlobalExceptionFilter.
 */
export async function createApp(
    razorpayMock?: ReturnType<typeof makeMockRazorpay>,
): Promise<INestApplication> {
    const rpMock = razorpayMock ?? makeMockRazorpay('default');

    const builder: TestingModuleBuilder = Test.createTestingModule({
        imports: [AppModule],
    })
        .overrideProvider(QueueService)
        .useValue(mockQueueService)
        .overrideProvider(RazorpayService)
        .useValue(rpMock)
        .overrideProvider(Redis)
        .useValue(mockRedis);

    const moduleFixture = await builder.compile();

    const app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
            transformOptions: { enableImplicitConversion: true },
        }),
    );

    await app.init();
    return app;
}

// ── Token helpers ──────────────────────────────────────────────────────────────

/**
 * Signs a HS256 JWT using Node.js built-in crypto — no extra npm dependency.
 * Produces a token that passport-jwt / JwtStrategy accept identically to one
 * signed by @nestjs/jwt, as long as the secret and algorithm match.
 *
 * Payload matches what JwtStrategy.validate() expects: { sub, role }.
 */
export function signToken(userId: string, role: 'ORGANIZER' | 'SUPER_ADMIN'): string {
    const b64url = (obj: object) =>
        Buffer.from(JSON.stringify(obj)).toString('base64url');

    const header  = b64url({ alg: 'HS256', typ: 'JWT' });
    const now     = Math.floor(Date.now() / 1000);
    const payload = b64url({ sub: userId, role, iat: now, exp: now + 3600 });
    const sig     = crypto
        .createHmac('sha256', TEST_JWT_SECRET)
        .update(`${header}.${payload}`)
        .digest('base64url');

    return `${header}.${payload}.${sig}`;
}

// ── DB fixtures ────────────────────────────────────────────────────────────────

export interface TestOrganizer {
    userId:      string;
    organizerId: string;
    token:       string;  // signed JWT, ready to use as Bearer
}

export interface TestAdmin {
    userId: string;
    token:  string;
}

/**
 * Creates a User (ORGANIZER, ACTIVE) + Organizer in the DB and returns their
 * signed JWT. Bypasses auth/registration flow so status is immediately ACTIVE.
 */
export async function createTestOrganizer(
    prisma: PrismaClient,
    email: string,
    suffix: string,
): Promise<TestOrganizer> {
    const user = await prisma.user.create({
        data: {
            email,
            passwordHash: '$e2e-test-not-a-real-hash$',
            role:   'ORGANIZER',
            status: 'ACTIVE',
        },
    });
    const organizer = await prisma.organizer.create({
        data: {
            userId:      user.id,
            academyName: `E2E Academy ${suffix}`,
            contactPhone: '+910000000001',
            city:         'Test City',
            state:        'Test State',
        },
    });
    return { userId: user.id, organizerId: organizer.id, token: signToken(user.id, 'ORGANIZER') };
}

/**
 * Creates a User (SUPER_ADMIN, ACTIVE) in the DB and returns their signed JWT.
 * SUPER_ADMIN users have no organizer record — JwtStrategy returns organizerId=null.
 */
export async function createTestAdmin(
    prisma: PrismaClient,
    email: string,
): Promise<TestAdmin> {
    const user = await prisma.user.create({
        data: {
            email,
            passwordHash: '$e2e-test-not-a-real-hash$',
            role:   'SUPER_ADMIN',
            status: 'ACTIVE',
        },
    });
    return { userId: user.id, token: signToken(user.id, 'SUPER_ADMIN') };
}

// ── Tournament + Category ──────────────────────────────────────────────────────

export interface TournamentWithCategory {
    tournamentId: string;
    categoryId:   string;
    entryFeePaise: number;
    maxSeats:     number;
}

/**
 * Creates an APPROVED tournament with one category directly via Prisma.
 * Status is set to APPROVED so registrations are accepted immediately.
 * Dates are far in the future to avoid any deadline/validation issues.
 */
export async function createTournamentWithCategory(
    prisma: PrismaClient,
    organizerId: string,
    opts: { maxSeats?: number; entryFeePaise?: number } = {},
): Promise<TournamentWithCategory> {
    const maxSeats     = opts.maxSeats     ?? 10;
    const entryFeePaise = opts.entryFeePaise ?? 50_000;

    const tournament = await prisma.tournament.create({
        data: {
            organizerId,
            title:                'E2E Test Tournament',
            city:                 'Test City',
            venue:                'Test Venue',
            startDate:            new Date('2030-06-01'),
            endDate:              new Date('2030-06-03'),
            registrationDeadline: new Date('2030-05-31'),
            status:               'APPROVED',
        },
    });

    const category = await prisma.category.create({
        data: {
            tournamentId:   tournament.id,
            name:           'Open',
            minAge:         0,
            maxAge:         99,
            entryFeePaise,
            maxSeats,
            registeredCount: 0,
        },
    });

    return { tournamentId: tournament.id, categoryId: category.id, entryFeePaise, maxSeats };
}

// ── Registration helpers ───────────────────────────────────────────────────────

export interface PendingRegistration {
    registrationId: string;
    entryNumber:    string;
    razorpayOrderId: string;
}

/**
 * Registers a player via the HTTP API (POST /tournaments/:id/categories/:catId/register)
 * and returns the IDs needed for subsequent steps.
 *
 * The Razorpay mock must have been set up with createOrder returning a stable fake order ID.
 * The fake order ID is derived from the mock's resolved value.
 */
export async function createPendingRegistration(
    request: supertest.SuperTest<supertest.Test>,
    tournamentId: string,
    categoryId:   string,
    phone:        string,
    playerName:   string = 'E2E Player',
): Promise<PendingRegistration> {
    const res = await request
        .post(`/api/v1/tournaments/${tournamentId}/categories/${categoryId}/register`)
        .send({
            playerName,
            playerDob: '2000-01-01',
            phone,
            email: 'e2e@test.local',
            city:  'Test City',
        })
        .expect(201);

    return {
        registrationId:  res.body.data.registration_id,
        entryNumber:     res.body.data.entry_number,
        razorpayOrderId: res.body.data.payment?.razorpay_order_id ?? '',
    };
}

/**
 * Creates an already-expired PENDING_PAYMENT registration directly via Prisma,
 * bypassing the HTTP layer. Used for purge tests where we need the 2-hour window
 * to already be past at fixture creation time.
 *
 * Also creates the Payment record in INITIATED state (needed for webhook processing).
 */
export async function createExpiredRegistration(
    prisma:       PrismaClient,
    tournamentId: string,
    categoryId:   string,
    phone:        string,
    entryNumber:  string,
    razorpayOrderId: string,
): Promise<{ registrationId: string; entryNumber: string }> {
    const reg = await prisma.registration.create({
        data: {
            tournamentId,
            categoryId,
            playerName:  'Expired Player',
            playerDob:   new Date('2000-01-01'),
            phone,
            entryNumber,
            status:      'PENDING_PAYMENT',
            expiresAt:   new Date(Date.now() - 5_000),  // expired 5 seconds ago
        },
    });

    await prisma.payment.create({
        data: {
            registrationId: reg.id,
            razorpayOrderId,
            amountPaise:    50_000,
            status:         'INITIATED',
        },
    });

    return { registrationId: reg.id, entryNumber: reg.entryNumber };
}

// ── Webhook helper ─────────────────────────────────────────────────────────────

/**
 * Sends a payment.captured webhook event to POST /api/v1/payments/webhook.
 *
 * Computes the HMAC-SHA256 signature over the exact JSON body bytes that will
 * be sent, matching what PaymentsService.handleWebhook() expects in req.rawBody.
 *
 * The Content-Type must be application/json so NestJS parses req.body and also
 * stores the raw bytes in req.rawBody (enabled by rawBody: true in createApp).
 */
export function triggerWebhook(
    request:         supertest.SuperTest<supertest.Test>,
    razorpayOrderId: string,
    razorpayPaymentId: string,
): supertest.Test {
    const payload = {
        event: 'payment.captured',
        payload: {
            payment: {
                entity: {
                    id:       razorpayPaymentId,
                    order_id: razorpayOrderId,
                    status:   'captured',
                    amount:   50_000,
                    currency: 'INR',
                },
            },
        },
    };

    const bodyString = JSON.stringify(payload);
    const sig = crypto
        .createHmac('sha256', TEST_WEBHOOK_SECRET)
        .update(bodyString)
        .digest('hex');

    return request
        .post('/api/v1/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', sig)
        .send(bodyString);
}

// ── Purge helper ───────────────────────────────────────────────────────────────

/**
 * Executes one pass of the FIXED PurgeExpiredProcessor logic directly against
 * the database, scoped to a set of registration IDs.
 *
 * Replicates purge-expired.processor.ts exactly as modified:
 *   - findMany with status='PENDING_PAYMENT' filter
 *   - interactive $transaction with updateMany guard (status guard added by fix)
 *   - decrement only when updateMany.count > 0
 *
 * The scope parameter restricts the findMany to test-owned rows so this helper
 * does not affect unrelated data in the shared test database.
 *
 * Returns { purged: number } matching the processor's return type.
 */
export async function runPurgeJob(
    prisma:   PrismaClient,
    scopeIds: string[],
): Promise<{ purged: number }> {
    const now = new Date();

    const expired = await prisma.registration.findMany({
        where: {
            id:        { in: scopeIds },
            status:    'PENDING_PAYMENT',
            expiresAt: { lt: now },
        },
        select: { id: true, categoryId: true, entryNumber: true },
    });

    let purged = 0;

    for (const reg of expired) {
        const result = await prisma.$transaction(async (tx) => {
            const updated = await tx.registration.updateMany({
                where: { id: reg.id, status: 'PENDING_PAYMENT' },
                data:  { status: 'CANCELLED' },
            });
            // The DB trigger (sync_registered_count) automatically decrements
            // registeredCount when status changes to CANCELLED. No manual
            // decrement needed here — doing so would cause a double-decrement.
            return updated.count > 0 ? 1 : 0;
        });
        if (result) purged++;
    }

    return { purged };
}

// ── DB read helpers ────────────────────────────────────────────────────────────

export async function getRegistrationFromDB(prisma: PrismaClient, registrationId: string) {
    return prisma.registration.findUniqueOrThrow({ where: { id: registrationId } });
}

export async function getCategoryFromDB(prisma: PrismaClient, categoryId: string) {
    return prisma.category.findUniqueOrThrow({ where: { id: categoryId } });
}

export async function getPaymentFromDB(prisma: PrismaClient, registrationId: string) {
    return prisma.payment.findUnique({ where: { registrationId } });
}

// ── Cleanup ────────────────────────────────────────────────────────────────────

/**
 * Deletes all test fixture data for a given organizer email in FK-safe order.
 * Safe to call even when fixtures are partially created (e.g. after a crash).
 */
export async function cleanupByEmail(prisma: PrismaClient, email: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return;

    const organizer = await prisma.organizer.findUnique({ where: { userId: user.id } });
    if (organizer) {
        const tIds = (await prisma.tournament.findMany({
            where:  { organizerId: organizer.id },
            select: { id: true },
        })).map((t) => t.id);

        if (tIds.length > 0) {
            const regIds = (await prisma.registration.findMany({
                where:  { tournamentId: { in: tIds } },
                select: { id: true },
            })).map((r) => r.id);

            if (regIds.length > 0) {
                // Payment must be deleted before Registration (FK RESTRICT)
                await prisma.payment.deleteMany({ where: { registrationId: { in: regIds } } });
            }
            await prisma.registration.deleteMany({ where: { tournamentId: { in: tIds } } });
            // Tournament deletion cascades to categories
            await prisma.tournament.deleteMany({ where: { id: { in: tIds } } });
        }
    }

    // User deletion cascades to organizer and refreshTokenSessions
    await prisma.user.delete({ where: { id: user.id } });
}

/**
 * Deletes a SUPER_ADMIN test user (no organizer record to clean up).
 */
export async function cleanupAdminByEmail(prisma: PrismaClient, email: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) await prisma.user.delete({ where: { id: user.id } });
}
