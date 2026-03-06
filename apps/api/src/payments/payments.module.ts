import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { RazorpayService } from './razorpay/razorpay.service';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';

@Module({
    imports: [PrismaModule, QueueModule],
    controllers: [PaymentsController],
    providers: [PaymentsService, RazorpayService],
    exports: [PaymentsService, RazorpayService],
})
export class PaymentsModule { }

// ─────────────────────────────────────────────────────────────────────────────
