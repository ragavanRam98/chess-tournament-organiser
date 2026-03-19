import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';

/**
 * S5-4: PURGE_EXPIRED_REGISTRATIONS processor
 *
 * Runs every 15 minutes (scheduled by DlqService on startup).
 * Cancels PENDING_PAYMENT registrations whose `expiresAt` has passed,
 * and atomically releases the held seat by decrementing `registeredCount`.
 *
 * Each registration is processed in its own transaction to limit blast radius
 * if one fails — the rest still complete successfully.
 */
@Processor(QUEUE_NAMES.CLEANUP)
export class PurgeExpiredProcessor extends WorkerHost {
  private readonly logger = new Logger(PurgeExpiredProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job): Promise<{ purged: number }> {
    if (job.name !== JOB_NAMES.PURGE_EXPIRED_REGISTRATIONS) {
      return { purged: 0 };
    }

    const now = new Date();

    const expired = await this.prisma.registration.findMany({
      where: {
        status: 'PENDING_PAYMENT',
        expiresAt: { lt: now },
      },
      select: { id: true, categoryId: true, entryNumber: true },
    });

    this.logger.log(`[PURGE_EXPIRED] Found ${expired.length} expired registration(s) to cancel`);

    let purged = 0;

    for (const reg of expired) {
      try {
        await this.prisma.$transaction([
          // Cancel the registration
          this.prisma.registration.update({
            where: { id: reg.id },
            data: { status: 'CANCELLED' },
          }),
          // Release the seat atomically
          this.prisma.category.update({
            where: { id: reg.categoryId },
            data: { registeredCount: { decrement: 1 } },
          }),
        ]);
        purged++;
        this.logger.log(`[PURGE_EXPIRED] Cancelled registration ${reg.entryNumber} — seat released`);
      } catch (err) {
        this.logger.error(`[PURGE_EXPIRED] Failed to cancel registration ${reg.id}`, err);
      }
    }

    this.logger.log(`[PURGE_EXPIRED] Done — ${purged}/${expired.length} registrations cancelled`);
    return { purged };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`[PURGE_EXPIRED] Job ${job.id} failed: ${err.message}`);
  }
}
