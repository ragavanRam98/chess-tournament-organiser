import { Module } from '@nestjs/common';
import { PaymentReconcileProcessor } from './payment-reconcile.processor';
import { PurgeExpiredProcessor } from './purge-expired.processor';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [PaymentReconcileProcessor, PurgeExpiredProcessor],
})
export class ProcessorsModule {}
