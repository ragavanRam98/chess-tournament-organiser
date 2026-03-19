// S5-6: Unit tests for PurgeExpiredProcessor
import { Test, TestingModule } from '@nestjs/testing';
import { PurgeExpiredProcessor } from './purge-expired.processor';
import { PrismaService } from '../prisma/prisma.service';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockPrisma = {
  registration: { findMany: jest.fn(), update: jest.fn() },
  category: { update: jest.fn() },
  $transaction: jest.fn(),
};

function makeJob(name = 'PURGE_EXPIRED_REGISTRATIONS') {
  return { id: 'job-1', name, data: {} } as any;
}

// ── Test Suite ─────────────────────────────────────────────────────────────────

describe('PurgeExpiredProcessor', () => {
  let processor: PurgeExpiredProcessor;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Restore sensible defaults after clearAllMocks wipes them
    mockPrisma.registration.update.mockResolvedValue({});
    mockPrisma.category.update.mockResolvedValue({});
    mockPrisma.$transaction.mockResolvedValue([{}, {}]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurgeExpiredProcessor,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    processor = module.get<PurgeExpiredProcessor>(PurgeExpiredProcessor);
  });

  // ── Wrong job name ─────────────────────────────────────────────────────────

  it('skips processing for unrecognised job name', async () => {
    const result = await processor.process(makeJob('SOME_OTHER_JOB'));

    expect(result.purged).toBe(0);
    expect(mockPrisma.registration.findMany).not.toHaveBeenCalled();
  });

  // ── Empty batch ────────────────────────────────────────────────────────────

  it('does nothing when no expired registrations exist', async () => {
    mockPrisma.registration.findMany.mockResolvedValue([]);

    const result = await processor.process(makeJob());

    expect(result.purged).toBe(0);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  // ── Seat release ───────────────────────────────────────────────────────────

  it('cancels each expired registration and atomically decrements registeredCount', async () => {
    const expiredRegs = [
      { id: 'reg-1', categoryId: 'cat-1', entryNumber: 'ECA-2025-000001' },
      { id: 'reg-2', categoryId: 'cat-1', entryNumber: 'ECA-2025-000002' },
    ];

    mockPrisma.registration.findMany.mockResolvedValue(expiredRegs);

    const result = await processor.process(makeJob());

    expect(result.purged).toBe(2);
    // One transaction per registration
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
    // Each call receives an array of two Prisma operations
    expect(mockPrisma.$transaction).toHaveBeenNthCalledWith(
      1,
      expect.arrayContaining([expect.anything(), expect.anything()]),
    );
  });

  // ── Partial failure resilience ─────────────────────────────────────────────

  it('continues processing remaining registrations if one transaction fails', async () => {
    const expiredRegs = [
      { id: 'reg-1', categoryId: 'cat-1', entryNumber: 'ECA-2025-000001' },
      { id: 'reg-2', categoryId: 'cat-2', entryNumber: 'ECA-2025-000002' },
    ];

    mockPrisma.registration.findMany.mockResolvedValue(expiredRegs);
    mockPrisma.$transaction
      .mockRejectedValueOnce(new Error('DB timeout')) // first fails
      .mockResolvedValueOnce([{}, {}]);               // second succeeds

    const result = await processor.process(makeJob());

    expect(result.purged).toBe(1);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
  });
});
