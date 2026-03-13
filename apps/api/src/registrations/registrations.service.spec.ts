// S3-8: Unit tests for RegistrationsService
import { Test, TestingModule } from '@nestjs/testing';
import { RegistrationsService } from './registrations.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { QueueService } from '../queue/queue.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

// ── Fixtures ───────────────────────────────────────────────────────────────────

const TOURNAMENT_ID = 'tournament-uuid-1';
const CATEGORY_ID = 'category-uuid-1';

// Tournament start date gives age = 15 for a 2010-01-01 DOB
const TOURNAMENT_START = new Date('2025-06-01');

function makeCategory(overrides: Partial<any> = {}) {
    return {
        id: CATEGORY_ID,
        minAge: 10,
        maxAge: 18,
        entryFeePaise: 50000,
        maxSeats: 50,
        registeredCount: 0,
        ...overrides,
    };
}

function makeTournament(status = 'APPROVED', categoryOverrides: Partial<any> = {}) {
    return {
        id: TOURNAMENT_ID,
        status,
        startDate: TOURNAMENT_START,
        categories: [makeCategory(categoryOverrides)],
    };
}

const validDto = {
    playerName: 'Arjun Kumar',
    playerDob: '2010-01-01', // age = 15 at tournament start → valid for 10–18
    phone: '+919876543210',
    email: 'arjun@test.com',
    city: 'Chennai',
};

const mockPrisma = {
    tournament: { findUnique: jest.fn() },
    registration: { findFirst: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
    category: { update: jest.fn() },
    $transaction: jest.fn(),
};

const mockPayments = { createOrder: jest.fn().mockResolvedValue({ razorpay_order_id: 'order_1', amount_paise: 50000 }) };
const mockQueue = { add: jest.fn() };

// ── Test Suite ─────────────────────────────────────────────────────────────────

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

    // ── Tournament checks ──────────────────────────────────────────────────────

    it('throws NotFoundException when tournament does not exist', async () => {
        mockPrisma.tournament.findUnique.mockResolvedValue(null);

        await expect(service.register(TOURNAMENT_ID, CATEGORY_ID, validDto)).rejects.toThrow(NotFoundException);
    });

    it('throws 409 when tournament is not APPROVED or ACTIVE', async () => {
        mockPrisma.tournament.findUnique.mockResolvedValue(makeTournament('DRAFT'));

        await expect(service.register(TOURNAMENT_ID, CATEGORY_ID, validDto)).rejects.toThrow(ConflictException);
    });

    // ── Age validation ─────────────────────────────────────────────────────────

    it('throws 400 when player age is below category minAge', async () => {
        // DOB = 2022 → age = 3 at tournament start (2025), minAge = 10
        mockPrisma.tournament.findUnique.mockResolvedValue(makeTournament('APPROVED'));
        const dto = { ...validDto, playerDob: '2022-01-01' };

        await expect(service.register(TOURNAMENT_ID, CATEGORY_ID, dto)).rejects.toThrow(BadRequestException);
    });

    it('throws 400 when player age exceeds category maxAge', async () => {
        // DOB = 2000 → age = 25 at tournament start, maxAge = 18
        mockPrisma.tournament.findUnique.mockResolvedValue(makeTournament('APPROVED'));
        const dto = { ...validDto, playerDob: '2000-01-01' };

        await expect(service.register(TOURNAMENT_ID, CATEGORY_ID, dto)).rejects.toThrow(BadRequestException);
    });

    // ── Duplicate detection ────────────────────────────────────────────────────

    it('throws 409 on duplicate phone registration in same tournament', async () => {
        mockPrisma.tournament.findUnique.mockResolvedValue(makeTournament('APPROVED'));
        mockPrisma.registration.findFirst.mockResolvedValue({ id: 'existing-reg' });

        await expect(service.register(TOURNAMENT_ID, CATEGORY_ID, validDto)).rejects.toThrow(ConflictException);
    });

    // ── Seat locking ───────────────────────────────────────────────────────────

    it('throws 409 SEAT_LIMIT_REACHED when category is full', async () => {
        mockPrisma.tournament.findUnique.mockResolvedValue(makeTournament('APPROVED', { maxSeats: 50, registeredCount: 50 }));
        mockPrisma.registration.findFirst.mockResolvedValue(null);
        // Simulate SELECT FOR UPDATE returning full category
        mockPrisma.$transaction.mockImplementation(async (fn: any) => {
            return fn({
                $queryRaw: jest.fn().mockResolvedValue([{ registered_count: 50, max_seats: 50 }]),
                registration: { create: jest.fn() },
                category: { update: jest.fn() },
            });
        });

        await expect(service.register(TOURNAMENT_ID, CATEGORY_ID, validDto)).rejects.toThrow(ConflictException);
    });

    // ── Happy path ─────────────────────────────────────────────────────────────

    it('returns registration details and payment info on success', async () => {
        const fakeReg = {
            id: 'reg-uuid-1',
            entryNumber: 'ECA-2025-000001',
            expiresAt: new Date(Date.now() + 7200000),
        };

        mockPrisma.tournament.findUnique.mockResolvedValue(makeTournament('APPROVED'));
        mockPrisma.registration.findFirst.mockResolvedValue(null);
        mockPrisma.$transaction.mockImplementation(async (fn: any) => {
            // $queryRaw is called twice:
            // 1st call: SELECT FOR UPDATE seat check → returns seat counts
            // 2nd call: SELECT nextval('entry_number_seq') → returns sequence value
            const queryRawMock = jest.fn()
                .mockResolvedValueOnce([{ registered_count: 5, max_seats: 50 }])
                .mockResolvedValueOnce([{ nextval: BigInt(1) }]);
            return fn({
                $queryRaw: queryRawMock,
                registration: { create: jest.fn().mockResolvedValue(fakeReg) },
                category: { update: jest.fn() },
            });
        });

        const result = await service.register(TOURNAMENT_ID, CATEGORY_ID, validDto);

        expect(result.data.entry_number).toBe('ECA-2025-000001');
        expect(result.data.status).toBe('PENDING_PAYMENT');
        expect(result.data.payment).toBeDefined();
        expect(mockPayments.createOrder).toHaveBeenCalledWith('reg-uuid-1', 50000);
    });
});
