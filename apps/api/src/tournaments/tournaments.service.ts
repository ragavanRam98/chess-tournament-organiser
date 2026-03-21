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
import { TournamentStatus } from '@prisma/client';

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

    async listRegistrationsForOrganizer(tournamentId: string, organizerId: string) {
        // Verify ownership
        const tournament = await this.prisma.tournament.findFirst({
            where: { id: tournamentId, organizerId },
            select: { id: true },
        });
        if (!tournament) throw new NotFoundException('NOT_FOUND');

        const registrations = await this.prisma.registration.findMany({
            where: { tournamentId },
            include: { category: { select: { name: true } } },
            orderBy: { registeredAt: 'desc' },
        });

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
                    action: newStatus as any,
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
}
