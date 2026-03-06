import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { StorageService } from '../storage/storage.service';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';

@Injectable()
export class ReportsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly queue: QueueService,
        private readonly storage: StorageService,
    ) { }

    async triggerExport(tournamentId: string, organizerId: string, format: string) {
        const job = await this.prisma.exportJob.create({
            data: {
                tournamentId, organizerId, format: format.toUpperCase() as any, status: 'QUEUED',
                expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            },
        });
        await this.queue.add(QUEUE_NAMES.EXPORTS, JOB_NAMES.GENERATE_EXPORT, { exportJobId: job.id });
        return { data: { export_job_id: job.id, status: 'QUEUED', format, requested_at: job.requestedAt } };
    }

    async getExportStatus(jobId: string, organizerId: string) {
        const job = await this.prisma.exportJob.findFirst({ where: { id: jobId, organizerId } });
        if (!job) throw new NotFoundException('NOT_FOUND');
        const result: any = { data: { export_job_id: job.id, status: job.status, format: job.format } };
        if (job.status === 'DONE' && job.storageKey) {
            result.data.download_url = await this.storage.getSignedUrl(job.storageKey, 15 * 60);
            result.data.download_url_expires_at = new Date(Date.now() + 15 * 60 * 1000);
        }
        return result;
    }
}
