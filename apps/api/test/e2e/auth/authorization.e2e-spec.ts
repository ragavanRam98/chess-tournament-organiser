/**
 * E2E: Authorization boundaries
 *
 * Validates that every protected route enforces the correct access level
 * over real HTTP with real JWT validation.
 *
 * Boundaries tested:
 *   1. No token → 401 on all protected routes
 *   2. ORGANIZER accessing another organizer's tournament → 403
 *   3. ORGANIZER accessing admin routes → 403
 *   4. SUPER_ADMIN accessing admin routes → 200
 *   5. Public routes accessible without token → 200
 *   6. ORGANIZER accessing own resources → 200
 *
 * All tokens are real JWTs signed with the test secret and backed by real
 * user rows in Postgres (JwtStrategy.validate() queries the DB).
 *
 * Run:
 *   npx jest --config apps/api/test/jest-app-e2e.json authorization
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as supertest from 'supertest';

import {
    createApp,
    createTestOrganizer,
    createTestAdmin,
    createTournamentWithCategory,
    cleanupByEmail,
    cleanupAdminByEmail,
    signToken,
    TestOrganizer,
    TestAdmin,
} from '../../helpers/e2e.helpers';

const HAS_DB = Boolean(process.env.DATABASE_URL);
const describeIfDb = HAS_DB ? describe : describe.skip;

describeIfDb('Authorization boundaries (E2E)', () => {

    let app:     INestApplication;
    let request: supertest.SuperTest<supertest.Test>;
    let prisma:  PrismaClient;

    const RUN_TS = Date.now();

    const EMAIL_ORG_A  = `auth-e2e-org-a-${RUN_TS}@test.local`;
    const EMAIL_ORG_B  = `auth-e2e-org-b-${RUN_TS}@test.local`;
    const EMAIL_ADMIN  = `auth-e2e-admin-${RUN_TS}@test.local`;

    let orgA:          TestOrganizer;
    let orgB:          TestOrganizer;
    let admin:         TestAdmin;
    let tournamentIdA: string;  // belongs to orgA

    beforeAll(async () => {
        prisma  = new PrismaClient();
        await prisma.$connect();

        // Clean up any stale data from a previous failed run
        await cleanupByEmail(prisma, EMAIL_ORG_A);
        await cleanupByEmail(prisma, EMAIL_ORG_B);
        await cleanupAdminByEmail(prisma, EMAIL_ADMIN);

        app = await createApp();
        request = supertest(app.getHttpServer());

        // Create two separate organizers and one admin
        orgA  = await createTestOrganizer(prisma, EMAIL_ORG_A,  `A-${RUN_TS}`);
        orgB  = await createTestOrganizer(prisma, EMAIL_ORG_B,  `B-${RUN_TS}`);
        admin = await createTestAdmin(prisma, EMAIL_ADMIN);

        // Tournament owned by orgA — used to test ownership and cross-organizer access
        ({ tournamentId: tournamentIdA } = await createTournamentWithCategory(
            prisma, orgA.organizerId,
        ));
    }, 30_000);

    afterAll(async () => {
        await cleanupByEmail(prisma, EMAIL_ORG_A);
        await cleanupByEmail(prisma, EMAIL_ORG_B);
        await cleanupAdminByEmail(prisma, EMAIL_ADMIN);
        await prisma.$disconnect();
        await app.close();
    }, 30_000);

    // ── 1. No token → 401 on all protected routes ─────────────────────────────

    describe('unauthenticated requests → 401', () => {

        it('GET /organizer/dashboard/summary → 401', async () => {
            await request.get('/api/v1/organizer/dashboard/summary').expect(401);
        });

        it('GET /organizer/tournaments → 401', async () => {
            await request.get('/api/v1/organizer/tournaments').expect(401);
        });

        it('POST /organizer/tournaments → 401', async () => {
            await request.post('/api/v1/organizer/tournaments').send({}).expect(401);
        });

        it('GET /organizer/tournaments/:id → 401', async () => {
            await request.get(`/api/v1/organizer/tournaments/${tournamentIdA}`).expect(401);
        });

        it('GET /organizer/tournaments/:id/registrations → 401', async () => {
            await request.get(`/api/v1/organizer/tournaments/${tournamentIdA}/registrations`).expect(401);
        });

        it('GET /admin/tournaments → 401', async () => {
            await request.get('/api/v1/admin/tournaments').expect(401);
        });

        it('GET /admin/organizers → 401', async () => {
            await request.get('/api/v1/admin/organizers').expect(401);
        });

        it('GET /admin/analytics → 401', async () => {
            await request.get('/api/v1/admin/analytics').expect(401);
        });
    });

    // ── 2. ORGANIZER accessing another organizer's tournament → 403 ───────────

    describe('ORGANIZER B accessing ORGANIZER A resources → 403', () => {

        it('GET /organizer/tournaments/:id (orgA tournament, orgB token) → 403', async () => {
            await request
                .get(`/api/v1/organizer/tournaments/${tournamentIdA}`)
                .set('Authorization', `Bearer ${orgB.token}`)
                .expect(403);
        });

        it('GET /organizer/tournaments/:id/registrations (orgA tournament, orgB token) → 403', async () => {
            await request
                .get(`/api/v1/organizer/tournaments/${tournamentIdA}/registrations`)
                .set('Authorization', `Bearer ${orgB.token}`)
                .expect(403);
        });

        it('PATCH /organizer/tournaments/:id (orgA tournament, orgB token) → 403', async () => {
            await request
                .patch(`/api/v1/organizer/tournaments/${tournamentIdA}`)
                .set('Authorization', `Bearer ${orgB.token}`)
                .send({ title: 'Hacked Title' })
                .expect(403);
        });

        it('POST /organizer/tournaments/:id/submit (orgA tournament, orgB token) → 403', async () => {
            await request
                .post(`/api/v1/organizer/tournaments/${tournamentIdA}/submit`)
                .set('Authorization', `Bearer ${orgB.token}`)
                .expect(403);
        });
    });

    // ── 3. ORGANIZER accessing admin routes → 403 ─────────────────────────────

    describe('ORGANIZER accessing admin routes → 403', () => {

        it('GET /admin/tournaments → 403', async () => {
            await request
                .get('/api/v1/admin/tournaments')
                .set('Authorization', `Bearer ${orgA.token}`)
                .expect(403);
        });

        it('GET /admin/organizers → 403', async () => {
            await request
                .get('/api/v1/admin/organizers')
                .set('Authorization', `Bearer ${orgA.token}`)
                .expect(403);
        });

        it('GET /admin/analytics → 403', async () => {
            await request
                .get('/api/v1/admin/analytics')
                .set('Authorization', `Bearer ${orgA.token}`)
                .expect(403);
        });

        it('PATCH /admin/tournaments/:id/status → 403', async () => {
            await request
                .patch(`/api/v1/admin/tournaments/${tournamentIdA}/status`)
                .set('Authorization', `Bearer ${orgA.token}`)
                .send({ status: 'APPROVED' })
                .expect(403);
        });

        it('GET /admin/audit-logs → 403', async () => {
            await request
                .get('/api/v1/admin/audit-logs')
                .set('Authorization', `Bearer ${orgA.token}`)
                .expect(403);
        });
    });

    // ── 4. SUPER_ADMIN accessing admin routes → 200 ───────────────────────────

    describe('SUPER_ADMIN accessing admin routes → 200', () => {

        it('GET /admin/tournaments → 200', async () => {
            await request
                .get('/api/v1/admin/tournaments')
                .set('Authorization', `Bearer ${admin.token}`)
                .expect(200);
        });

        it('GET /admin/organizers → 200', async () => {
            await request
                .get('/api/v1/admin/organizers')
                .set('Authorization', `Bearer ${admin.token}`)
                .expect(200);
        });

        it('GET /admin/analytics → 200', async () => {
            await request
                .get('/api/v1/admin/analytics')
                .set('Authorization', `Bearer ${admin.token}`)
                .expect(200);
        });

        it('GET /admin/audit-logs → 200', async () => {
            await request
                .get('/api/v1/admin/audit-logs')
                .set('Authorization', `Bearer ${admin.token}`)
                .expect(200);
        });

        it('GET /admin/integrity-check → 200', async () => {
            await request
                .get('/api/v1/admin/integrity-check')
                .set('Authorization', `Bearer ${admin.token}`)
                .expect(200);
        });
    });

    // ── 5. Public routes accessible without token ─────────────────────────────

    describe('public routes → 200 without Authorization header', () => {

        it('GET /tournaments → 200', async () => {
            await request.get('/api/v1/tournaments').expect(200);
        });

        it('GET /tournaments/:id → 200', async () => {
            await request.get(`/api/v1/tournaments/${tournamentIdA}`).expect(200);
        });

        it('GET /tournaments/:id/participants → 200', async () => {
            await request.get(`/api/v1/tournaments/${tournamentIdA}/participants`).expect(200);
        });

        it('GET /health → 200', async () => {
            await request.get('/api/v1/health').expect(200);
        });
    });

    // ── 6. ORGANIZER accessing own resources → 200 ────────────────────────────

    describe('ORGANIZER accessing own resources → 200', () => {

        it('GET /organizer/tournaments → 200 for orgA', async () => {
            await request
                .get('/api/v1/organizer/tournaments')
                .set('Authorization', `Bearer ${orgA.token}`)
                .expect(200);
        });

        it('GET /organizer/tournaments/:id → 200 when tournament belongs to orgA', async () => {
            await request
                .get(`/api/v1/organizer/tournaments/${tournamentIdA}`)
                .set('Authorization', `Bearer ${orgA.token}`)
                .expect(200);
        });

        it('GET /organizer/tournaments/:id/registrations → 200 for own tournament', async () => {
            await request
                .get(`/api/v1/organizer/tournaments/${tournamentIdA}/registrations`)
                .set('Authorization', `Bearer ${orgA.token}`)
                .expect(200);
        });

        it('GET /organizer/dashboard/summary → 200', async () => {
            await request
                .get('/api/v1/organizer/dashboard/summary')
                .set('Authorization', `Bearer ${orgA.token}`)
                .expect(200);
        });

        it('GET /auth/me → 200 with correct role', async () => {
            const res = await request
                .get('/api/v1/auth/me')
                .set('Authorization', `Bearer ${orgA.token}`)
                .expect(200);

            expect(res.body.data.role).toBe('ORGANIZER');
            expect(res.body.data.email).toBe(EMAIL_ORG_A);
        });
    });

    // ── 7. Invalid/expired token → 401 ───────────────────────────────────────

    describe('malformed or wrong-secret token → 401', () => {

        it('completely invalid token string → 401', async () => {
            await request
                .get('/api/v1/organizer/tournaments')
                .set('Authorization', 'Bearer not-a-jwt')
                .expect(401);
        });

        it('JWT signed with wrong secret → 401', async () => {
            // signToken but with a different secret — reuse the same manual HS256 approach
            const badToken = signToken(orgA.userId, 'ORGANIZER').replace(
                // tamper with the signature segment (last dot-separated part)
                /\.[^.]+$/,
                '.aW52YWxpZHNpZ25hdHVyZWhlcmU',
            );

            await request
                .get('/api/v1/organizer/tournaments')
                .set('Authorization', `Bearer ${badToken}`)
                .expect(401);
        });

        it('SUPER_ADMIN token does not grant ORGANIZER dashboard access → 403', async () => {
            /**
             * SUPER_ADMIN has no organizer record, so organizerId = null on req.user.
             * The RolesGuard allows SUPER_ADMIN through only if the route's @Roles
             * includes SUPER_ADMIN. Organizer routes require @Roles('ORGANIZER').
             * A SUPER_ADMIN token therefore fails the role check on organizer routes.
             */
            await request
                .get('/api/v1/organizer/dashboard/summary')
                .set('Authorization', `Bearer ${admin.token}`)
                .expect(403);
        });
    });
});
