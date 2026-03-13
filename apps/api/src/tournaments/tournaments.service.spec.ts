// S2-7: Unit tests for TournamentsService — status machine
import { Test, TestingModule } from '@nestjs/testing';
import { TournamentsService } from './tournaments.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { TournamentStatus } from '@prisma/client';

// ── Mock helpers ───────────────────────────────────────────────────────────────

function makeTournament(status: TournamentStatus) {
    return {
        id: 'tournament-uuid-1',
        organizerId: 'org-uuid-1',
        title: 'Test Cup',
        status,
    };
}

const mockTx = {
    tournament: { update: jest.fn().mockImplementation(({ data }) => ({ id: 'tournament-uuid-1', status: data.status })) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
};

const mockPrisma = {
    tournament: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
    },
    category: { deleteMany: jest.fn(), createMany: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
};

// ── Test Suite ─────────────────────────────────────────────────────────────────

describe('TournamentsService — status machine', () => {
    let service: TournamentsService;

    beforeEach(async () => {
        jest.clearAllMocks();
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TournamentsService,
                { provide: PrismaService, useValue: mockPrisma },
            ],
        }).compile();

        service = module.get<TournamentsService>(TournamentsService);
    });

    function setupTransition(fromStatus: TournamentStatus) {
        mockPrisma.tournament.findUnique.mockResolvedValue(makeTournament(fromStatus));
        mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));
    }

    // ── Valid transitions ──────────────────────────────────────────────────────

    it('DRAFT → PENDING_APPROVAL succeeds', async () => {
        setupTransition('DRAFT');
        const result = await service.applyStatusTransition('tournament-uuid-1', 'PENDING_APPROVAL', 'admin-id');
        expect(result.data.status).toBe('PENDING_APPROVAL');
        expect(mockTx.auditLog.create).toHaveBeenCalled();
    });

    it('PENDING_APPROVAL → APPROVED succeeds', async () => {
        setupTransition('PENDING_APPROVAL');
        const result = await service.applyStatusTransition('tournament-uuid-1', 'APPROVED', 'admin-id');
        expect(result.data.status).toBe('APPROVED');
    });

    it('PENDING_APPROVAL → REJECTED succeeds', async () => {
        setupTransition('PENDING_APPROVAL');
        const result = await service.applyStatusTransition('tournament-uuid-1', 'REJECTED', 'admin-id', 'Missing details');
        expect(result.data.status).toBe('REJECTED');
    });

    it('APPROVED → ACTIVE succeeds', async () => {
        setupTransition('APPROVED');
        const result = await service.applyStatusTransition('tournament-uuid-1', 'ACTIVE', 'admin-id');
        expect(result.data.status).toBe('ACTIVE');
    });

    it('APPROVED → CANCELLED succeeds', async () => {
        setupTransition('APPROVED');
        const result = await service.applyStatusTransition('tournament-uuid-1', 'CANCELLED', 'admin-id', 'Admin decision');
        expect(result.data.status).toBe('CANCELLED');
    });

    it('ACTIVE → CLOSED succeeds', async () => {
        setupTransition('ACTIVE');
        const result = await service.applyStatusTransition('tournament-uuid-1', 'CLOSED', 'admin-id');
        expect(result.data.status).toBe('CLOSED');
    });

    it('ACTIVE → CANCELLED succeeds', async () => {
        setupTransition('ACTIVE');
        const result = await service.applyStatusTransition('tournament-uuid-1', 'CANCELLED', 'admin-id', 'Event cancelled');
        expect(result.data.status).toBe('CANCELLED');
    });

    // ── Invalid transitions ────────────────────────────────────────────────────

    it('DRAFT → APPROVED throws 409 ConflictException', async () => {
        setupTransition('DRAFT');
        await expect(
            service.applyStatusTransition('tournament-uuid-1', 'APPROVED', 'admin-id'),
        ).rejects.toThrow(ConflictException);
    });

    it('CLOSED → ACTIVE throws 409 ConflictException', async () => {
        setupTransition('CLOSED');
        await expect(
            service.applyStatusTransition('tournament-uuid-1', 'ACTIVE', 'admin-id'),
        ).rejects.toThrow(ConflictException);
    });

    it('REJECTED → APPROVED throws 409 ConflictException', async () => {
        setupTransition('REJECTED');
        await expect(
            service.applyStatusTransition('tournament-uuid-1', 'APPROVED', 'admin-id'),
        ).rejects.toThrow(ConflictException);
    });

    // ── Not found ─────────────────────────────────────────────────────────────

    it('throws NotFoundException when tournament does not exist', async () => {
        mockPrisma.tournament.findUnique.mockResolvedValue(null);
        await expect(
            service.applyStatusTransition('nonexistent-id', 'APPROVED', 'admin-id'),
        ).rejects.toThrow(NotFoundException);
    });
});
