// apps/api/src/fide/fide.module.ts
import { Module } from '@nestjs/common';
import { FideController } from './fide.controller';
import { FideService } from './fide.service';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [PrismaModule, QueueModule],
  controllers: [FideController],
  providers: [FideService],
  exports: [FideService],  // exported for use in RegistrationsModule (Phase 2 — auto-validate on confirm)
})
export class FideModule {}
