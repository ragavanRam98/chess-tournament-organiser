import {
    Injectable,
    NotFoundException,
    ConflictException,
    ForbiddenException,
    Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { QueueService } from '../queue/queue.service';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { UpdateTournamentDto } from './dto/update-tournament.dto';
import { TournamentStatus, AuditAction } from '@prisma/client';

/** Map tournament status to audit action name */
const STATUS_TO_AUDIT_ACTION: Partial<Record<TournamentStatus, AuditAction>> = {
    APPROVED: 'APPROVED',
    ACTIVE: 'ACTIVATED',
    REJECTED: 'REJECTED',
    CANCELLED: 'CANCELLED',
    CLOSED: 'CLOSED',
};

/** Valid forward transitions for tournament status machine */
const ALLOWED_TRANSITIONS: Record<TournamentStatus, TournamentStatus[]> = {
    DRAFT: ['PENDING_APPROVAL'],
    PENDING_APPROVAL: ['APPROVED', 'REJECTED'],
    APPROVED: ['ACTIVE', 'CANCELLED'],
    ACTIVE: ['CLOSED', 'CANCELLED'],
    CLOSED: [],
    REJECTED: [],
    CANCELLED: [],
};

const ORGANIZER_SUBMIT_TO: TournamentStatus = 'PENDING_APPROVAL';

@Injectable()
export class TournamentsService {
    private readonly logger = new Logger(TournamentsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly queue: QueueService,
        private readonly storage: StorageService,
    ) { }

    // ── Organizer: Create ──────────────────────────────────────────────────────

    async create(organizerId: string, dto: CreateTournamentDto) {
        const tournament = await this.prisma.$transaction(async (tx) => {
            const t = await tx.tournament.create({
                data: {
                    organizerId,
                    title: dto.title,
                    description: dto.description,
                    city: dto.city,
                    venue: dto.venue,
                    startDate: new Date(dto.startDate),
                    endDate: new Date(dto.endDate),
                    registrationDeadline: new Date(dto.registrationDeadline),
                    status: 'DRAFT',
                    categories: {
                        create: dto.categories.map((c) => ({
                            name: c.name,
                            minAge: c.minAge,
                            maxAge: c.maxAge,
                            entryFeePaise: c.entryFeePaise,
                            maxSeats: c.maxSeats,
                        })),
                    },
                },
                include: { categories: true },
            });
            return t;
        });

        return { data: tournament };
    }

    // ── Organizer: List own ────────────────────────────────────────────────────

    async listByOrganizer(organizerId: string, query: unknown) {
        const q = query as Record<string, string> | undefined;
        const page = Math.max(1, parseInt(q?.['page'] ?? '1', 10));
        const limit = Math.min(50, Math.max(1, parseInt(q?.['limit'] ?? '20', 10)));
        const skip = (page - 1) * limit;

        const [tournaments, total] = await this.prisma.$transaction([
            this.prisma.tournament.findMany({
                where: { organizerId },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
                include: { categories: true },
            }),
            this.prisma.tournament.count({ where: { organizerId } }),
        ]);

        return { data: tournaments, meta: { total, page, limit } };
    }

    // ── Organizer: List registrations for a tournament ─────────────────────────

    async listRegistrationsForOrganizer(tournamentId: string, organizerId: string, query: Record<string, string>) {
        // Verify ownership
        const tournament = await this.prisma.tournament.findFirst({
            where: { id: tournamentId, organizerId },
            include: { categories: { select: { id: true, name: true, maxSeats: true, registeredCount: true }, orderBy: { minAge: 'asc' } } },
        });
        if (!tournament) throw new NotFoundException('NOT_FOUND');

        // Build where clause
        const where: Record<string, any> = { tournamentId };
        if (query.search) {
            where.playerName = { contains: query.search, mode: 'insensitive' };
        }
        if (query.status) {
            where.status = query.status;
        }
        if (query.categoryId) {
            where.categoryId = query.categoryId;
        }
        if (query.fide === 'rated') {
            where.fideId = { not: null };
        } else if (query.fide === 'unrated') {
            where.fideId = null;
        }

        // Sort
        const sortBy = query.sortBy ?? 'registeredAt';
        const sortDir = query.sortDir === 'asc' ? 'asc' : 'desc';
        const allowedSortFields = ['entryNumber', 'playerName', 'city', 'status', 'registeredAt', 'fideRating'];
        const orderField = allowedSortFields.includes(sortBy) ? sortBy : 'registeredAt';
        const orderBy: Record<string, string> = { [orderField]: sortDir };

        // Pagination
        const page = Math.max(1, parseInt(query.page ?? '1', 10));
        const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize ?? '20', 10)));
        const skip = (page - 1) * pageSize;

        const [registrations, total] = await this.prisma.$transaction([
            this.prisma.registration.findMany({
                where,
                include: { category: { select: { id: true, name: true } } },
                orderBy,
                skip,
                take: pageSize,
            }),
            this.prisma.registration.count({ where }),
        ]);

        // Batch FIDE verification — one query for all unique non-null fideIds
        const fideIds = [...new Set(registrations.map(r => r.fideId).filter(Boolean) as string[])];
        const verifiedSet = new Set<string>();
        if (fideIds.length > 0) {
            const verified = await this.prisma.fidePlayer.findMany({
                where: { fideId: { in: fideIds } },
                select: { fideId: true },
            });
            verified.forEach(p => verifiedSet.add(p.fideId));
        }

        // Status counts (for tabs)
        const statusCounts = await this.prisma.registration.groupBy({
            by: ['status'],
            where: { tournamentId },
            _count: true,
        });

        return {
            data: {
                registrations: registrations.map(r => ({
                    id: r.id,
                    entryNumber: r.entryNumber,
                    playerName: r.playerName,
                    phone: r.phone,
                    email: r.email,
                    city: r.city,
                    status: r.status,
                    registeredAt: r.registeredAt,
                    confirmedAt: r.confirmedAt,
                    category: r.category,
                    fideId: r.fideId,
                    fideRating: r.fideRating,
                    fideVerified: r.fideId ? verifiedSet.has(r.fideId) : null,
                })),
                total,
                page,
                pageSize,
                categories: tournament.categories,
                statusCounts: statusCounts.reduce((acc, s) => { acc[s.status] = s._count; return acc; }, {} as Record<string, number>),
            },
        };
    }

    // ── Organizer: Get one ─────────────────────────────────────────────────────

    async findOneForOrganizer(id: string, organizerId: string) {
        const t = await this.prisma.tournament.findFirst({
            where: { id, organizerId },
            include: { categories: true },
        });
        if (!t) throw new NotFoundException('NOT_FOUND');
        return { data: t };
    }

    // ── Organizer: Update (DRAFT only) ─────────────────────────────────────────

    async update(id: string, organizerId: string, dto: UpdateTournamentDto) {
        const t = await this.prisma.tournament.findFirst({ where: { id, organizerId } });
        if (!t) throw new NotFoundException('NOT_FOUND');
        if (t.status !== 'DRAFT') {
            throw new ForbiddenException('Only DRAFT tournaments can be edited');
        }

        const updated = await this.prisma.$transaction(async (tx) => {
            // Update tournament fields
            const result = await tx.tournament.update({
                where: { id },
                data: {
                    ...(dto.title && { title: dto.title }),
                    ...(dto.description !== undefined && { description: dto.description }),
                    ...(dto.city && { city: dto.city }),
                    ...(dto.venue && { venue: dto.venue }),
                    ...(dto.startDate && { startDate: new Date(dto.startDate) }),
                    ...(dto.endDate && { endDate: new Date(dto.endDate) }),
                    ...(dto.registrationDeadline && {
                        registrationDeadline: new Date(dto.registrationDeadline),
                    }),
                },
            });

            // If categories supplied, replace them entirely
            if (dto.categories) {
                await tx.category.deleteMany({ where: { tournamentId: id } });
                await tx.category.createMany({
                    data: dto.categories.map((c) => ({
                        tournamentId: id,
                        name: c.name,
                        minAge: c.minAge,
                        maxAge: c.maxAge,
                        entryFeePaise: c.entryFeePaise,
                        maxSeats: c.maxSeats,
                    })),
                });
            }

            return tx.tournament.findUnique({
                where: { id },
                include: { categories: true },
            });
        });

        return { data: updated };
    }

    // ── Organizer: Submit for approval ─────────────────────────────────────────

    async submitForApproval(id: string, organizerId: string) {
        const t = await this.prisma.tournament.findFirst({ where: { id, organizerId } });
        if (!t) throw new NotFoundException('NOT_FOUND');
        if (t.status !== 'DRAFT') {
            throw new ConflictException('Only DRAFT tournaments can be submitted for approval');
        }

        const updated = await this.prisma.tournament.update({
            where: { id },
            data: { status: ORGANIZER_SUBMIT_TO },
        });

        return { data: { id: updated.id, status: updated.status } };
    }

    // ── Public: List (APPROVED + ACTIVE) ──────────────────────────────────────

    async listPublic(query: unknown) {
        const q = query as Record<string, string> | undefined;
        const page = Math.max(1, parseInt(q?.['page'] ?? '1', 10));
        const limit = Math.min(50, Math.max(1, parseInt(q?.['limit'] ?? '20', 10)));
        const skip = (page - 1) * limit;

        const [tournaments, total] = await this.prisma.$transaction([
            this.prisma.tournament.findMany({
                where: { status: { in: ['APPROVED', 'ACTIVE'] } },
                orderBy: { startDate: 'asc' },
                skip,
                take: limit,
                include: {
                    categories: { select: { id: true, name: true, entryFeePaise: true, maxSeats: true, registeredCount: true } },
                    organizer: { select: { academyName: true, city: true } },
                },
            }),
            this.prisma.tournament.count({ where: { status: { in: ['APPROVED', 'ACTIVE'] } } }),
        ]);

        return { data: tournaments, meta: { total, page, limit } };
    }

    // ── Public: Get one ────────────────────────────────────────────────────────

    async findPublic(id: string) {
        const t = await this.prisma.tournament.findFirst({
            where: { id, status: { in: ['APPROVED', 'ACTIVE'] } },
            include: {
                categories: true,
                organizer: { select: { academyName: true, city: true, state: true } },
            },
        });
        if (!t) throw new NotFoundException('NOT_FOUND');
        const withPoster = await this.attachPosterUrl(t);
        return { data: withPoster };
    }

    // ── Organizer: Upload poster ────────────────────────────────────────────────

    async uploadPoster(id: string, organizerId: string, file: Express.Multer.File) {
        const t = await this.prisma.tournament.findFirst({ where: { id, organizerId } });
        if (!t) throw new NotFoundException('NOT_FOUND');

        // Delete old poster if exists
        if (t.posterKey) {
            try { await this.storage.delete(t.posterKey); } catch { /* ignore */ }
        }

        const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
        const key = `posters/${id}/${randomUUID()}${ext}`;
        await this.storage.upload(key, file.buffer, file.mimetype);

        await this.prisma.tournament.update({
            where: { id },
            data: { posterKey: key },
        });

        const posterUrl = await this.storage.getSignedUrl(key, 3600);
        return { data: { posterKey: key, posterUrl } };
    }

    // ── Helper: Generate poster URL ──────────────────────────────────────────

    private async attachPosterUrl<T extends { posterKey?: string | null }>(
        tournament: T,
    ): Promise<T & { posterUrl?: string | null }> {
        if (!tournament.posterKey) return { ...tournament, posterUrl: null };
        try {
            const posterUrl = await this.storage.getSignedUrl(tournament.posterKey, 3600);
            return { ...tournament, posterUrl };
        } catch {
            return { ...tournament, posterUrl: null };
        }
    }

    // ── Admin: Status transition ───────────────────────────────────────────────

    async applyStatusTransition(
        id: string,
        newStatus: TournamentStatus,
        adminUserId: string,
        reason?: string,
    ) {
        const t = await this.prisma.tournament.findUnique({ where: { id } });
        if (!t) throw new NotFoundException('NOT_FOUND');

        const allowed = ALLOWED_TRANSITIONS[t.status] ?? [];
        if (!allowed.includes(newStatus)) {
            throw new ConflictException(`Transition ${t.status} → ${newStatus} not allowed`);
        }

        const updated = await this.prisma.$transaction(async (tx) => {
            const result = await tx.tournament.update({
                where: { id },
                data: {
                    status: newStatus,
                    ...(newStatus === 'APPROVED' && {
                        approvedAt: new Date(),
                        approvedById: adminUserId,
                    }),
                    ...(newStatus === 'CANCELLED' && {
                        cancelledAt: new Date(),
                        cancelledById: adminUserId,
                        cancellationReason: reason,
                    }),
                    ...(newStatus === 'REJECTED' && {
                        rejectionReason: reason,
                    }),
                },
            });

            await tx.auditLog.create({
                data: {
                    entityType: 'tournament',
                    entityId: id,
                    action: STATUS_TO_AUDIT_ACTION[newStatus] ?? newStatus as any,
                    oldValue: { status: t.status } as any,
                    newValue: { status: newStatus, reason } as any,
                    performedById: adminUserId,
                },
            });

            return result;
        });

        // Queue refunds + cancellation emails for all confirmed registrations
        if (newStatus === 'CANCELLED') {
            const confirmed = await this.prisma.registration.findMany({
                where: { tournamentId: id, status: 'CONFIRMED' },
                select: { id: true },
            });
            for (const reg of confirmed) {
                await this.queue.add(QUEUE_NAMES.PAYMENTS, JOB_NAMES.PROCESS_REFUND, {
                    registrationId: reg.id,
                }, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
                await this.queue.add(QUEUE_NAMES.NOTIFICATIONS, JOB_NAMES.SEND_EMAIL, {
                    registrationId: reg.id, type: 'TOURNAMENT_CANCELLED',
                });
            }
            this.logger.log(`[CANCEL] Queued ${confirmed.length} refund + notification jobs for tournament ${id}`);
        }

        return { data: { id: updated.id, status: updated.status } };
    }

    // ── Organizer Dashboard ─────────────────────────────────────────────────

    async dashboardSummary(organizerId: string) {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

        // All tournaments for this organizer
        const tournaments = await this.prisma.tournament.findMany({
            where: { organizerId },
            select: { id: true, status: true, createdAt: true },
        });
        const tournamentIds = tournaments.map(t => t.id);

        const totalTournaments = tournaments.length;
        const activeTournaments = tournaments.filter(t => t.status === 'ACTIVE').length;
        const pendingApprovalCount = tournaments.filter(t => t.status === 'PENDING_APPROVAL').length;
        const createdThisMonth = tournaments.filter(t => t.createdAt >= startOfMonth).length;

        if (tournamentIds.length === 0) {
            return {
                data: {
                    totalTournaments, activeTournaments, pendingApprovalCount, createdThisMonth,
                    totalRegistrations: 0, pendingPaymentCount: 0,
                    totalRevenue: 0, revenueThisMonth: 0, revenueLastMonth: 0, revenueChangePercent: 0,
                },
            };
        }

        // Registration counts
        const [totalRegistrations, pendingPaymentCount] = await this.prisma.$transaction([
            this.prisma.registration.count({ where: { tournamentId: { in: tournamentIds } } }),
            this.prisma.registration.count({ where: { tournamentId: { in: tournamentIds }, status: 'PENDING_PAYMENT' } }),
        ]);

        // Revenue — sum of payments with status PAID, scoped to organizer's tournaments
        const totalRevenueResult = await this.prisma.payment.aggregate({
            _sum: { amountPaise: true },
            where: { status: 'PAID', registration: { tournamentId: { in: tournamentIds } } },
        });
        const totalRevenue = totalRevenueResult._sum.amountPaise ?? 0;

        const revenueThisMonthResult = await this.prisma.payment.aggregate({
            _sum: { amountPaise: true },
            where: {
                status: 'PAID',
                registration: { tournamentId: { in: tournamentIds } },
                createdAt: { gte: startOfMonth },
            },
        });
        const revenueThisMonth = revenueThisMonthResult._sum.amountPaise ?? 0;

        const revenueLastMonthResult = await this.prisma.payment.aggregate({
            _sum: { amountPaise: true },
            where: {
                status: 'PAID',
                registration: { tournamentId: { in: tournamentIds } },
                createdAt: { gte: startOfLastMonth, lt: startOfMonth },
            },
        });
        const revenueLastMonth = revenueLastMonthResult._sum.amountPaise ?? 0;

        const revenueChangePercent = revenueLastMonth > 0
            ? Math.round(((revenueThisMonth - revenueLastMonth) / revenueLastMonth) * 100)
            : 0;

        return {
            data: {
                totalTournaments, activeTournaments, pendingApprovalCount, createdThisMonth,
                totalRegistrations, pendingPaymentCount,
                totalRevenue, revenueThisMonth, revenueLastMonth, revenueChangePercent,
            },
        };
    }

    async dashboardRecentRegistrations(organizerId: string, limit: number) {
        const take = Math.min(10, Math.max(1, limit));

        const registrations = await this.prisma.registration.findMany({
            where: {
                tournament: { organizerId },
                status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] },
            },
            orderBy: { registeredAt: 'desc' },
            take,
            include: {
                tournament: { select: { id: true, title: true } },
            },
        });

        const now = new Date();
        return {
            data: {
                registrations: registrations.map(r => {
                    const nameParts = r.playerName.trim().split(/\s+/);
                    const initials = nameParts.length >= 2
                        ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
                        : r.playerName.slice(0, 2).toUpperCase();

                    const diffMs = now.getTime() - new Date(r.registeredAt).getTime();
                    const diffMins = Math.floor(diffMs / 60000);
                    const diffHours = Math.floor(diffMs / 3600000);
                    const diffDays = Math.floor(diffMs / 86400000);
                    let timeAgo: string;
                    if (diffMins < 60) timeAgo = `${diffMins} min ago`;
                    else if (diffHours < 24) timeAgo = `${diffHours} hr${diffHours > 1 ? 's' : ''} ago`;
                    else if (diffDays === 1) timeAgo = 'Yesterday';
                    else timeAgo = `${diffDays} days ago`;

                    return {
                        id: r.id,
                        playerName: r.playerName,
                        playerInitials: initials,
                        tournamentName: r.tournament.title,
                        tournamentId: r.tournament.id,
                        paymentStatus: r.status,
                        registeredAt: r.registeredAt,
                        timeAgo,
                    };
                }),
            },
        };
    }

    async dashboardUpcoming(organizerId: string, limit: number) {
        const take = Math.min(10, Math.max(1, limit));
        const now = new Date();

        const tournaments = await this.prisma.tournament.findMany({
            where: {
                organizerId,
                startDate: { gte: now },
                status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE'] },
            },
            orderBy: { startDate: 'asc' },
            take,
            include: {
                categories: { select: { maxSeats: true, registeredCount: true } },
            },
        });

        return {
            data: {
                tournaments: tournaments.map(t => {
                    const totalSeats = t.categories.reduce((s, c) => s + c.maxSeats, 0);
                    const confirmedRegistrations = t.categories.reduce((s, c) => s + c.registeredCount, 0);
                    const daysUntil = Math.ceil((new Date(t.startDate).getTime() - now.getTime()) / 86400000);
                    const needsAttention = t.status === 'PENDING_APPROVAL'
                        || (t.status === 'APPROVED' && new Date(t.registrationDeadline) < now && confirmedRegistrations === 0);

                    return {
                        id: t.id,
                        name: t.title,
                        startDate: t.startDate,
                        venue: t.venue,
                        totalSeats,
                        confirmedRegistrations,
                        daysUntil,
                        status: t.status,
                        needsAttention,
                    };
                }),
            },
        };
    }
}
