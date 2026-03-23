import { Module } from '@nestjs/common';
import { PaymentReconcileProcessor } from './payment-reconcile.processor';
import { PurgeExpiredProcessor } from './purge-expired.processor';
import { SendEmailProcessor } from './send-email.processor';
import { ExportsProcessor } from './exports.processor';
import { FideSyncProcessor } from './fide-sync.processor';
import { ChessResultsSyncProcessor } from '../chess-results/chess-results-sync.processor';
import { ChessResultsParser } from '../chess-results/chess-results.parser';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { WorkerQueueModule } from '../queue/worker-queue.module';

@Module({
  imports: [PrismaModule, StorageModule, WorkerQueueModule],
  providers: [
    PaymentReconcileProcessor,
    PurgeExpiredProcessor,
    SendEmailProcessor,
    ExportsProcessor,
    FideSyncProcessor,
    ChessResultsParser,
    ChessResultsSyncProcessor,
  ],
})
export class ProcessorsModule {}
