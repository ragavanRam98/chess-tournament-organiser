/**
 * Strict unit tests for RegistrationsService.
 *
 * WHAT IS TESTED HERE (business rules enforced in application code):
 *   - Tournament status gate: only APPROVED and ACTIVE accept registrations
 *   - Category existence: categoryId must belong to the tournament
 *   - Age validation: evaluated at tournament.startDate, not at call time
 *   - Age boundaries: minAge and maxAge are inclusive
 *   - Duplicate phone detection: excludes CANCELLED registrations by design
 *   - Seat limit: checked via mocked SELECT FOR UPDATE result inside transaction
 *   - Entry number format: KS-YYYY-NNNNNN, zero-padded to 6 digits
 *   - playerDob stored as Date instance, not raw string
 *   - expiresAt set to exactly 2 hours from call time
 *   - Razorpay failure is swallowed — registration still returns PENDING_PAYMENT
 *   - getPublicParticipants: PII stripped, seat summary accurate, status-gated
 *   - getStatus: lookup by entryNumber, correct response shape
 *
 * WHAT CANNOT BE SAFELY TESTED WITH MOCKS (see bottom of file):
 *   - True concurrent seat locking (SELECT FOR UPDATE is a DB-level primitive)
 *   - registeredCount DB trigger firing on INSERT
 *   - Atomic transaction rollback on partial failure
 *   - Postgres sequence uniqueness under concurrent load
 *   - Purge-vs-webhook race on the same PENDING_PAYMENT registration
 *
 * These require integration tests against a real Postgres instance.
 * See the "Requires integration tests" describe block below for details.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { RegistrationsService } from './registrations.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { QueueService } from '../queue/queue.service';

// ── Constants ──────────────────────────────────────────────────────────────────

const TOURNAMENT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const CATEGORY_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const OTHER_CATEGORY_ID = 'cccccccc-0000-0000-0000-000000000001'; // does NOT belong to the tournament

/**
 * All age tests use this start date as the reference.
 * Category: minAge = 10, maxAge = 18.
 *
 * DOB boundary table:
 *   2015-06-01  age = 10  (exact minAge)   → VALID
 *   2015-06-02  age =  9  (one day late)   → INVALID (below minAge)
 *   2007-06-01  age = 18  (exact maxAge)   → VALID
 *   2006-06-01  age = 19  (+1 year)        → INVALID (above maxAge)
 *   2010-01-01  age = 15  (mid-range)      → VALID   ← validDto.playerDob
 */
const TOURNAMENT_START = new Date('2025-06-01');

// ── Fixture factories ──────────────────────────────────────────────────────────

function makeCategory(overrides: Partial<Record<string, any>> = {}) {
    return {
        id: CATEGORY_ID,
        name: 'Under 18',
        minAge: 10,
        maxAge: 18,
        entryFeePaise: 50_000,
        maxSeats: 50,
        registeredCount: 0,
        ...overrides,
    };
}

function makeTournament(status = 'APPROVED', categoryOverrides: Partial<Record<string, any>> = {}) {
    return {
        id: TOURNAMENT_ID,
        status,
        startDate: TOURNAMENT_START,
        categories: [makeCategory(categoryOverrides)],
    };
}

/** Valid DTO: age 15 at tournament start → within 10–18 range. */
const validDto = {
    playerName: 'Arjun Kumar',
    playerDob: '2010-01-01',
    phone: '+919876543210',
    email: 'arjun@test.com',
    city: 'Chennai',
};

function makeFakeReg(overrides: Partial<Record<string, any>> = {}) {
    return {
        id: 'reg-uuid-1',
        entryNumber: `KS-${new Date().getFullYear()}-000001`,
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        categoryId: CATEGORY_ID,
        tournamentId: TOURNAMENT_ID,
        ...overrides,
    };
}

/**
 * Builds a mock Prisma tx object for the interactive transaction.
 * Returns the mocks so tests can make assertions on them.
 *
 * @param fakeReg   - what registration.create will resolve to
 * @param seatCount - registered_count to return from SELECT FOR UPDATE
 * @param maxSeats  - max_seats to return from SELECT FOR UPDATE
 */
