import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';

@Injectable()
export class ChessResultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  // ── Parse URL into server + tnrId ──────────────────────────────────────

  parseChessResultsUrl(url: string): { server: string; tnrId: string } {
    // Supported formats:
    //   https://chess-results.com/tnr1313755.aspx?...
    //   https://s3.chess-results.com/tnr1313755.aspx?...
    const match = url.match(
      /https?:\/\/(?:(\w+)\.)?chess-results\.com\/tnr(\d+)/i,
    );
    if (!match) {
      throw new BadRequestException(
        'Invalid chess-results.com URL. Expected format: https://chess-results.com/tnr<ID>.aspx or https://<server>.chess-results.com/tnr<ID>.aspx',
      );
    }
    return {
      server: match[1] || 'chess-results', // default to main if no subdomain
      tnrId: match[2],
    };
  }

  // ── Link a chess-results URL to a tournament/category ──────────────────

  async createLink(data: {
    tournamentId: string;
    categoryId?: string;
    chessResultsUrl: string;
  }) {
    const { server, tnrId } = this.parseChessResultsUrl(data.chessResultsUrl);

    // Verify tournament exists
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: data.tournamentId },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');

    // Verify category if provided
    if (data.categoryId) {
      const category = await this.prisma.category.findUnique({
        where: { id: data.categoryId },
      });
      if (!category || category.tournamentId !== data.tournamentId) {
        throw new BadRequestException('Category not found in this tournament');
      }
    }

    // Find existing link or create new one
    const existing = await this.prisma.chessResultsLink.findFirst({
      where: {
        tournamentId: data.tournamentId,
        categoryId: data.categoryId ?? null,
      },
    });

    let link;
    if (existing) {
      link = await this.prisma.chessResultsLink.update({
        where: { id: existing.id },
        data: {
          chessResultsServer: server,
          chessResultsTnrId: tnrId,
          chessResultsUrl: data.chessResultsUrl,
          syncStatus: 'PENDING',
          syncError: null,
        },
      });
    } else {
      link = await this.prisma.chessResultsLink.create({
        data: {
          tournamentId: data.tournamentId,
          categoryId: data.categoryId ?? undefined,
          chessResultsServer: server,
          chessResultsTnrId: tnrId,
          chessResultsUrl: data.chessResultsUrl,
          syncStatus: 'PENDING',
        },
      });
    }

    // Trigger an immediate sync
    await this.queue.add(
      QUEUE_NAMES.CHESS_RESULTS,
      JOB_NAMES.SYNC_CHESS_RESULTS,
      { linkId: link.id },
    );

    return link;
  }

  // ── Remove a link ──────────────────────────────────────────────────────

  async removeLink(linkId: string) {
    const link = await this.prisma.chessResultsLink.findUnique({
      where: { id: linkId },
    });
    if (!link) throw new NotFoundException('Chess-results link not found');

    await this.prisma.chessResultsLink.update({
      where: { id: linkId },
      data: { syncStatus: 'DISABLED' },
    });

    return { success: true };
  }

  // ── Get links for a tournament ─────────────────────────────────────────

  async getLinks(tournamentId: string) {
    return this.prisma.chessResultsLink.findMany({
      where: { tournamentId },
      include: {
        category: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ── Public: Get live data for a tournament ─────────────────────────────

  async getLiveData(tournamentId: string) {
    const links = await this.prisma.chessResultsLink.findMany({
      where: {
        tournamentId,
        syncStatus: { in: ['ACTIVE', 'SYNCING', 'COMPLETED'] },
      },
      include: {
        category: { select: { id: true, name: true } },
        players: {
          orderBy: { startNumber: 'asc' },
        },
        rounds: {
          orderBy: { roundNumber: 'asc' },
        },
        crossTable: true,
      },
    });

    if (links.length === 0) return null;

    return links.map((link) => ({
      id: link.id,
      category: link.category,
      chessResultsUrl: link.chessResultsUrl,
      totalRounds: link.totalRounds,
      lastSyncedAt: link.lastSyncedAt,
      lastSyncedRound: link.lastSyncedRound,
      syncStatus: link.syncStatus,
      players: link.players,
      rounds: link.rounds.map((r) => ({
        roundNumber: r.roundNumber,
        pairings: r.pairings,
        standings: r.standings,
        isFinal: r.isFinal,
      })),
      crossTable: link.crossTable?.data ?? null,
    }));
  }

  // ── Trigger manual sync ────────────────────────────────────────────────

  async triggerSync(linkId: string) {
    const link = await this.prisma.chessResultsLink.findUnique({
      where: { id: linkId },
    });
    if (!link) throw new NotFoundException('Chess-results link not found');

    await this.prisma.chessResultsLink.update({
      where: { id: linkId },
      data: { syncStatus: 'PENDING', syncError: null },
    });

    await this.queue.add(
      QUEUE_NAMES.CHESS_RESULTS,
      JOB_NAMES.SYNC_CHESS_RESULTS,
      { linkId },
    );

    return { success: true, message: 'Sync triggered' };
  }
}
