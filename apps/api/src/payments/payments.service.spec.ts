// S4-7: Unit tests for PaymentsService
import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { RazorpayService } from './razorpay/razorpay.service';
import { BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';

// ── Helpers ────────────────────────────────────────────────────────────────────

const WEBHOOK_SECRET = 'test-webhook-secret';

function makeSignature(rawBody: Buffer, secret = WEBHOOK_SECRET): string {
    return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

function makeWebhookBody(event: string, paymentId: string, orderId: string) {
    return {
        event,
        payload: {
            payment: {
                entity: { id: paymentId, order_id: orderId },
            },
        },
    };
}

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockPaymentRecord = {
    id: 'payment-uuid-1',
    registrationId: 'reg-uuid-1',
    razorpayOrderId: 'order_test_001',
    razorpayPaymentId: null, // not yet captured
};

const mockPrisma = {
    payment: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
    },
    registration: { update: jest.fn() },
    $transaction: jest.fn(),
};

const mockQueue = { add: jest.fn() };
const mockRazorpay = { createOrder: jest.fn(), fetchPayment: jest.fn() };

// ── Test Suite ─────────────────────────────────────────────────────────────────

describe('PaymentsService', () => {
    let service: PaymentsService;

    beforeEach(async () => {
        jest.clearAllMocks();
        process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PaymentsService,
                { provide: PrismaService, useValue: mockPrisma },
                { provide: QueueService, useValue: mockQueue },
                { provide: RazorpayService, useValue: mockRazorpay },
            ],
        }).compile();

        service = module.get<PaymentsService>(PaymentsService);
    });

    // ── handleWebhook — HMAC verification ─────────────────────────────────────

    describe('handleWebhook() — HMAC verification', () => {
        it('throws 400 BadRequestException for invalid HMAC signature', async () => {
            const rawBody = Buffer.from(JSON.stringify(makeWebhookBody('payment.captured', 'pay_1', 'order_1')));
            const invalidSig = 'invalid-signature-that-is-wrong';

            await expect(service.handleWebhook(rawBody, invalidSig, {})).rejects.toThrow(BadRequestException);
        });

        it('returns {status:ignored} when payment record not found for order', async () => {
            const body = makeWebhookBody('payment.captured', 'pay_2', 'order_unknown');
            const rawBody = Buffer.from(JSON.stringify(body));
            const sig = makeSignature(rawBody);

            mockPrisma.payment.findUnique.mockResolvedValue(null);

            const result = await service.handleWebhook(rawBody, sig, body);
            expect(result.status).toBe('ignored');
        });
    });

    // ── handleWebhook — idempotency ────────────────────────────────────────────

    describe('handleWebhook() — idempotency guard', () => {
        it('returns {status:ok} without re-processing duplicate webhook', async () => {
            const body = makeWebhookBody('payment.captured', 'pay_already', 'order_test_001');
            const rawBody = Buffer.from(JSON.stringify(body));
            const sig = makeSignature(rawBody);

            // razorpayPaymentId already set → already processed
            mockPrisma.payment.findUnique.mockResolvedValue({ ...mockPaymentRecord, razorpayPaymentId: 'pay_already' });

            const result = await service.handleWebhook(rawBody, sig, body);

            expect(result.status).toBe('ok');
            expect(mockPrisma.payment.update).not.toHaveBeenCalled();
            expect(mockPrisma.registration.update).not.toHaveBeenCalled();
        });
    });

    // ── handleWebhook — payment.captured ──────────────────────────────────────

    describe('handleWebhook() — payment.captured', () => {
        it('PAYS payment, CONFIRMs registration, enqueues notification', async () => {
            const body = makeWebhookBody('payment.captured', 'pay_new', 'order_test_001');
            const rawBody = Buffer.from(JSON.stringify(body));
            const sig = makeSignature(rawBody);

            mockPrisma.payment.findUnique.mockResolvedValue(mockPaymentRecord);
            mockPrisma.$transaction.mockResolvedValue([{}, {}]);

            const result = await service.handleWebhook(rawBody, sig, body);

            expect(result.status).toBe('ok');
            expect(mockPrisma.$transaction).toHaveBeenCalled();
            expect(mockQueue.add).toHaveBeenCalledWith(
                QUEUE_NAMES.NOTIFICATIONS,
                JOB_NAMES.SEND_EMAIL,
                expect.objectContaining({ registrationId: 'reg-uuid-1' }),
            );
        });
    });

    // ── handleWebhook — payment.failed ────────────────────────────────────────

    describe('handleWebhook() — payment.failed', () => {
        it('marks payment as FAILED without touching registration', async () => {
            const body = makeWebhookBody('payment.failed', 'pay_fail', 'order_test_001');
            const rawBody = Buffer.from(JSON.stringify(body));
            const sig = makeSignature(rawBody);

            mockPrisma.payment.findUnique.mockResolvedValue(mockPaymentRecord);
            mockPrisma.payment.update.mockResolvedValue({});

            const result = await service.handleWebhook(rawBody, sig, body);

            expect(result.status).toBe('ok');
            expect(mockPrisma.payment.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
            );
            expect(mockQueue.add).not.toHaveBeenCalled();
        });
    });
});
