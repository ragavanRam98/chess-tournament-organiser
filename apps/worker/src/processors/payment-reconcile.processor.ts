import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import Razorpay from 'razorpay';

/**
 * Payments queue processor — handles all jobs on the PAYMENTS queue:
 *
 * PAYMENT_RECONCILE — Runs every 15 min. Finds stuck INITIATED/PENDING payments
 *   and polls Razorpay to resolve their final status.
 *
 * PROCESS_REFUND — Triggered when a tournament is cancelled or admin issues a
 *   manual refund. Calls Razorpay refund API, updates DB, queues notification.
 */
@Processor(QUEUE_NAMES.PAYMENTS)
export class PaymentReconcileProcessor extends WorkerHost {
  private readonly logger = new Logger(PaymentReconcileProcessor.name);
  private razorpay: Razorpay;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.NOTIFICATIONS) private readonly notificationsQueue: Queue,
  ) {
    super();
    if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
      this.razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
      });
    }
  }

  async process(job: Job): Promise<any> {
    switch (job.name) {
      case JOB_NAMES.PAYMENT_RECONCILE:
        return this.handleReconcile(job);
      case JOB_NAMES.PROCESS_REFUND:
        return this.handleRefund(job);
      default:
        this.logger.warn(`[PAYMENTS] Unknown job name: ${job.name}`);
        return;
    }
  }

  // ── PAYMENT_RECONCILE ───────────────────────────────────────────────────

  private async handleReconcile(job: Job): Promise<void> {
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

  // ── PROCESS_REFUND ───────────────────────────────────────────────────

  private async handleRefund(job: Job): Promise<{ refunded: boolean; refundId?: string }> {
    const { registrationId } = job.data;

    const payment = await this.prisma.payment.findUnique({
      where: { registrationId },
      include: {
        registration: {
          select: { status: true, entryNumber: true, tournamentId: true },
          include: { tournament: { select: { title: true } } },
        },
      },
    });

    if (!payment || payment.status !== 'PAID' || !payment.razorpayPaymentId) {
      this.logger.warn(`[REFUND] No refundable payment for registration ${registrationId}`);
      return { refunded: false };
    }

    if (!this.razorpay) {
      throw new Error('Razorpay not configured — cannot process refund');
    }

    const refund = await (this.razorpay.payments as any).refund(payment.razorpayPaymentId, {
      amount: payment.amountPaise,
    });

    await this.prisma.$transaction([
      this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'REFUNDED',
          gatewayResponse: {
            ...(payment.gatewayResponse as any ?? {}),
            refundId: refund.id,
          },
        },
      }),
      this.prisma.registration.update({
        where: { id: registrationId },
        data: { status: 'CANCELLED' },
      }),
    ]);

    // Queue refund confirmation email
    await this.notificationsQueue.add(JOB_NAMES.SEND_EMAIL, {
      registrationId,
      type: 'REFUND_PROCESSED',
      tournamentTitle: payment.registration.tournament.title,
    });

    this.logger.log(
      `[REFUND] Refunded ${payment.amountPaise} paise for ${payment.registration.entryNumber} (refund ID: ${refund.id})`,
    );
    return { refunded: true, refundId: refund.id };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`[PAYMENTS] Job ${job.id} (${job.name}) failed: ${err.message}`);
  }
}
