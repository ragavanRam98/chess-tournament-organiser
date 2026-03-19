// S5-7: Integration test — Full payment flow
// register → PENDING_PAYMENT → webhook payment.captured → CONFIRMED
//
// Uses NestJS Testing module with mocked Prisma + mocked Razorpay SDK.
// NO real DB or Redis required.

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as crypto from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RazorpayService } from '../src/payments/razorpay/razorpay.service';
import { QueueService } from '../src/queue/queue.service';

// ── Shared test fixtures ───────────────────────────────────────────────────────

const WEBHOOK_SECRET = 'test-webhook-secret-integration';
const TOURNAMENT_ID = 'tourney-int-1';
const CATEGORY_ID = 'cat-int-1';
const REGISTRATION_ID = 'reg-int-1';
const RAZORPAY_ORDER_ID = 'order_int_001';
const RAZORPAY_PAYMENT_ID = 'pay_int_001';

const mockCategory = {
  id: CATEGORY_ID,
  minAge: 5,
  maxAge: 99,
  entryFeePaise: 50000,
  maxSeats: 100,
  registeredCount: 0,
};

const mockTournament = {
  id: TOURNAMENT_ID,
  status: 'APPROVED',
  startDate: new Date('2030-01-01'),
  categories: [mockCategory],
};

const mockRegistration = {
  id: REGISTRATION_ID,
  entryNumber: 'ECA-2030-000001',
  categoryId: CATEGORY_ID,
  status: 'PENDING_PAYMENT',
  expiresAt: new Date(Date.now() + 7200000),
  confirmedAt: null,
};

// Payment record when queried by razorpayOrderId
const mockPaymentRecord = {
  id: 'payment-int-1',
  registrationId: REGISTRATION_ID,
  razorpayOrderId: RAZORPAY_ORDER_ID,
  razorpayPaymentId: null, // not yet captured
  amountPaise: 50000,
  status: 'INITIATED',
};

// ── Mock services ──────────────────────────────────────────────────────────────

const mockPrisma = {
  tournament: { findUnique: jest.fn().mockResolvedValue(mockTournament) },
  registration: {
    findFirst: jest.fn().mockResolvedValue(null),
    findUnique: jest.fn(),
    create: jest.fn().mockResolvedValue(mockRegistration),
    update: jest.fn().mockResolvedValue({ ...mockRegistration, status: 'CONFIRMED', confirmedAt: new Date() }),
  },
  category: { update: jest.fn().mockResolvedValue(mockCategory) },
  payment: {
    create: jest.fn().mockResolvedValue(mockPaymentRecord),
    findUnique: jest.fn(),
    update: jest.fn().mockResolvedValue({ ...mockPaymentRecord, status: 'PAID' }),
  },
  $transaction: jest.fn().mockImplementation(async (args: any) => {
    if (typeof args === 'function') {
      return args({
        $queryRaw: jest.fn()
          .mockResolvedValueOnce([{ registered_count: 5, max_seats: 100 }])
          .mockResolvedValueOnce([{ nextval: BigInt(1) }]),
        registration: { create: jest.fn().mockResolvedValue(mockRegistration) },
        category: { update: jest.fn() },
      });
    }
    // Array form (webhook state machine)
    return [
      { ...mockPaymentRecord, status: 'PAID', razorpayPaymentId: RAZORPAY_PAYMENT_ID },
      { ...mockRegistration, status: 'CONFIRMED', confirmedAt: new Date() },
    ];
  }),
};

const mockRazorpay = {
  createOrder: jest.fn().mockResolvedValue({ id: RAZORPAY_ORDER_ID }),
};

const mockQueue = { add: jest.fn().mockResolvedValue({}) };

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeWebhookSignature(rawBody: string): string {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
}

// ── Test Suite ─────────────────────────────────────────────────────────────────

describe('Payment Flow Integration (S5-7)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.JWT_ACCESS_SECRET = 'test-jwt-access-secret-32chars!!!';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .overrideProvider(RazorpayService)
      .useValue(mockRazorpay)
      .overrideProvider(QueueService)
      .useValue(mockQueue)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  // ── Step 1: Register ───────────────────────────────────────────────────────

  it('Step 1: POST /register returns 201 PENDING_PAYMENT with Razorpay order', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/tournaments/${TOURNAMENT_ID}/categories/${CATEGORY_ID}/register`)
      .send({
        playerName: 'Arjun Kumar',
        playerDob: '2010-06-01',
        phone: '+919876543210',
        email: 'arjun@test.com',
        city: 'Chennai',
      })
      .expect(201);

    expect(res.body.data.status).toBe('PENDING_PAYMENT');
    expect(res.body.data.payment.razorpay_order_id).toBe(RAZORPAY_ORDER_ID);
    expect(mockRazorpay.createOrder).toHaveBeenCalledWith(50000);
  });

  // ── Step 2: Simulate captured webhook ─────────────────────────────────────

  it('Step 2: POST /payments/webhook (payment.captured) returns 200 and confirms registration', async () => {
    // Wire up payment lookup to return an unprocessed payment record
    mockPrisma.payment.findUnique.mockResolvedValue(mockPaymentRecord);

    const body = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: { id: RAZORPAY_PAYMENT_ID, order_id: RAZORPAY_ORDER_ID },
        },
      },
    };
    const rawBody = JSON.stringify(body);
    const sig = makeWebhookSignature(rawBody);

    const res = await request(app.getHttpServer())
      .post('/api/v1/payments/webhook')
      .set('x-razorpay-signature', sig)
      .set('Content-Type', 'application/json')
      .send(rawBody)
      .expect(200);

    expect(res.body.status).toBe('ok');
    // Transaction called to update payment + registration
    expect(mockPrisma.$transaction).toHaveBeenCalled();
    // Email notification enqueued
    expect(mockQueue.add).toHaveBeenCalledWith(
      'notifications',
      'SEND_EMAIL',
      expect.objectContaining({ registrationId: REGISTRATION_ID }),
    );
  });

  // ── Step 3: Duplicate webhook idempotency ──────────────────────────────────

  it('Step 3: Duplicate webhook returns 200 without re-processing', async () => {
    // Payment already has razorpayPaymentId set → already captured
    mockPrisma.payment.findUnique.mockResolvedValue({
      ...mockPaymentRecord,
      razorpayPaymentId: RAZORPAY_PAYMENT_ID,
    });

    const body = {
      event: 'payment.captured',
      payload: { payment: { entity: { id: RAZORPAY_PAYMENT_ID, order_id: RAZORPAY_ORDER_ID } } },
    };
    const rawBody = JSON.stringify(body);
    const sig = makeWebhookSignature(rawBody);

    const res = await request(app.getHttpServer())
      .post('/api/v1/payments/webhook')
      .set('x-razorpay-signature', sig)
      .set('Content-Type', 'application/json')
      .send(rawBody)
      .expect(200);

    expect(res.body.status).toBe('ok');
    expect(mockPrisma.payment.update).not.toHaveBeenCalled();
  });
});
