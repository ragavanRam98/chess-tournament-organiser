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

  // ── Verify the URL actually exists on chess-results.com ─────────────────

  private async verifyChessResultsUrl(server: string, tnrId: string): Promise<void> {
    const host = server === 'chess-results' ? 'chess-results.com' : `${server}.chess-results.com`;
    const url = `https://${host}/tnr${tnrId}.aspx?lan=1&art=0`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'User-Agent': 'ChessTournamentOrganiser/1.0' },
        redirect: 'follow',
      });
      clearTimeout(timeout);

      if (!res.ok) {
        throw new BadRequestException(
          `Chess-results.com returned ${res.status}. Please check the tournament URL is correct.`,
        );
      }

      // chess-results.com returns 200 even for invalid IDs but shows
      // "no tournament" in the body — check for the title element
      const body = await res.text();
      if (
        body.includes('Keine Turnierdaten') ||
        body.includes('No tournament data') ||
        body.includes('Pas de donn') ||
        !body.includes('tnr' + tnrId)
      ) {
        throw new BadRequestException(
          'No tournament found at this URL. Please verify the chess-results.com link.',
        );
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(
        'Could not reach chess-results.com. Please check the URL and try again.',
      );
    }
  }

  // ── Link a chess-results URL to a tournament/category ──────────────────

  async createLink(data: {
    tournamentId: string;
    categoryId?: string;
    chessResultsUrl: string;
  }) {
    const { server, tnrId } = this.parseChessResultsUrl(data.chessResultsUrl);

    // Verify the URL is reachable on chess-results.com
    await this.verifyChessResultsUrl(server, tnrId);

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

    return { data: link };
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

    return { data: { success: true } };
  }

  // ── Get links for a tournament ─────────────────────────────────────────

  async getLinks(tournamentId: string) {
    const links = await this.prisma.chessResultsLink.findMany({
      where: { tournamentId },
      include: {
        category: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return { data: links };
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

    if (links.length === 0) return { data: null };

    return { data: links.map((link) => ({
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
    })) };
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

    return { data: { success: true, message: 'Sync triggered' } };
  }
}
