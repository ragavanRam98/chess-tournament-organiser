import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { UpdateTournamentDto } from './dto/update-tournament.dto';

/** Valid forward transitions for tournament status machine */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
    DRAFT: ['PENDING_APPROVAL'],
    PENDING_APPROVAL: ['APPROVED', 'REJECTED'],
    APPROVED: ['ACTIVE', 'CANCELLED'],
    ACTIVE: ['CLOSED', 'CANCELLED'],
    CLOSED: [],
    REJECTED: [],
    CANCELLED: [],
};

@Injectable()
export class TournamentsService {
    constructor(private readonly prisma: PrismaService) { }

    async create(organizerId: string, dto: CreateTournamentDto) {
        // TODO: implement — INSERT tournament + categories in a transaction
        throw new Error('Not implemented');
    }

    async listByOrganizer(organizerId: string, query: any) {
        // TODO: implement — paginated list scoped to organizerId
        throw new Error('Not implemented');
    }

    async findOneForOrganizer(id: string, organizerId: string) {
        const t = await this.prisma.tournament.findFirst({ where: { id, organizerId }, include: { categories: true } });
        if (!t) throw new NotFoundException('NOT_FOUND');
        return { data: t };
    }

    async update(id: string, organizerId: string, dto: UpdateTournamentDto) {
        const t = await this.prisma.tournament.findFirst({ where: { id, organizerId } });
        if (!t) throw new NotFoundException('NOT_FOUND');
        if (t.status !== 'DRAFT') throw new ConflictException('Only DRAFT tournaments can be edited');
        // TODO: implement update
        throw new Error('Not implemented');
    }

    async listPublic(query: any) {
        // TODO: implement — public listing (APPROVED, ACTIVE only)
        throw new Error('Not implemented');
    }

    async findPublic(id: string) {
        const t = await this.prisma.tournament.findFirst({
            where: { id, status: { in: ['APPROVED', 'ACTIVE'] } },
            include: { categories: true, organizer: { select: { academyName: true } } },
        });
        if (!t) throw new NotFoundException('NOT_FOUND');
        return { data: t };
    }

    /** Called by AdminService — validates and applies status transition */
    async applyStatusTransition(id: string, newStatus: string, adminUserId: string, reason?: string) {
        const t = await this.prisma.tournament.findUnique({ where: { id } });
        if (!t) throw new NotFoundException('NOT_FOUND');
        if (!ALLOWED_TRANSITIONS[t.status]?.includes(newStatus)) {
            throw new ConflictException(`Transition ${t.status} → ${newStatus} not allowed`);
        }
        // TODO: implement — update + write audit_log + enqueue notification
        throw new Error('Not implemented');
    }
}

// ─────────────────────────────────────────────────────────────────────────────
