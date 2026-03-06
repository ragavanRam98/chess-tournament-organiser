import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';

@Injectable()
export class AdminService {
    constructor(private readonly prisma: PrismaService, private readonly queue: QueueService) { }

    async listTournaments(query: any) { /* TODO: paginated, all statuses */ throw new Error('Not implemented'); }
    async updateTournamentStatus(id: string, body: any, actingUserId: string) { /* TODO: transition + audit_log + notify */ throw new Error('Not implemented'); }
    async listOrganizers(query: any) { /* TODO: paginated */ throw new Error('Not implemented'); }
    async verifyOrganizer(id: string, body: any) { /* TODO: PENDING_VERIFICATION → ACTIVE, set verified_at */ throw new Error('Not implemented'); }
    async analytics() { /* TODO: aggregate counts */ throw new Error('Not implemented'); }
    async auditLogs(query: any) { /* TODO: filterable, cursor-paginated */ throw new Error('Not implemented'); }
}
