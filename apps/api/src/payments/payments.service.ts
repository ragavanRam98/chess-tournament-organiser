import {
    Injectable, BadRequestException, ConflictException, Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import { RazorpayService } from './razorpay/razorpay.service';

@Injectable()
export class PaymentsService {
    private readonly logger = new Logger(PaymentsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly queue: QueueService,
        private readonly razorpay: RazorpayService,
    ) { }

    async createOrder(registrationId: string, amountPaise: number) {
        const order = await this.razorpay.createOrder(amountPaise);
        await this.prisma.payment.create({
            data: { registrationId, razorpayOrderId: order.id, amountPaise, status: 'INITIATED' },
        });
        return { razorpay_order_id: order.id, razorpay_key_id: process.env.RAZORPAY_KEY_ID, amount_paise: amountPaise, currency: 'INR' };
    }

    async handleWebhook(rawBody: Buffer, signature: string, body: any): Promise<{ status: string }> {
        // Step 1 — HMAC-SHA256 verification (timing-safe)
        const expected = crypto
            .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET!)
            .update(rawBody)
            .digest('hex');

        if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature ?? ''))) {
            this.logger.warn('Webhook HMAC mismatch — rejecting');
            throw new BadRequestException('Invalid signature');
        }

        const event: string = body?.event;
        const paymentEntity = body?.payload?.payment?.entity;
        if (!paymentEntity) return { status: 'ignored' };

        const razorpayPaymentId: string = paymentEntity.id;
        const razorpayOrderId: string = paymentEntity.order_id;

        // Step 2 — Idempotency: reject reprocessing
        const existing = await this.prisma.payment.findUnique({ where: { razorpayOrderId } });
        if (!existing) { this.logger.warn(`Payment not found for order ${razorpayOrderId}`); return { status: 'ignored' }; }
        if (existing.razorpayPaymentId) {
            this.logger.log(`Duplicate webhook for payment ${razorpayPaymentId} — skipping`);
            return { status: 'ok' };
        }

        // Step 3 — State machine transition
        if (event === 'payment.captured') {
            await this.prisma.$transaction([
                this.prisma.payment.update({
                    where: { razorpayOrderId },
                    data: { status: 'PAID', razorpayPaymentId, gatewayResponse: paymentEntity },
                }),
                this.prisma.registration.update({
                    where: { id: existing.registrationId },
                    data: { status: 'CONFIRMED', confirmedAt: new Date() },
                }),
            ]);
            await this.queue.add(QUEUE_NAMES.NOTIFICATIONS, JOB_NAMES.SEND_EMAIL, {
                registrationId: existing.registrationId, type: 'REGISTRATION_CONFIRMED',
            });
        } else if (event === 'payment.failed') {
            await this.prisma.payment.update({
                where: { razorpayOrderId },
                data: { status: 'FAILED', gatewayResponse: paymentEntity },
            });
        }

        return { status: 'ok' };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
