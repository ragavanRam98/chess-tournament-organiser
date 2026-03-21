// apps/api/src/fide/fide.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';

export interface FideLookupResult {
  fide_id: string;
  name: string;
  country: string;
  title: string | null;
  standard_rating: number | null;
  rapid_rating: number | null;
  blitz_rating: number | null;
  birth_year: number | null;
  last_updated: Date;
}

@Injectable()
export class FideService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  /**
   * Look up a single player by their FIDE ID.
   * Used by the registration form for live validation (GET /fide/lookup?fide_id=XXX).
   */
  async lookupById(fideId: string): Promise<{ data: FideLookupResult }> {
    const player = await this.prisma.fidePlayer.findUnique({
      where: { fideId },
    });
    if (!player) throw new NotFoundException('FIDE_ID_NOT_FOUND');

    return {
      data: {
        fide_id: player.fideId,
        name: player.name,
        country: player.country,
        title: player.title,
        standard_rating: player.standardRating,
        rapid_rating: player.rapidRating,
        blitz_rating: player.blitzRating,
        birth_year: player.birthYear,
        last_updated: player.lastUpdated,
      },
    };
  }

  /**
   * Admin-only: manually trigger an immediate FIDE sync outside the monthly schedule.
   * Useful after the monthly list is published but before the cron fires.
   */
  async triggerSync(): Promise<{ data: { job_id: string | undefined; message: string } }> {
    const job = await this.queue.add(QUEUE_NAMES.CLEANUP, JOB_NAMES.SYNC_FIDE_RATINGS, {}, {
      jobId: `manual-fide-sync-${Date.now()}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 60000 },
    });
    return { data: { job_id: job.id, message: 'FIDE sync job enqueued' } };
  }

  /** Returns basic sync status — when the DB was last updated and total player count. */
  async getSyncStatus(): Promise<{ data: { total_players: number; last_updated: Date | null; has_data: boolean } }> {
    const [count, latest] = await Promise.all([
      this.prisma.fidePlayer.count(),
      this.prisma.fidePlayer.findFirst({ orderBy: { lastUpdated: 'desc' }, select: { lastUpdated: true } }),
    ]);
    return {
      data: {
        total_players: count,
        last_updated: latest?.lastUpdated ?? null,
        has_data: count > 0,
      },
    };
  }
}
