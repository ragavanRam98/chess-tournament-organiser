// S1-6: Unit tests for AuthService
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';

// Mock bcrypt at module level to avoid non-configurable property errors
jest.mock('bcrypt', () => ({
    compare: jest.fn(),
    hash: jest.fn(),
}));
import * as bcrypt from 'bcrypt';

// ── Mock factories ─────────────────────────────────────────────────────────────

const mockUser = {
    id: 'user-uuid-1',
    email: 'admin@test.com',
    passwordHash: 'hashed-pw',
    role: 'ORGANIZER',
    status: 'ACTIVE',
};

const mockSession = {
    tokenHash: 'sha256hash',
    expiresAt: new Date(Date.now() + 99999999),
    user: mockUser,
};

const mockPrisma = {
    user: { findUnique: jest.fn() },
    refreshTokenSession: {
        create: jest.fn(),
        findUnique: jest.fn(),
        deleteMany: jest.fn(),
    },
};

const mockJwt = { sign: jest.fn().mockReturnValue('signed.jwt.token') };

const mockRes: any = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
};

const mockReq: any = (cookies: Record<string, string> = {}) => ({ cookies });

// ── Test Suite ─────────────────────────────────────────────────────────────────

describe('AuthService', () => {
    let service: AuthService;

    beforeEach(async () => {
        jest.clearAllMocks();
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AuthService,
                { provide: PrismaService, useValue: mockPrisma },
                { provide: JwtService, useValue: mockJwt },
            ],
        }).compile();

        service = module.get<AuthService>(AuthService);
    });

    // ── login ──────────────────────────────────────────────────────────────────

    describe('login()', () => {
        it('returns access token on valid credentials', async () => {
            mockPrisma.user.findUnique.mockResolvedValue(mockUser);
            (bcrypt.compare as jest.Mock).mockResolvedValue(true);
            mockPrisma.refreshTokenSession.create.mockResolvedValue({});

            const result = await service.login(
                { email: 'admin@test.com', password: 'CorrectPw1!' },
                mockRes,
            );

            expect(result.data.access_token).toBe('signed.jwt.token');
            expect(result.data.token_type).toBe('Bearer');
            expect(mockRes.cookie).toHaveBeenCalledWith(
                'refresh_token',
                expect.any(String),
                expect.objectContaining({ httpOnly: true }),
            );
        });

        it('throws UnauthorizedException when user not found', async () => {
            mockPrisma.user.findUnique.mockResolvedValue(null);

            await expect(
                service.login({ email: 'nobody@test.com', password: 'Test1234!' }, mockRes),
            ).rejects.toThrow(UnauthorizedException);
        });

        it('throws UnauthorizedException when password is wrong', async () => {
            mockPrisma.user.findUnique.mockResolvedValue(mockUser);
            (bcrypt.compare as jest.Mock).mockResolvedValue(false);

            await expect(
                service.login({ email: 'admin@test.com', password: 'WrongPw1!' }, mockRes),
            ).rejects.toThrow(UnauthorizedException);
        });
    });

    // ── refresh ────────────────────────────────────────────────────────────────

    describe('refresh()', () => {
        it('returns new access token for valid session', async () => {
            mockPrisma.refreshTokenSession.findUnique.mockResolvedValue(mockSession);

            const result = await service.refresh(mockReq({ refresh_token: 'raw-token' }), mockRes);

            expect(result.data.access_token).toBe('signed.jwt.token');
        });

        it('throws UnauthorizedException when no cookie', async () => {
            await expect(service.refresh(mockReq({}), mockRes)).rejects.toThrow(UnauthorizedException);
        });

        it('throws UnauthorizedException for expired session', async () => {
            mockPrisma.refreshTokenSession.findUnique.mockResolvedValue({
                ...mockSession,
                expiresAt: new Date(Date.now() - 1000), // in the past
            });

            await expect(
                service.refresh(mockReq({ refresh_token: 'raw-token' }), mockRes),
            ).rejects.toThrow(UnauthorizedException);
        });

        it('throws UnauthorizedException when session not found', async () => {
            mockPrisma.refreshTokenSession.findUnique.mockResolvedValue(null);

            await expect(
                service.refresh(mockReq({ refresh_token: 'unknown-token' }), mockRes),
            ).rejects.toThrow(UnauthorizedException);
        });
    });

    // ── logout ─────────────────────────────────────────────────────────────────

    describe('logout()', () => {
        it('deletes session and clears cookie when token present', async () => {
            mockPrisma.refreshTokenSession.deleteMany.mockResolvedValue({ count: 1 });

            const result = await service.logout(mockReq({ refresh_token: 'raw-token' }), mockRes);

            expect(result.data.success).toBe(true);
            expect(mockPrisma.refreshTokenSession.deleteMany).toHaveBeenCalled();
            expect(mockRes.clearCookie).toHaveBeenCalledWith('refresh_token', expect.any(Object));
        });

        it('succeeds gracefully when no cookie present', async () => {
            const result = await service.logout(mockReq({}), mockRes);
            expect(result.data.success).toBe(true);
            expect(mockPrisma.refreshTokenSession.deleteMany).not.toHaveBeenCalled();
        });
    });
});
