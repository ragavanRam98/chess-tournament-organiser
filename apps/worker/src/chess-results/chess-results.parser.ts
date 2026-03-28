import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CRPlayer {
  startNumber: number;
  name: string;
  fideId: string | null;
  rating: number | null;
  federation: string | null;
  club: string | null;
  sex: string | null;
}

export interface CRPairing {
  board: number;
  whiteName: string;
  whiteRtg: number | null;
  result: string;
  blackName: string;
  blackRtg: number | null;
}

export interface CRStanding {
  rank: number;
  startNo: number;
  name: string;
  rating: number | null;
  points: number;
  tb1?: number | null;
  tb2?: number | null;
  tb3?: number | null;
  tb4?: number | null;
  tb5?: number | null;
  tb6?: number | null;
}

export interface CRCrossTableEntry {
  rank: number;
  startNo: number;
  name: string;
  rating: number | null;
  fed: string | null;
  rounds: { opponent: number | null; color: string; result: string }[];
  points: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
};

const RATE_LIMIT_MS = 1100; // 1 req/sec with margin

// ── Parser Service ───────────────────────────────────────────────────────────

@Injectable()
export class ChessResultsParser {
  private readonly logger = new Logger(ChessResultsParser.name);
  private lastRequestAt = 0;

  // ── Rate-limited fetch ──────────────────────────────────────────────────

