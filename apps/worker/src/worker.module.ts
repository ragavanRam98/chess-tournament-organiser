import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WorkerQueueModule } from './queue/worker-queue.module';
import { ProcessorsModule } from './processors/processors.module';

/**
 * S5-2: WorkerModule
 *
 * Root module for the background worker application.
 * Only runs as a NestJS ApplicationContext (no HTTP server).
 *
 * Responsibilities:
 * - Load environment config
 * - Connect to Redis via BullMQ
 * - Register all job processors
 * - Schedule recurring cron jobs (via DlqService.onModuleInit)
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
    WorkerQueueModule,
    ProcessorsModule,
  ],
})
export class WorkerModule {}
