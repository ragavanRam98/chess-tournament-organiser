import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import Razorpay from 'razorpay';

/**
 * S5-3: PAYMENT_RECONCILE processor
 *
 * Runs every 15 minutes (scheduled by DlqService on startup).
 * Finds payments stuck in INITIATED/PENDING state for more than 15 minutes
 * and polls Razorpay to resolve their final status.
 *
 * State machine:
 *   captured  → payment PAID + registration CONFIRMED + notify
 *   failed    → payment FAILED (registration stays PENDING_PAYMENT for retry)
 */
@Processor(QUEUE_NAMES.PAYMENTS)
export class PaymentReconcileProcessor extends WorkerHost {
  private readonly logger = new Logger(PaymentReconcileProcessor.name);
  private razorpay: Razorpay;

  constructor(private readonly prisma: PrismaService) {
    super();
    if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
      this.razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
      });
    }
  }

  async process(job: Job): Promise<void> {
    if (job.name !== JOB_NAMES.PAYMENT_RECONCILE) return;

    const cutoff = new Date(Date.now() - 15 * 60 * 1000); // 15 minutes ago

    const stuckPayments = await this.prisma.payment.findMany({
      where: {
        status: { in: ['INITIATED', 'PENDING'] as any[] },
        createdAt: { lt: cutoff },
      },
      select: { id: true, razorpayOrderId: true, registrationId: true },
    });

    this.logger.log(`[PAYMENT_RECONCILE] Found ${stuckPayments.length} stuck payment(s) to reconcile`);

    for (const payment of stuckPayments) {
      if (!payment.razorpayOrderId) continue; // guard: no order to query
      try {
        if (!this.razorpay) {
          this.logger.warn('Razorpay not configured — skipping reconciliation');
          break;
        }

        // Fetch all payments for this order from Razorpay
        const rpOrder = await (this.razorpay.orders as any).fetchPayments(payment.razorpayOrderId);
        const rpPayments = rpOrder?.items ?? [];
        const captured = rpPayments.find((p: any) => p.status === 'captured');
        const failed = rpPayments.find((p: any) => p.status === 'failed');

        if (captured) {
          await this.prisma.$transaction([
            this.prisma.payment.update({
              where: { id: payment.id },
              data: { status: 'PAID', razorpayPaymentId: captured.id, gatewayResponse: captured },
            }),
            this.prisma.registration.update({
              where: { id: payment.registrationId },
              data: { status: 'CONFIRMED', confirmedAt: new Date() },
            }),
          ]);
          this.logger.log(`[PAYMENT_RECONCILE] Payment ${payment.id} reconciled → PAID (${captured.id})`);
        } else if (failed) {
          await this.prisma.payment.update({
            where: { id: payment.id },
            data: { status: 'FAILED', gatewayResponse: failed },
          });
          this.logger.log(`[PAYMENT_RECONCILE] Payment ${payment.id} reconciled → FAILED`);
        } else {
          this.logger.log(`[PAYMENT_RECONCILE] Payment ${payment.id} — still pending on Razorpay, skipping`);
        }
      } catch (err) {
        this.logger.error(`[PAYMENT_RECONCILE] Failed to reconcile payment ${payment.id}`, err);
      }
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`[PAYMENT_RECONCILE] Job ${job.id} failed: ${err.message}`);
  }
}
