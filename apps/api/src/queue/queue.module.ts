import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueService } from './queue.service';
import { QUEUE_NAMES } from './queue.constants';

@Module({
    imports: [
        BullModule.forRootAsync({
            useFactory: () => ({ connection: { url: process.env.REDIS_URL } }),
        }),
        BullModule.registerQueue(
            { name: QUEUE_NAMES.PAYMENTS },
            { name: QUEUE_NAMES.NOTIFICATIONS },
            { name: QUEUE_NAMES.EXPORTS },
            { name: QUEUE_NAMES.CLEANUP },
            { name: QUEUE_NAMES.CHESS_RESULTS },
        ),
    ],
    providers: [QueueService],
    exports: [QueueService, BullModule],
})
export class QueueModule { }

// ─────────────────────────────────────────────────────────────────────────────
