import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import { TournamentsService } from '../tournaments/tournaments.service';
import { TournamentStatus } from '@prisma/client';

@Injectable()
export class AdminService {
    private readonly logger = new Logger(AdminService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly tournamentsService: TournamentsService,
        private readonly queue: QueueService,
    ) { }

    // ── Tournaments ────────────────────────────────────────────────────────────

    async listTournaments(query: unknown) {
        const q = query as Record<string, string> | undefined;
        const page = Math.max(1, parseInt(q?.['page'] ?? '1', 10));
        const limit = Math.min(50, Math.max(1, parseInt(q?.['limit'] ?? '20', 10)));
        const skip = (page - 1) * limit;
        const status = q?.['status'] as TournamentStatus | undefined;

        const where = status ? { status } : {};

        const [tournaments, total] = await this.prisma.$transaction([
            this.prisma.tournament.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
                include: {
                    organizer: { select: { academyName: true, city: true } },
                    categories: { select: { id: true, name: true, maxSeats: true } },
                },
            }),
            this.prisma.tournament.count({ where }),
        ]);

        return { data: tournaments, meta: { total, page, limit } };
    }

    async updateTournamentStatus(id: string, body: unknown, actingUserId: string) {
        const b = body as { status: string; reason?: string };
        return this.tournamentsService.applyStatusTransition(
            id,
            b.status as TournamentStatus,
            actingUserId,
            b.reason,
        );
    }

    // ── Organizers ─────────────────────────────────────────────────────────────

    async listOrganizers(query: unknown) {
        const q = query as Record<string, string> | undefined;
        const page = Math.max(1, parseInt(q?.['page'] ?? '1', 10));
        const limit = Math.min(50, Math.max(1, parseInt(q?.['limit'] ?? '20', 10)));
        const skip = (page - 1) * limit;

        const [organizers, total] = await this.prisma.$transaction([
            this.prisma.organizer.findMany({
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
                include: {
                    user: { select: { email: true, status: true, createdAt: true } },
                },
            }),
            this.prisma.organizer.count(),
        ]);

        return { data: organizers, meta: { total, page, limit } };
    }

    async verifyOrganizer(id: string, adminUserId: string) {
        const organizer = await this.prisma.organizer.findUnique({
            where: { id },
            include: { user: true },
        });
        if (!organizer) throw new NotFoundException('NOT_FOUND');
        if (organizer.user.status === 'ACTIVE') {
            throw new ConflictException('Organizer is already verified');
        }

        await this.prisma.$transaction([
            this.prisma.user.update({
                where: { id: organizer.userId },
                data: { status: 'ACTIVE' },
            }),
            this.prisma.organizer.update({
                where: { id },
                data: { verifiedAt: new Date(), verifiedById: adminUserId },
            }),
            this.prisma.auditLog.create({
                data: {
                    entityType: 'organizer',
                    entityId: id,
                    action: 'VERIFIED',
                    oldValue: { status: organizer.user.status } as any,
                    newValue: { status: 'ACTIVE' } as any,
                    performedById: adminUserId,
                },
            }),
        ]);

        return { data: { id, status: 'ACTIVE' } };
    }

    // ── Analytics ──────────────────────────────────────────────────────────────

    async analytics() {
        const [
            totalTournaments,
            activeTournaments,
            pendingApproval,
            totalOrganizers,
            pendingOrganizers,
            totalRegistrations,
            confirmedRegistrations,
            revenueResult,
            topCategories,
        ] = await this.prisma.$transaction([
            this.prisma.tournament.count(),
            this.prisma.tournament.count({ where: { status: 'ACTIVE' } }),
            this.prisma.tournament.count({ where: { status: 'PENDING_APPROVAL' } }),
            this.prisma.organizer.count(),
            this.prisma.user.count({ where: { role: 'ORGANIZER', status: 'PENDING_VERIFICATION' } }),
            this.prisma.registration.count(),
            this.prisma.registration.count({ where: { status: 'CONFIRMED' } }),
            this.prisma.payment.aggregate({ _sum: { amountPaise: true }, where: { status: 'PAID' } }),
            this.prisma.category.findMany({
                select: { name: true, registeredCount: true, tournament: { select: { title: true } } },
                orderBy: { registeredCount: 'desc' },
                take: 5,
            }),
        ]);

        return {
            data: {
                tournaments: { total: totalTournaments, active: activeTournaments, pending_approval: pendingApproval },
                organizers: { total: totalOrganizers, pending_verification: pendingOrganizers },
                registrations: { total: totalRegistrations, confirmed: confirmedRegistrations },
                revenue_paise: revenueResult._sum.amountPaise ?? 0,
                top_categories: topCategories.map(c => ({
                    name: c.name,
                    tournament: c.tournament?.title,
                    registered_count: c.registeredCount,
                })),
            },
        };
    }

    // ── Manual Refund ─────────────────────────────────────────────────────

    async refundRegistration(registrationId: string, adminUserId: string) {
        const registration = await this.prisma.registration.findUnique({
            where: { id: registrationId },
            include: {
                payment: { select: { status: true } },
                tournament: { select: { title: true } },
            },
        });

        if (!registration) throw new NotFoundException('Registration not found');
        if (registration.status !== 'CONFIRMED') {
            throw new ConflictException('Only CONFIRMED registrations can be refunded');
        }
        if (!registration.payment || registration.payment.status !== 'PAID') {
            throw new ConflictException('No paid payment found for this registration');
        }

        // Queue the refund job (async — processed by worker)
        await this.queue.add(QUEUE_NAMES.PAYMENTS, JOB_NAMES.PROCESS_REFUND, {
            registrationId,
        }, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } });

        // Audit log
        await this.prisma.auditLog.create({
            data: {
                entityType: 'registration',
                entityId: registrationId,
                action: 'REFUNDED',
                oldValue: { status: registration.status } as any,
                newValue: { status: 'REFUND_QUEUED' } as any,
                performedById: adminUserId,
            },
        });

        this.logger.log(`[REFUND] Admin ${adminUserId} queued manual refund for registration ${registrationId}`);
        return { data: { registrationId, status: 'REFUND_QUEUED' } };
    }

    // ── Audit Logs ─────────────────────────────────────────────────────────────

    async auditLogs(query: unknown) {
        const q = query as Record<string, string> | undefined;
        const limit = Math.min(100, Math.max(1, parseInt(q?.['limit'] ?? '50', 10)));
        const cursor = q?.['cursor']; // cursor-based pagination using audit log id

        // Build where clause with optional filters
        const where: Record<string, any> = {};
        if (q?.['entityType']) where.entityType = q['entityType'];
        if (q?.['performedBy']) where.performedById = q['performedBy'];
        if (q?.['from'] || q?.['to']) {
            where.performedAt = {};
            if (q?.['from']) where.performedAt.gte = new Date(q['from']);
            if (q?.['to']) where.performedAt.lte = new Date(q['to']);
        }

        const logs = await this.prisma.auditLog.findMany({
            where,
            orderBy: { performedAt: 'desc' },
            take: limit + 1, // fetch one extra to know if there's a next page
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            include: {
                performedBy: { select: { email: true, role: true } },
            },
        });

        const hasNext = logs.length > limit;
        const items = hasNext ? logs.slice(0, limit) : logs;
        const nextCursor = hasNext ? items[items.length - 1].id : null;

        return {
            data: items,
            meta: { limit, next_cursor: nextCursor, has_next: hasNext },
        };
    }
}
