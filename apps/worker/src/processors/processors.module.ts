import { Module } from '@nestjs/common';
import { PaymentReconcileProcessor } from './payment-reconcile.processor';
import { PurgeExpiredProcessor } from './purge-expired.processor';
import { SendEmailProcessor } from './send-email.processor';
import { ExportsProcessor } from './exports.processor';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [PrismaModule, StorageModule],
  providers: [
    PaymentReconcileProcessor,
    PurgeExpiredProcessor,
    SendEmailProcessor,
    ExportsProcessor,
  ],
})
export class ProcessorsModule {}