function buildTxMock(fakeReg: any, seatCount = 5, maxSeats = 50) {
    const createMock = jest.fn().mockResolvedValue(fakeReg);
    const queryRawMock = jest.fn()
        // 1st call: SELECT registered_count, max_seats FROM categories FOR UPDATE
        .mockResolvedValueOnce([{ registered_count: seatCount, max_seats: maxSeats }])
        // 2nd call: SELECT nextval('entry_number_seq')
        .mockResolvedValueOnce([{ nextval: BigInt(1) }]);
    const tx = { $queryRaw: queryRawMock, registration: { create: createMock } };
    return { tx, createMock, queryRawMock };
}

/** Wires the full happy-path mock chain and returns capture refs. */
function setupHappyPath(tournamentStatus = 'APPROVED', seatCount = 5) {
    const fakeReg = makeFakeReg();
    mockPrisma.tournament.findUnique.mockResolvedValue(makeTournament(tournamentStatus));
    mockPrisma.registration.findFirst.mockResolvedValue(null); // no duplicate
    const { tx, createMock, queryRawMock } = buildTxMock(fakeReg, seatCount);
    mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
    return { fakeReg, createMock, queryRawMock };
}

// ── Service-level mocks ────────────────────────────────────────────────────────

const mockPrisma = {
    tournament: { findUnique: jest.fn() },
    registration: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
};

const mockPayments = {
    createOrder: jest.fn().mockResolvedValue({
        razorpay_order_id: 'order_test_1',
        razorpay_key_id: 'rzp_test_key',
        amount_paise: 50_000,
        currency: 'INR',
    }),
};

const mockQueue = { add: jest.fn() };

// ── Test setup ─────────────────────────────────────────────────────────────────

