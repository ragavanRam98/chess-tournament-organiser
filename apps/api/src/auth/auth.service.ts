// apps/api/src/auth/auth.service.ts
import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterOrganizerDto } from './dto/register-organizer.dto';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { Request, Response } from 'express';

const COOKIE_NAME = 'refresh_token';
const COOKIE_OPTIONS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/auth/refresh',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
};

@Injectable()
export class AuthService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly jwt: JwtService,
    ) { }

    async registerOrganizer(dto: RegisterOrganizerDto): Promise<{ data: { message: string } }> {
        const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
        if (existing) throw new ConflictException('EMAIL_ALREADY_REGISTERED');

        await this.prisma.$transaction(async (tx) => {
            const user = await tx.user.create({
                data: {
                    email: dto.email,
                    passwordHash: await bcrypt.hash(dto.password, 12),
                    role: 'ORGANIZER',
                    status: 'PENDING_VERIFICATION',
                },
            });
            await tx.organizer.create({
                data: {
                    userId: user.id,
                    academyName: dto.academyName,
                    contactPhone: dto.contactPhone,
                    city: dto.city,
                    state: dto.state,
                    description: dto.description,
                },
            });
        });

        return { data: { message: 'Registration successful. Your account is pending admin verification.' } };
    }

    async login(dto: LoginDto, res: Response): Promise<{ data: { access_token: string; token_type: string; expires_in: number } }> {
        const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
        if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
            throw new UnauthorizedException('Invalid email or password');
        }
        if (user.status === 'PENDING_VERIFICATION') {
            throw new UnauthorizedException('Your account is pending admin verification. You will be notified once approved.');
        }
        if (user.status !== 'ACTIVE') {
            throw new UnauthorizedException('Your account has been suspended. Please contact support.');
        }

        const accessToken = this.issueAccessToken(user.id, user.role);
        const { rawToken, tokenHash } = this.generateRefreshToken();

        await this.prisma.refreshTokenSession.create({
            data: {
                userId: user.id,
                tokenHash,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
        });

        res.cookie(COOKIE_NAME, rawToken, COOKIE_OPTIONS);
        return { data: { access_token: accessToken, token_type: 'Bearer', expires_in: 900 } };
    }

    async refresh(req: Request, res: Response): Promise<{ data: { access_token: string; expires_in: number } }> {
        const rawToken: string = req.cookies?.[COOKIE_NAME];
        if (!rawToken) throw new UnauthorizedException('UNAUTHORIZED');

        const tokenHash = this.hashToken(rawToken);
        const session = await this.prisma.refreshTokenSession.findUnique({ where: { tokenHash }, include: { user: true } });

        if (!session || session.expiresAt < new Date()) {
            throw new UnauthorizedException('UNAUTHORIZED');
        }

        const accessToken = this.issueAccessToken(session.user.id, session.user.role);
        return { data: { access_token: accessToken, expires_in: 900 } };
    }

    async logout(req: Request, res: Response): Promise<{ data: { success: boolean } }> {
        const rawToken: string = req.cookies?.[COOKIE_NAME];
        if (rawToken) {
            const tokenHash = this.hashToken(rawToken);
            await this.prisma.refreshTokenSession.deleteMany({ where: { tokenHash } });
        }
        res.clearCookie(COOKIE_NAME, { path: '/auth/refresh' });
        return { data: { success: true } };
    }

    async getMe(userId: string): Promise<{ data: { id: string; email: string; role: string; displayName: string } }> {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            include: { organizer: { select: { academyName: true } } },
        });
        if (!user) throw new UnauthorizedException('UNAUTHORIZED');
        const displayName = user.role === 'ORGANIZER'
            ? (user.organizer?.academyName ?? user.email)
            : 'Super Admin';
        return { data: { id: user.id, email: user.email, role: user.role, displayName } };
    }

    private issueAccessToken(userId: string, role: string): string {
        return this.jwt.sign({ sub: userId, role });
    }

    private generateRefreshToken(): { rawToken: string; tokenHash: string } {
        const rawToken = crypto.randomBytes(64).toString('hex');
        return { rawToken, tokenHash: this.hashToken(rawToken) };
    }

    private hashToken(token: string): string {
        return crypto.createHash('sha256').update(token).digest('hex');
    }
}