  private async throttledFetch(url: string): Promise<string> {
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < RATE_LIMIT_MS) {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_MS - elapsed));
    }
    this.lastRequestAt = Date.now();

    const res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    const html = await res.text();

    // Handle the "Show tournament details" gate for older tournaments
    const $ = cheerio.load(html);
    const gateBtn = $('input[name="cb_alleDetails"]');
    if (gateBtn.length === 0) return html;

    const viewState = $('input[name="__VIEWSTATE"]').val() as string;
    const viewStateGen = $('input[name="__VIEWSTATEGENERATOR"]').val() as string;
    const eventValidation = $(
      'input[name="__EVENTVALIDATION"]',
    ).val() as string;
    const setCookie = res.headers.get('set-cookie') ?? '';
    const sessionCookie = setCookie.split(';')[0];

    const formData = new URLSearchParams();
    formData.set('__VIEWSTATE', viewState);
    if (viewStateGen) formData.set('__VIEWSTATEGENERATOR', viewStateGen);
    if (eventValidation) formData.set('__EVENTVALIDATION', eventValidation);
    formData.set('cb_alleDetails', 'Show tournament details');

    // Wait again for rate limit before the POST
    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
    this.lastRequestAt = Date.now();

    const postRes = await fetch(url, {
      method: 'POST',
      headers: {
        ...HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: url,
        Cookie: sessionCookie,
      },
      body: formData.toString(),
      redirect: 'follow',
    });

    if (!postRes.ok) throw new Error(`POST HTTP ${postRes.status}: ${url}`);
    return postRes.text();
  }

  // ── Build URL helpers ───────────────────────────────────────────────────

  private buildUrl(
    server: string,
    tnrId: string,
    art: number,
    extra = '',
  ): string {
    return `https://${server}.chess-results.com/tnr${tnrId}.aspx?lan=1&art=${art}${extra}`;
  }

  // ── Discover sub-tournaments ────────────────────────────────────────────

  async discoverSubTournaments(
    server: string,
    tnrId: string,
  ): Promise<{ name: string; tnrId: string }[]> {
    const url = this.buildUrl(server, tnrId, 0);
    const html = await this.throttledFetch(url);
    const $ = cheerio.load(html);

    const subs: { name: string; tnrId: string }[] = [];
    $('a[href*="tnr"]').each((_, el) => {
      const href = $(el).attr('href') ?? '';
      const text = $(el).text().trim();
      const match = href.match(/tnr(\d+)/);
      if (match && text.length > 0 && text.length < 50) {
        const id = match[1];
        if (id !== tnrId && !subs.some((s) => s.tnrId === id)) {
          subs.push({ name: text, tnrId: id });
        }
      }
    });

    this.logger.log(
      `Discovered ${subs.length} sub-tournament(s) for tnr${tnrId}`,
    );
    return subs;
  }

  // ── Parse player list (art=0) ───────────────────────────────────────────

  async parsePlayerList(
    server: string,
    tnrId: string,
  ): Promise<CRPlayer[]> {
    const url = this.buildUrl(server, tnrId, 0, '&zeilen=99999');
    const html = await this.throttledFetch(url);
    const $ = cheerio.load(html);

    const players: CRPlayer[] = [];
    const tables = $('table');

    tables.each((_, table) => {
      const rows = $(table).find('tr');
      if (rows.length < 3) return;

      const headers = rows
        .first()
        .find('th, td')
        .map((__, el) => $(el).text().trim().toLowerCase())
        .get();

      // Skip layout/wrapper tables where a header cell contains newlines
      // or is excessively long (chess-results wraps all content in a table)
      if (headers.some((h) => h.includes('\n') || h.length > 100)) return;

      // Identify player list table by headers
      const nameIdx = headers.findIndex(
        (h) => h === 'name' || h.includes('name'),
      );
      const snrIdx = headers.findIndex(
        (h) =>
          h === 'snr' ||
          h === 'no.' ||
          h === 'nr' ||
          h.includes('start') ||
          h === 'sno',
      );

      if (nameIdx === -1 || snrIdx === -1) return;

      const ratingIdx = headers.findIndex(
        (h) => h === 'rtg' || h.includes('rating') || h === 'elo',
      );
      const fideIdx = headers.findIndex(
        (h) => h.includes('fide') && h.includes('id'),
      );
      const fedIdx = headers.findIndex(
        (h) => h === 'fed' || h.includes('feder'),
      );
      const clubIdx = headers.findIndex(
        (h) => h === 'club' || h.includes('club'),
      );
      const sexIdx = headers.findIndex(
        (h) => h === 'sex' || h === 's' || h === 'g',
      );

      rows.slice(1).each((__, row) => {
        const cells = $(row)
          .find('td')
          .map((___, el) => $(el).text().trim())
          .get();

        const snr = parseInt(cells[snrIdx], 10);
        const name = cells[nameIdx];
        if (!snr || !name) return;

        players.push({
          startNumber: snr,
          name,
          fideId: fideIdx >= 0 ? cells[fideIdx] || null : null,
          rating:
            ratingIdx >= 0 ? parseInt(cells[ratingIdx], 10) || null : null,
          federation: fedIdx >= 0 ? cells[fedIdx] || null : null,
          club: clubIdx >= 0 ? cells[clubIdx] || null : null,
          sex: sexIdx >= 0 ? cells[sexIdx] || null : null,
        });
      });
    });

    this.logger.log(`Parsed ${players.length} player(s) for tnr${tnrId}`);
    return players;
  }

  // ── Parse pairings for a round (art=2) ──────────────────────────────────

  async parsePairings(
    server: string,
    tnrId: string,
    round: number,
  ): Promise<CRPairing[]> {
    const url = this.buildUrl(server, tnrId, 2, `&rd=${round}`);
    const html = await this.throttledFetch(url);
    const $ = cheerio.load(html);

    const pairings: CRPairing[] = [];
    const tables = $('table');

    tables.each((_, table) => {
      const rows = $(table).find('tr');
      if (rows.length < 2) return;

      const headers = rows
        .first()
        .find('th, td')
        .map((__, el) => $(el).text().trim().toLowerCase())
        .get();

      if (headers.some((h) => h.includes('\n') || h.length > 100)) return;

      // Identify pairing table: needs "bo." or "board" and "white" or similar
      const boardIdx = headers.findIndex(
        (h) =>
          h === 'bo.' || h === 'board' || h === 'bd' || h.includes('board'),
      );
      const hasResult = headers.some(
        (h) => h === 'result' || h === 'res.' || h.includes('result'),
      );

      if (boardIdx === -1 || !hasResult) return;

      rows.slice(1).each((__, row) => {
        const cells = $(row)
          .find('td')
          .map((___, el) => $(el).text().trim())
          .get();

        const board = parseInt(cells[boardIdx], 10);
        if (!board) return;

        // Chess-results pairings typically: Board, [No.], White, Rtg, Result, [No.], Black, Rtg
        // Positions vary — try to extract by matching patterns
        const resultIdx = headers.findIndex(
          (h) => h === 'result' || h === 'res.' || h.includes('result'),
        );

        const result = cells[resultIdx] ?? '';

        // White player is typically 2 cells before result (name, rating)
        // Black player is typically 2 cells after result
        let whiteName = '';
        let whiteRtg: number | null = null;
        let blackName = '';
        let blackRtg: number | null = null;

        // Find name columns by header
        const whiteNameIdx = headers.findIndex(
          (h, i) =>
            i > boardIdx &&
            i < resultIdx &&
            (h === 'name' || h.includes('white') || h.includes('name')),
        );
        const blackNameIdx = headers.findIndex(
          (h, i) =>
            i > resultIdx &&
            (h === 'name' || h.includes('black') || h.includes('name')),
        );

        if (whiteNameIdx >= 0 && blackNameIdx >= 0) {
          whiteName = cells[whiteNameIdx] ?? '';
          blackName = cells[blackNameIdx] ?? '';
          // Rating is usually the next column after name
          whiteRtg = parseInt(cells[whiteNameIdx + 1], 10) || null;
          blackRtg = parseInt(cells[blackNameIdx + 1], 10) || null;
        } else {
          // Fallback: positional extraction
          // Typical layout: Board | No | Name | Rtg | Result | No | Name | Rtg
          whiteName = cells[boardIdx + 2] ?? cells[boardIdx + 1] ?? '';
          whiteRtg =
            parseInt(cells[boardIdx + 3] ?? cells[boardIdx + 2], 10) || null;
          blackName = cells[resultIdx + 2] ?? cells[resultIdx + 1] ?? '';
          blackRtg =
            parseInt(cells[resultIdx + 3] ?? cells[resultIdx + 2], 10) || null;
        }

        if (whiteName || blackName) {
          pairings.push({
            board,
            whiteName,
            whiteRtg,
            result,
            blackName,
            blackRtg,
          });
        }
      });
    });

    this.logger.log(
      `Parsed ${pairings.length} pairing(s) for tnr${tnrId} round ${round}`,
    );
    return pairings;
  }

  // ── Parse standings for a round (art=1) ─────────────────────────────────

  async parseStandings(
    server: string,
    tnrId: string,
    round: number,
  ): Promise<CRStanding[]> {
    const url = this.buildUrl(server, tnrId, 1, `&rd=${round}`);
    const html = await this.throttledFetch(url);
    const $ = cheerio.load(html);

    const standings: CRStanding[] = [];
    const tables = $('table');

    tables.each((_, table) => {
      const rows = $(table).find('tr');
      if (rows.length < 3) return;

      const headers = rows
        .first()
        .find('th, td')
        .map((__, el) => $(el).text().trim().toLowerCase())
        .get();

      if (headers.some((h) => h.includes('\n') || h.length > 100)) return;

      // Identify standings table by "rk." or "rank" header
      const rkIdx = headers.findIndex(
        (h) => h === 'rk.' || h === 'rank' || h.includes('rank'),
      );
      const nameIdx = headers.findIndex(
        (h) => h === 'name' || h.includes('name'),
      );
      const ptsIdx = headers.findIndex(
        (h) => h === 'pts.' || h === 'pts' || h.includes('point'),
      );

      if (rkIdx === -1 || nameIdx === -1 || ptsIdx === -1) return;

      const snrIdx = headers.findIndex(
        (h) =>
          h === 'snr' ||
          h === 'sno' ||
          h === 'no.' ||
          h.includes('start'),
      );
      const ratingIdx = headers.findIndex(
        (h) => h === 'rtg' || h.includes('rating') || h === 'elo',
      );

      // Find tiebreak columns (TB1..TB6)
      const tbIndices: number[] = [];
      headers.forEach((h, i) => {
        if (h.startsWith('tb') || h.startsWith('tie') || h.startsWith('bh')) {
          tbIndices.push(i);
        }
      });

      rows.slice(1).each((__, row) => {
        const cells = $(row)
          .find('td')
          .map((___, el) => $(el).text().trim())
          .get();

        const rank = parseInt(cells[rkIdx], 10);
        if (!rank) return;

        const standing: CRStanding = {
          rank,
          startNo: snrIdx >= 0 ? parseInt(cells[snrIdx], 10) || 0 : 0,
          name: cells[nameIdx] ?? '',
          rating:
            ratingIdx >= 0 ? parseInt(cells[ratingIdx], 10) || null : null,
          points: parseFloat((cells[ptsIdx] ?? '').replace(',', '.')) || 0,
        };

        tbIndices.forEach((tbIdx, j) => {
          const key = `tb${j + 1}` as keyof CRStanding;
          (standing as any)[key] =
            parseFloat((cells[tbIdx] ?? '').replace(',', '.')) || null;
        });

        standings.push(standing);
      });
    });

    this.logger.log(
      `Parsed ${standings.length} standing(s) for tnr${tnrId} round ${round}`,
    );
    return standings;
  }

  // ── Detect total rounds ─────────────────────────────────────────────────

  async detectTotalRounds(
    server: string,
    tnrId: string,
  ): Promise<number> {
    const url = this.buildUrl(server, tnrId, 1, '&rd=1');
    const html = await this.throttledFetch(url);
    const $ = cheerio.load(html);

    let maxRound = 1;
    $('a').each((_, el) => {
      const href = $(el).attr('href') ?? '';
      const rdMatch = href.match(/rd=(\d+)/);
      if (rdMatch) {
        const rd = parseInt(rdMatch[1], 10);
        if (rd > maxRound) maxRound = rd;
      }
    });

    this.logger.log(`Detected ${maxRound} total round(s) for tnr${tnrId}`);
    return maxRound;
  }

  // ── Parse cross table (art=4) ───────────────────────────────────────────

  async parseCrossTable(
    server: string,
    tnrId: string,
  ): Promise<CRCrossTableEntry[]> {
    const url = this.buildUrl(server, tnrId, 4);
    const html = await this.throttledFetch(url);
    const $ = cheerio.load(html);

    const entries: CRCrossTableEntry[] = [];
    const tables = $('table');

    tables.each((_, table) => {
      const rows = $(table).find('tr');
      if (rows.length < 3) return;

      const headers = rows
        .first()
        .find('th, td')
        .map((__, el) => $(el).text().trim().toLowerCase())
        .get();

      if (headers.some((h) => h.includes('\n') || h.length > 100)) return;

      const rkIdx = headers.findIndex(
        (h) => h === 'rk.' || h === 'rank' || h.includes('rank'),
      );
      const nameIdx = headers.findIndex(
        (h) => h === 'name' || h.includes('name'),
      );
      const ptsIdx = headers.findIndex(
        (h) => h === 'pts.' || h === 'pts' || h.includes('point'),
      );

      if (rkIdx === -1 || nameIdx === -1) return;

      const snrIdx = headers.findIndex(
        (h) =>
          h === 'snr' ||
          h === 'sno' ||
          h === 'no.' ||
          h.includes('start'),
      );
      const ratingIdx = headers.findIndex(
        (h) => h === 'rtg' || h.includes('rating') || h === 'elo',
      );
      const fedIdx = headers.findIndex(
        (h) => h === 'fed' || h.includes('feder'),
      );

      // Round columns are typically numbered 1, 2, 3, ... in headers
      const roundColIndices: number[] = [];
      headers.forEach((h, i) => {
        if (/^\d+$/.test(h) && i > nameIdx) {
          roundColIndices.push(i);
        }
      });

      rows.slice(1).each((__, row) => {
        const cells = $(row)
          .find('td')
          .map((___, el) => $(el).text().trim())
          .get();

        const rank = parseInt(cells[rkIdx], 10);
        if (!rank) return;

        const rounds: { opponent: number | null; color: string; result: string }[] = [];

        for (const colIdx of roundColIndices) {
          const cellVal = cells[colIdx] ?? '';
          if (!cellVal || cellVal === '*') {
            rounds.push({ opponent: null, color: '', result: cellVal || 'X' });
            continue;
          }

          // Cross table encoding: {opponent_no}{color}{result}
          // e.g., "11b1" = opponent #11, Black, won
          // "5w½" = opponent #5, White, draw
          const match = cellVal.match(/(\d+)\s*([bwBW])\s*([01½+\-=])/);
          if (match) {
            const opponent = parseInt(match[1], 10);
            const color = match[2].toLowerCase();
            let result = match[3];
            if (result === '½' || result === '=') result = '½';
            rounds.push({ opponent, color, result });
          } else {
            // Fallback — store raw value
            rounds.push({ opponent: null, color: '', result: cellVal });
          }
        }

        entries.push({
          rank,
          startNo: snrIdx >= 0 ? parseInt(cells[snrIdx], 10) || 0 : 0,
          name: cells[nameIdx] ?? '',
          rating:
            ratingIdx >= 0 ? parseInt(cells[ratingIdx], 10) || null : null,
          fed: fedIdx >= 0 ? cells[fedIdx] || null : null,
          rounds,
          points:
            ptsIdx >= 0
              ? parseFloat((cells[ptsIdx] ?? '').replace(',', '.')) || 0
              : 0,
        });
      });
    });

    this.logger.log(
      `Parsed ${entries.length} cross-table entry(ies) for tnr${tnrId}`,
    );
    return entries;
  }
}
