import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from './queue.constants';

type QueueName = typeof QUEUE_NAMES[keyof typeof QUEUE_NAMES];

@Injectable()
export class QueueService {
    private readonly queues: Record<string, Queue>;

    constructor(
        @InjectQueue(QUEUE_NAMES.PAYMENTS) private paymentsQueue: Queue,
        @InjectQueue(QUEUE_NAMES.NOTIFICATIONS) private notificationsQueue: Queue,
        @InjectQueue(QUEUE_NAMES.EXPORTS) private exportsQueue: Queue,
        @InjectQueue(QUEUE_NAMES.CLEANUP) private cleanupQueue: Queue,
        @InjectQueue(QUEUE_NAMES.CHESS_RESULTS) private chessResultsQueue: Queue,
    ) {
        this.queues = {
            [QUEUE_NAMES.PAYMENTS]: paymentsQueue,
            [QUEUE_NAMES.NOTIFICATIONS]: notificationsQueue,
            [QUEUE_NAMES.EXPORTS]: exportsQueue,
            [QUEUE_NAMES.CLEANUP]: cleanupQueue,
            [QUEUE_NAMES.CHESS_RESULTS]: chessResultsQueue,
        };
    }

    async add<T>(queueName: QueueName, jobName: string, data: T, opts?: any) {
        const queue = this.queues[queueName];
        if (!queue) throw new Error(`Unknown queue: ${queueName}`);
        return queue.add(jobName, data, opts);
    }
}
