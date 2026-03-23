import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import { ChessResultsParser } from './chess-results.parser';

/**
 * Chess-Results.com sync processor.
 *
 * Handles SYNC_CHESS_RESULTS jobs:
 * - Fetches player list, pairings, standings, and cross table
 * - Upserts data into chess_results_* tables
 * - Runs on a 15-minute cron schedule for ACTIVE/SYNCING links
 */
@Processor(QUEUE_NAMES.CHESS_RESULTS)
export class ChessResultsSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(ChessResultsSyncProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: ChessResultsParser,
  ) {
    super();
  }

  async process(job: Job): Promise<any> {
    switch (job.name) {
      case JOB_NAMES.SYNC_CHESS_RESULTS:
        return this.syncAllLinks();
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
        return { handled: false };
    }
  }

  // ── Main sync loop ──────────────────────────────────────────────────────

  private async syncAllLinks(): Promise<{ synced: number; errors: number }> {
    const links = await this.prisma.chessResultsLink.findMany({
      where: {
        syncStatus: { in: ['PENDING', 'SYNCING', 'ACTIVE'] },
      },
    });

    this.logger.log(`Found ${links.length} chess-results link(s) to sync`);

    let synced = 0;
    let errors = 0;

    for (const link of links) {
      try {
        await this.syncSingleLink(link);
        synced++;
      } catch (err) {
        errors++;
        const msg = (err as Error).message;
        this.logger.error(
          `Failed to sync link ${link.id} (tnr${link.chessResultsTnrId}): ${msg}`,
        );
        await this.prisma.chessResultsLink.update({
          where: { id: link.id },
          data: {
            syncStatus: 'ERROR',
            syncError: msg.slice(0, 1000),
          },
        });
      }
    }

    this.logger.log(
      `Chess-results sync complete: ${synced} synced, ${errors} error(s)`,
    );
    return { synced, errors };
  }

  // ── Sync a single link ──────────────────────────────────────────────────

  private async syncSingleLink(link: {
    id: string;
    chessResultsServer: string;
    chessResultsTnrId: string;
    totalRounds: number | null;
    lastSyncedRound: number | null;
  }): Promise<void> {
    const { id, chessResultsServer: server, chessResultsTnrId: tnrId } = link;

    this.logger.log(`Syncing link ${id} — tnr${tnrId} on ${server}`);

    // Mark as SYNCING
    await this.prisma.chessResultsLink.update({
      where: { id },
      data: { syncStatus: 'SYNCING', syncError: null },
    });

    // 1. Detect total rounds if not yet known
    let totalRounds = link.totalRounds;
    if (!totalRounds) {
      totalRounds = await this.parser.detectTotalRounds(server, tnrId);
      await this.prisma.chessResultsLink.update({
        where: { id },
        data: { totalRounds },
      });
    }

    // 2. Sync player list
    const players = await this.parser.parsePlayerList(server, tnrId);
    for (const player of players) {
      await this.prisma.chessResultsPlayer.upsert({
        where: {
          uq_cr_player_link_start: {
            linkId: id,
            startNumber: player.startNumber,
          },
        },
        create: {
          linkId: id,
          startNumber: player.startNumber,
          name: player.name,
          fideId: player.fideId,
          rating: player.rating,
          federation: player.federation,
          club: player.club,
          sex: player.sex,
        },
        update: {
          name: player.name,
          fideId: player.fideId,
          rating: player.rating,
          federation: player.federation,
          club: player.club,
          sex: player.sex,
        },
      });
    }

    // 3. Sync rounds — only fetch rounds that may have new data
    const startRound = Math.max(1, (link.lastSyncedRound ?? 0));
    let latestSyncedRound = link.lastSyncedRound ?? 0;

    for (let rd = startRound; rd <= totalRounds; rd++) {
      try {
        const pairings = await this.parser.parsePairings(server, tnrId, rd);
        const standings = await this.parser.parseStandings(server, tnrId, rd);

        // Skip if no data for this round yet
        if (pairings.length === 0 && standings.length === 0) {
          this.logger.log(
            `Round ${rd} has no data yet — stopping round sync`,
          );
          break;
        }

        // Determine if round is final (all results have a decisive/draw result)
        const isFinal =
          pairings.length > 0 &&
          pairings.every(
            (p) =>
              p.result.includes('1') ||
              p.result.includes('0') ||
              p.result.includes('½') ||
              p.result.includes('-'),
          );

        await this.prisma.chessResultsRound.upsert({
          where: {
            uq_cr_round_link_number: {
              linkId: id,
              roundNumber: rd,
            },
          },
          create: {
            linkId: id,
            roundNumber: rd,
            pairings: pairings as any,
            standings: standings as any,
            isFinal,
            fetchedAt: new Date(),
          },
          update: {
            pairings: pairings as any,
            standings: standings as any,
            isFinal,
            fetchedAt: new Date(),
          },
        });

        if (isFinal) {
          latestSyncedRound = rd;
        }
      } catch (err) {
        this.logger.warn(
          `Failed to parse round ${rd} for tnr${tnrId}: ${(err as Error).message}`,
        );
        break;
      }
    }

    // 4. If all rounds are final, fetch cross table
    const allRoundsFinal =
      latestSyncedRound >= totalRounds && totalRounds > 0;

    if (allRoundsFinal) {
      try {
        const crossTable = await this.parser.parseCrossTable(server, tnrId);
        if (crossTable.length > 0) {
          await this.prisma.chessResultsCrossTable.upsert({
            where: { linkId: id },
            create: {
              linkId: id,
              data: crossTable as any,
              fetchedAt: new Date(),
            },
            update: {
              data: crossTable as any,
              fetchedAt: new Date(),
            },
          });
        }
      } catch (err) {
        this.logger.warn(
          `Failed to parse cross table for tnr${tnrId}: ${(err as Error).message}`,
        );
      }
    }

    // 5. Update link status
    await this.prisma.chessResultsLink.update({
      where: { id },
      data: {
        syncStatus: allRoundsFinal ? 'COMPLETED' : 'ACTIVE',
        lastSyncedAt: new Date(),
        lastSyncedRound: latestSyncedRound || null,
        syncError: null,
      },
    });

    this.logger.log(
      `Synced tnr${tnrId}: ${players.length} players, rounds up to ${latestSyncedRound}/${totalRounds}${allRoundsFinal ? ' (COMPLETED)' : ''}`,
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(
      `[CHESS_RESULTS] Job ${job.id} (${job.name}) failed: ${err.message}`,
    );
  }
}