describe('RegistrationsService', () => {
    let service: RegistrationsService;

    beforeEach(async () => {
        jest.clearAllMocks();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                RegistrationsService,
                { provide: PrismaService, useValue: mockPrisma },
                { provide: PaymentsService, useValue: mockPayments },
                { provide: QueueService, useValue: mockQueue },
            ],
        }).compile();

        service = module.get<RegistrationsService>(RegistrationsService);
    });

    // ══════════════════════════════════════════════════════════════════════════
    // register()
    // ══════════════════════════════════════════════════════════════════════════

    describe('register()', () => {

        // ── Tournament guard ───────────────────────────────────────────────────

        describe('tournament existence and status', () => {

            it('throws NotFoundException when tournament does not exist', async () => {
                mockPrisma.tournament.findUnique.mockResolvedValue(null);

                await expect(
                    service.register(TOURNAMENT_ID, CATEGORY_ID, validDto)
                ).rejects.toThrow(NotFoundException);
            });

            it.each(['DRAFT', 'PENDING_APPROVAL', 'CLOSED', 'REJECTED', 'CANCELLED'])(
                'throws ConflictException(TOURNAMENT_NOT_ACCEPTING) for status: %s',
                async (status) => {
                    mockPrisma.tournament.findUnique.mockResolvedValue(makeTournament(status));

                    const err = await service
                        .register(TOURNAMENT_ID, CATEGORY_ID, validDto)
                        .catch((e) => e);

                    expect(err).toBeInstanceOf(ConflictException);
                    // Verify the specific error code, not just the exception type
                    expect(err.message).toBe('TOURNAMENT_NOT_ACCEPTING');
                }
            );

            it.each(['APPROVED', 'ACTIVE'])(
                'does not throw a status error for %s tournament',
                async (status) => {
                    setupHappyPath(status);

                    await expect(
                        service.register(TOURNAMENT_ID, CATEGORY_ID, validDto)
                    ).resolves.toBeDefined();
                }
            );

        });

        // ── Category guard ─────────────────────────────────────────────────────

        describe('category existence', () => {

            it('throws NotFoundException when categoryId is not in the tournament categories list', async () => {
                // Tournament exists and is APPROVED, but contains only CATEGORY_ID.
                // Passing OTHER_CATEGORY_ID must be rejected before hitting the DB.
                mockPrisma.tournament.findUnique.mockResolvedValue(makeTournament('APPROVED'));

                await expect(
                    service.register(TOURNAMENT_ID, OTHER_CATEGORY_ID, validDto)
                ).rejects.toThrow(NotFoundException);

                // Must stop here — should never reach duplicate check or transaction
                expect(mockPrisma.registration.findFirst).not.toHaveBeenCalled();
                expect(mockPrisma.$transaction).not.toHaveBeenCalled();
            });

        });

        // ── Age validation ─────────────────────────────────────────────────────

        describe('age validation — evaluated at tournament.startDate, NOT at call time', () => {

            it('accepts player whose age equals minAge exactly (age = 10)', async () => {
                // DOB 2015-06-01: turns 10 on the exact tournament start date → age = 10 = minAge
                setupHappyPath();

                await expect(
                    service.register(TOURNAMENT_ID, CATEGORY_ID, { ...validDto, playerDob: '2015-06-01' })
                ).resolves.toBeDefined();
            });

            it('rejects player who has not yet reached minAge on startDate (age = 9)', async () => {
                // DOB 2015-06-02: 10th birthday is the day AFTER the tournament starts → age = 9
                mockPrisma.tournament.findUnique.mockResolvedValue(makeTournament('APPROVED'));

                const err = await service
                    .register(TOURNAMENT_ID, CATEGORY_ID, { ...validDto, playerDob: '2015-06-02' })
                    .catch((e) => e);

                expect(err).toBeInstanceOf(BadRequestException);
                expect(mockPrisma.$transaction).not.toHaveBeenCalled();
            });

            it('accepts player whose age equals maxAge exactly (age = 18)', async () => {
                // DOB 2007-06-01: turns 18 on the exact tournament start date → age = 18 = maxAge
                setupHappyPath();

                await expect(
                    service.register(TOURNAMENT_ID, CATEGORY_ID, { ...validDto, playerDob: '2007-06-01' })
                ).resolves.toBeDefined();
            });

            it('rejects player who is one year above maxAge (age = 19)', async () => {
                // DOB 2006-06-01: age = 19 at 2025-06-01 → exceeds maxAge = 18
                mockPrisma.tournament.findUnique.mockResolvedValue(makeTournament('APPROVED'));

                const err = await service
                    .register(TOURNAMENT_ID, CATEGORY_ID, { ...validDto, playerDob: '2006-06-01' })
                    .catch((e) => e);

                expect(err).toBeInstanceOf(BadRequestException);
            });

            it('uses tournament startDate — not today — for age calculation', async () => {
                /**
                 * Tournament starts 2040-01-01.
                 * DOB = 2010-01-01:
                 *   age at 2040-01-01 = 30  →  ABOVE maxAge 18  →  must REJECT
                 *   age at today (2026-03-29) = 16  →  would be VALID if we used today
                 *
                 * If this test throws BadRequestException, startDate was correctly used.
                 * If it resolves, current date was incorrectly used instead.
                 */
                mockPrisma.tournament.findUnique.mockResolvedValue({
                    ...makeTournament('APPROVED'),
                    startDate: new Date('2040-01-01'),
                });

                await expect(
                    service.register(TOURNAMENT_ID, CATEGORY_ID, { ...validDto, playerDob: '2010-01-01' })
                ).rejects.toThrow(BadRequestException);
            });

        });

        // ── Duplicate detection ────────────────────────────────────────────────

        describe('duplicate detection', () => {

            it('throws ConflictException(DUPLICATE_REGISTRATION) when same phone has a non-cancelled registration', async () => {
                mockPrisma.tournament.findUnique.mockResolvedValue(makeTournament('APPROVED'));
                // Simulate an existing CONFIRMED registration with the same phone
                mockPrisma.registration.findFirst.mockResolvedValue({
                    id: 'existing-reg',
                    status: 'CONFIRMED',
                });

                const err = await service
                    .register(TOURNAMENT_ID, CATEGORY_ID, validDto)
                    .catch((e) => e);

                expect(err).toBeInstanceOf(ConflictException);
                expect(err.message).toBe('DUPLICATE_REGISTRATION');
                expect(mockPrisma.$transaction).not.toHaveBeenCalled();
            });

            it('queries findFirst with { status: { not: "CANCELLED" } } — cancelled registrations are excluded', async () => {
                /**
                 * A player whose previous registration was CANCELLED must be allowed to
                 * re-register. The query MUST use status: { not: 'CANCELLED' }.
                 * If it used status: 'CONFIRMED', a PENDING_PAYMENT duplicate would slip through.
                 */
                setupHappyPath();

                await service.register(TOURNAMENT_ID, CATEGORY_ID, validDto);

                expect(mockPrisma.registration.findFirst).toHaveBeenCalledWith(
                    expect.objectContaining({
                        where: expect.objectContaining({
                            tournamentId: TOURNAMENT_ID,
                            phone: validDto.phone,
                            status: { not: 'CANCELLED' },
                        }),
                    })
                );
            });

        });

        // ── Seat locking (inside transaction) ─────────────────────────────────

        describe('seat locking — enforced by SELECT FOR UPDATE result', () => {

            beforeEach(() => {
                mockPrisma.tournament.findUnique.mockResolvedValue(makeTournament('APPROVED'));
                mockPrisma.registration.findFirst.mockResolvedValue(null);
            });

            it('throws ConflictException(SEAT_LIMIT_REACHED) when registered_count = max_seats (full)', async () => {
                mockPrisma.$transaction.mockImplementation(async (fn: any) =>
                    fn({
                        $queryRaw: jest.fn().mockResolvedValue([{ registered_count: 50, max_seats: 50 }]),
                        registration: { create: jest.fn() },
                    })
                );

                const err = await service
                    .register(TOURNAMENT_ID, CATEGORY_ID, validDto)
                    .catch((e) => e);

                expect(err).toBeInstanceOf(ConflictException);
                expect(err.message).toBe('SEAT_LIMIT_REACHED');
            });

            it('throws ConflictException(SEAT_LIMIT_REACHED) when registered_count > max_seats (drift guard)', async () => {
                // Should not happen in a healthy system, but the guard must still reject
                mockPrisma.$transaction.mockImplementation(async (fn: any) =>
                    fn({
                        $queryRaw: jest.fn().mockResolvedValue([{ registered_count: 51, max_seats: 50 }]),
                        registration: { create: jest.fn() },
                    })
                );

                await expect(
                    service.register(TOURNAMENT_ID, CATEGORY_ID, validDto)
                ).rejects.toThrow(ConflictException);
            });

            it('allows registration when exactly one seat remains (registered_count = max_seats - 1)', async () => {
                const { tx } = buildTxMock(makeFakeReg(), 49, 50); // 49/50 used
                mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

                await expect(
                    service.register(TOURNAMENT_ID, CATEGORY_ID, validDto)
                ).resolves.toBeDefined();
            });

            it('does not call registration.create when seat limit is reached', async () => {
                const createMock = jest.fn();
                mockPrisma.$transaction.mockImplementation(async (fn: any) =>
                    fn({
                        $queryRaw: jest.fn().mockResolvedValue([{ registered_count: 50, max_seats: 50 }]),
                        registration: { create: createMock },
                    })
                );

                await service.register(TOURNAMENT_ID, CATEGORY_ID, validDto).catch(() => {});

                expect(createMock).not.toHaveBeenCalled();
            });

        });

        // ── Entry number generation ────────────────────────────────────────────

        describe('entry number generation', () => {

            it('formats entry number as KS-YYYY-NNNNNN using current year', async () => {
                const { createMock } = setupHappyPath();

                await service.register(TOURNAMENT_ID, CATEGORY_ID, validDto);

                const data = createMock.mock.calls[0][0].data;
                const expectedYear = new Date().getFullYear();
                expect(data.entryNumber).toMatch(new RegExp(`^KS-${expectedYear}-\\d{6}$`));
            });

            it('zero-pads the sequence to 6 digits (nextval = 1 → "000001")', async () => {
                const { createMock } = setupHappyPath(); // queryRawMock returns BigInt(1)

                await service.register(TOURNAMENT_ID, CATEGORY_ID, validDto);

                const data = createMock.mock.calls[0][0].data;
                expect(data.entryNumber).toMatch(/KS-\d{4}-000001$/);
            });

            it('does not truncate large sequence numbers (nextval = 999999 → "999999")', async () => {
                mockPrisma.tournament.findUnique.mockResolvedValue(makeTournament('APPROVED'));
                mockPrisma.registration.findFirst.mockResolvedValue(null);

                const createMock = jest.fn().mockResolvedValue(makeFakeReg());
                const queryRawMock = jest.fn()
                    .mockResolvedValueOnce([{ registered_count: 0, max_seats: 50 }])
                    .mockResolvedValueOnce([{ nextval: BigInt(999_999) }]);
                mockPrisma.$transaction.mockImplementation(async (fn: any) =>
                    fn({ $queryRaw: queryRawMock, registration: { create: createMock } })
                );

                await service.register(TOURNAMENT_ID, CATEGORY_ID, validDto);

                const data = createMock.mock.calls[0][0].data;
                expect(data.entryNumber).toMatch(/KS-\d{4}-999999$/);
            });

        });

        // ── Registration data stored in DB ─────────────────────────────────────

        describe('data persisted to registration.create', () => {

            it('stores all player fields from the DTO', async () => {
                const { createMock } = setupHappyPath();

                const dto = { ...validDto, fideId: 'FIDE123', fideRating: 1450 };
                await service.register(TOURNAMENT_ID, CATEGORY_ID, dto);

                const data = createMock.mock.calls[0][0].data;
                expect(data.playerName).toBe(dto.playerName);
                expect(data.phone).toBe(dto.phone);
                expect(data.email).toBe(dto.email);
                expect(data.city).toBe(dto.city);
                expect(data.fideId).toBe(dto.fideId);
                expect(data.fideRating).toBe(dto.fideRating);
                expect(data.tournamentId).toBe(TOURNAMENT_ID);
                expect(data.categoryId).toBe(CATEGORY_ID);
            });

            it('converts playerDob from string to a Date instance before storing', async () => {
                // The DB column is a Date. Storing a raw string would silently fail in Prisma.
                const { createMock } = setupHappyPath();

                await service.register(TOURNAMENT_ID, CATEGORY_ID, validDto);

                const data = createMock.mock.calls[0][0].data;
                expect(data.playerDob).toBeInstanceOf(Date);
                expect(data.playerDob.toISOString()).toContain('2010-01-01');
            });

            it('sets expiresAt to approximately 2 hours from call time', async () => {
                mockPrisma.tournament.findUnique.mockResolvedValue(makeTournament('APPROVED'));
                mockPrisma.registration.findFirst.mockResolvedValue(null);

                // Capture the create call args by inspecting the transaction function
                const captureCreateMock = jest.fn().mockResolvedValue(makeFakeReg());
                const captureQueryRawMock = jest.fn()
                    .mockResolvedValueOnce([{ registered_count: 5, max_seats: 50 }])
                    .mockResolvedValueOnce([{ nextval: BigInt(1) }]);
                mockPrisma.$transaction.mockImplementation(async (fn: any) =>
                    fn({ $queryRaw: captureQueryRawMock, registration: { create: captureCreateMock } })
                );

                const before = Date.now();
                await service.register(TOURNAMENT_ID, CATEGORY_ID, validDto);
                const after = Date.now();

                const expiresAtMs = captureCreateMock.mock.calls[0][0].data.expiresAt.getTime();
                const twoHoursMs = 2 * 60 * 60 * 1000;

                expect(expiresAtMs).toBeGreaterThanOrEqual(before + twoHoursMs);
                // 5-second tolerance for test execution time
                expect(expiresAtMs).toBeLessThanOrEqual(after + twoHoursMs + 5_000);
            });

        });

        // ── Payment creation ───────────────────────────────────────────────────

        describe('Razorpay payment creation', () => {

            it('calls PaymentsService.createOrder with the new registrationId and category entryFeePaise', async () => {
                const { fakeReg } = setupHappyPath();

                await service.register(TOURNAMENT_ID, CATEGORY_ID, validDto);

                expect(mockPayments.createOrder).toHaveBeenCalledWith(fakeReg.id, 50_000);
                expect(mockPayments.createOrder).toHaveBeenCalledTimes(1);
            });

            it('returns PENDING_PAYMENT status with payment details when Razorpay succeeds', async () => {
                const { fakeReg } = setupHappyPath();

                const result = await service.register(TOURNAMENT_ID, CATEGORY_ID, validDto);

                expect(result.data.status).toBe('PENDING_PAYMENT');
                expect(result.data.payment).toEqual(
                    expect.objectContaining({ razorpay_order_id: 'order_test_1' })
                );
                expect(result.data.registration_id).toBe(fakeReg.id);
                expect(result.data.entry_number).toBe(fakeReg.entryNumber);
                expect(result.data.expires_at).toEqual(fakeReg.expiresAt);
            });

            it('returns PENDING_PAYMENT with payment: null when Razorpay throws — registration must NOT be rolled back', async () => {
                /**
                 * Razorpay outages must NOT abort the registration. The player is already
                 * in the DB as PENDING_PAYMENT. The reconciliation worker will pick up
                 * any stuck payments. Swallowing the error here is intentional.
                 */
                setupHappyPath();
                mockPayments.createOrder.mockRejectedValue(new Error('Razorpay connection timeout'));

                const result = await service.register(TOURNAMENT_ID, CATEGORY_ID, validDto);

                expect(result.data.status).toBe('PENDING_PAYMENT');
                expect(result.data.payment).toBeNull();
            });

            it('does not call createOrder when the transaction itself throws (seat limit)', async () => {
                mockPrisma.tournament.findUnique.mockResolvedValue(makeTournament('APPROVED'));
                mockPrisma.registration.findFirst.mockResolvedValue(null);
                mockPrisma.$transaction.mockImplementation(async (fn: any) =>
                    fn({
                        $queryRaw: jest.fn().mockResolvedValue([{ registered_count: 50, max_seats: 50 }]),
                        registration: { create: jest.fn() },
                    })
                );

                await service.register(TOURNAMENT_ID, CATEGORY_ID, validDto).catch(() => {});

                expect(mockPayments.createOrder).not.toHaveBeenCalled();
            });

        });

    });

    // ══════════════════════════════════════════════════════════════════════════
    // getPublicParticipants()
    // ══════════════════════════════════════════════════════════════════════════

    describe('getPublicParticipants()', () => {

        it('throws NotFoundException when tournament does not exist', async () => {
            mockPrisma.tournament.findUnique.mockResolvedValue(null);

            await expect(
                service.getPublicParticipants(TOURNAMENT_ID)
            ).rejects.toThrow(NotFoundException);
        });

        it.each(['DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'CANCELLED'])(
            'returns empty participants with status message for %s tournament (not yet public)',
            async (status) => {
                mockPrisma.tournament.findUnique.mockResolvedValue({
                    ...makeTournament(status),
                    categories: [],
                });

                const result = await service.getPublicParticipants(TOURNAMENT_ID);

                expect(result.data.participants).toHaveLength(0);
                expect(result.data.meta.status).toBe(status);
                // Must not attempt to query registrations for a non-public tournament
                expect(mockPrisma.registration.findMany).not.toHaveBeenCalled();
            }
        );

        it.each(['APPROVED', 'ACTIVE', 'CLOSED'])(
            'queries CONFIRMED registrations for %s tournament',
            async (status) => {
                mockPrisma.tournament.findUnique.mockResolvedValue({
                    id: TOURNAMENT_ID,
                    status,
                    categories: [makeCategory()],
                });
                mockPrisma.registration.findMany.mockResolvedValue([]);

                await service.getPublicParticipants(TOURNAMENT_ID);

                expect(mockPrisma.registration.findMany).toHaveBeenCalledWith(
                    expect.objectContaining({
                        where: { tournamentId: TOURNAMENT_ID, status: 'CONFIRMED' },
                    })
                );
            }
        );

        it('strips all PII — participant objects contain ONLY entry_number, player_name, city, category', async () => {
            mockPrisma.tournament.findUnique.mockResolvedValue({
                id: TOURNAMENT_ID,
                status: 'ACTIVE',
                categories: [makeCategory()],
            });
            mockPrisma.registration.findMany.mockResolvedValue([
                {
                    id: 'reg-1',
                    entryNumber: 'KS-2025-000001',
                    playerName: 'Arjun Kumar',
                    city: 'Chennai',
                    // PII fields — must NOT appear in output:
                    phone: '+919876543210',
                    email: 'arjun@example.com',
                    playerDob: new Date('2010-01-01'),
                    fideId: '12345678',
                    fideRating: 1200,
                    category: { name: 'Under 18' },
                },
            ]);

            const result = await service.getPublicParticipants(TOURNAMENT_ID);
            const participant = result.data.participants[0];

            // Assert exact shape — no extra fields allowed
            expect(participant).toStrictEqual({
                entry_number: 'KS-2025-000001',
                player_name: 'Arjun Kumar',
                city: 'Chennai',
                category: 'Under 18',
            });
        });

        it('replaces null city with em-dash placeholder', async () => {
            mockPrisma.tournament.findUnique.mockResolvedValue({
                id: TOURNAMENT_ID, status: 'ACTIVE', categories: [makeCategory()],
            });
            mockPrisma.registration.findMany.mockResolvedValue([
                {
                    entryNumber: 'KS-2025-000002',
                    playerName: 'Priya Menon',
                    city: null,
                    category: { name: 'Under 10' },
                },
            ]);

            const result = await service.getPublicParticipants(TOURNAMENT_ID);

            expect(result.data.participants[0].city).toBe('—');
        });

        it('includes seat availability summary per category (registered / max / remaining)', async () => {
            const category = makeCategory({ maxSeats: 50, registeredCount: 30 });
            mockPrisma.tournament.findUnique.mockResolvedValue({
                id: TOURNAMENT_ID, status: 'ACTIVE', categories: [category],
            });
            mockPrisma.registration.findMany.mockResolvedValue([]);

            const result = await service.getPublicParticipants(TOURNAMENT_ID);

            expect(result.data.meta.by_category).toEqual([
                expect.objectContaining({
                    name: 'Under 18',
                    registered: 30,
                    max_seats: 50,
                    seats_remaining: 20,
                }),
            ]);
        });

        it('clamps seats_remaining to 0 when registeredCount drifts above maxSeats', async () => {
            // Count drift can occur if a background job partially fails.
            // UI must never show a negative remaining count.
            const category = makeCategory({ maxSeats: 50, registeredCount: 55 });
            mockPrisma.tournament.findUnique.mockResolvedValue({
                id: TOURNAMENT_ID, status: 'ACTIVE', categories: [category],
            });
            mockPrisma.registration.findMany.mockResolvedValue([]);

            const result = await service.getPublicParticipants(TOURNAMENT_ID);

            const byCategory = result.data.meta.by_category as Array<{ seats_remaining: number }>;
            expect(byCategory[0].seats_remaining).toBe(0);
        });

        it('reports correct total_confirmed equal to confirmed participant count', async () => {
            mockPrisma.tournament.findUnique.mockResolvedValue({
                id: TOURNAMENT_ID, status: 'ACTIVE', categories: [makeCategory()],
            });
            mockPrisma.registration.findMany.mockResolvedValue([
                { entryNumber: 'KS-1', playerName: 'P1', city: 'C1', category: { name: 'U18' } },
                { entryNumber: 'KS-2', playerName: 'P2', city: 'C2', category: { name: 'U18' } },
                { entryNumber: 'KS-3', playerName: 'P3', city: 'C3', category: { name: 'U18' } },
            ]);

            const result = await service.getPublicParticipants(TOURNAMENT_ID);

            expect(result.data.meta.total_confirmed).toBe(3);
        });

        it('sums total_seats across all categories', async () => {
            const catA = makeCategory({ id: 'cat-a', name: 'U10', maxSeats: 30, registeredCount: 10 });
            const catB = { ...makeCategory({ id: 'cat-b', name: 'U18', maxSeats: 50, registeredCount: 20 }) };
            mockPrisma.tournament.findUnique.mockResolvedValue({
                id: TOURNAMENT_ID, status: 'ACTIVE', categories: [catA, catB],
            });
            mockPrisma.registration.findMany.mockResolvedValue([]);

            const result = await service.getPublicParticipants(TOURNAMENT_ID);

            expect(result.data.meta.total_seats).toBe(80); // 30 + 50
        });

    });

    // ══════════════════════════════════════════════════════════════════════════
    // getStatus()
    // ══════════════════════════════════════════════════════════════════════════

    describe('getStatus()', () => {

        it('throws NotFoundException when entry number does not exist', async () => {
            mockPrisma.registration.findUnique.mockResolvedValue(null);

            await expect(
                service.getStatus('KS-2025-000099')
            ).rejects.toThrow(NotFoundException);
        });

        it('returns correctly shaped status response for a valid entry number', async () => {
            const confirmedAt = new Date('2025-05-01T10:00:00Z');
            mockPrisma.registration.findUnique.mockResolvedValue({
                entryNumber: 'KS-2025-000001',
                playerName: 'Arjun Kumar',
                status: 'CONFIRMED',
                confirmedAt,
                tournament: { title: 'KSA Open 2025', startDate: TOURNAMENT_START },
                category: { name: 'Under 18' },
            });

            const result = await service.getStatus('KS-2025-000001');

            expect(result.data).toStrictEqual({
                entry_number: 'KS-2025-000001',
                player_name: 'Arjun Kumar',
                tournament: { title: 'KSA Open 2025', start_date: TOURNAMENT_START },
                category: 'Under 18',
                status: 'CONFIRMED',
                confirmed_at: confirmedAt,
            });
        });

        it('looks up by entryNumber field, not by id', async () => {
            mockPrisma.registration.findUnique.mockResolvedValue(null);

            await service.getStatus('KS-2025-000001').catch(() => {});

            expect(mockPrisma.registration.findUnique).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { entryNumber: 'KS-2025-000001' },
                })
            );
        });

        it('returns confirmedAt as null for PENDING_PAYMENT registrations', async () => {
            mockPrisma.registration.findUnique.mockResolvedValue({
                entryNumber: 'KS-2025-000002',
                playerName: 'Meera Iyer',
                status: 'PENDING_PAYMENT',
                confirmedAt: null,
                tournament: { title: 'KSA Open 2025', startDate: TOURNAMENT_START },
                category: { name: 'Under 10' },
            });

            const result = await service.getStatus('KS-2025-000002');

            expect(result.data.confirmed_at).toBeNull();
            expect(result.data.status).toBe('PENDING_PAYMENT');
        });

    });

    // ══════════════════════════════════════════════════════════════════════════
    // What CANNOT be tested here — integration test requirements
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * The following scenarios CANNOT be validated with Jest mocks. Each requires
     * a real Postgres instance (e.g., Docker Compose in CI) with concurrent
     * connections to prove the invariant holds.
     *
     * How to run integration tests:
     *   1. docker compose up postgres --wait
     *   2. DATABASE_URL=... prisma migrate deploy
     *   3. jest --config test/jest-integration.json
     */
    describe('Requires integration tests against real Postgres — NOT testable via mocks', () => {

        it.todo(
            'CONCURRENCY: two simultaneous registrations for the last seat — only one should succeed. ' +
            'Mock $transaction runs sequentially so both "win". ' +
            'Real test: fire two requests in parallel via Promise.all, assert one gets SEAT_LIMIT_REACHED.'
        );

        it.todo(
            'DB TRIGGER: registeredCount increments by 1 after INSERT into registrations. ' +
            'Mock bypasses the trigger entirely. ' +
            'Real test: insert registration, reload category, assert registeredCount = previousCount + 1.'
        );

        it.todo(
            'ATOMIC ROLLBACK: if registration.create fails mid-transaction, no partial state is persisted. ' +
            'Mock $transaction does not simulate Postgres ROLLBACK semantics. ' +
            'Real test: inject a DB constraint violation inside the transaction, assert nothing was written.'
        );

        it.todo(
            'SEQUENCE UNIQUENESS: entry_number_seq never produces duplicate values under concurrent load. ' +
            'Mock always returns BigInt(1). ' +
            'Real test: register 100 players concurrently, assert all entryNumbers are unique.'
        );

        it.todo(
            'PURGE VS WEBHOOK RACE: a payment captured at T+1:59h and the purge job running at T+2:00h ' +
            'both target the same PENDING_PAYMENT registration. ' +
            'One of them must win cleanly; the other must be a no-op. ' +
            'Real test: run both code paths concurrently against the same registration row.'
        );

    });

});
