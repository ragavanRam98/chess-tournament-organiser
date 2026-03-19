import {
  Module, Injectable, OnModuleInit, Logger,
} from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from './queue.constants';

// S5-5: DLQ monitoring service — logs failed job counts on startup
@Injectable()
export class DlqService implements OnModuleInit {
  private readonly logger = new Logger(DlqService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.PAYMENTS) private paymentsQueue: Queue,
    @InjectQueue(QUEUE_NAMES.NOTIFICATIONS) private notificationsQueue: Queue,
    @InjectQueue(QUEUE_NAMES.EXPORTS) private exportsQueue: Queue,
    @InjectQueue(QUEUE_NAMES.CLEANUP) private cleanupQueue: Queue,
  ) {}

  async onModuleInit() {
    // Schedule repeatable cron jobs (idempotent — BullMQ deduplicates by key)
    await this.paymentsQueue.add(
      JOB_NAMES.PAYMENT_RECONCILE,
      {},
      {
        repeat: { pattern: '*/15 * * * *' }, // every 15 minutes
        jobId: 'cron:payment-reconcile',
        removeOnFail: false, // S5-5: retain failed jobs for DLQ visibility
        removeOnComplete: true,
      },
    );

    await this.cleanupQueue.add(
      JOB_NAMES.PURGE_EXPIRED_REGISTRATIONS,
      {},
      {
        repeat: { pattern: '*/15 * * * *' },
        jobId: 'cron:purge-expired',
        removeOnFail: false,
        removeOnComplete: true,
      },
    );

    // S6-4: CLEANUP_EXPORT_FILES — daily at 2 AM IST (20:30 UTC previous day)
    await this.exportsQueue.add(
      JOB_NAMES.CLEANUP_EXPORT_FILES,
      {},
      {
        repeat: { pattern: '30 20 * * *' }, // 20:30 UTC = 2:00 AM IST
        jobId: 'cron:cleanup-exports',
        removeOnFail: false,
        removeOnComplete: true,
      },
    );

    // S5-5: Log DLQ depth for each queue on startup
    const queues = [
      { name: QUEUE_NAMES.PAYMENTS, q: this.paymentsQueue },
      { name: QUEUE_NAMES.NOTIFICATIONS, q: this.notificationsQueue },
      { name: QUEUE_NAMES.EXPORTS, q: this.exportsQueue },
      { name: QUEUE_NAMES.CLEANUP, q: this.cleanupQueue },
    ];

    for (const { name, q } of queues) {
      const failedCount = await q.getFailedCount();
      if (failedCount > 0) {
        this.logger.warn(`[DLQ] Queue "${name}" has ${failedCount} failed job(s) — investigate immediately`);
      } else {
        this.logger.log(`[DLQ] Queue "${name}" — 0 failed jobs ✓`);
      }
    }
  }
}

@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6379' },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnFail: false, // S5-5: always keep failed jobs
        },
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUE_NAMES.PAYMENTS },
      { name: QUEUE_NAMES.NOTIFICATIONS },
      { name: QUEUE_NAMES.EXPORTS },
      { name: QUEUE_NAMES.CLEANUP },
    ),
  ],
  providers: [DlqService],
  exports: [BullModule, DlqService],
})
export class WorkerQueueModule {}
