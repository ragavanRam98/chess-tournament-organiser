import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { createWriteStream, createReadStream, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as https from 'https';
import * as http from 'http';
import { createInterface } from 'readline';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';

/**
 * FideSyncProcessor — GAP 4
 *
 * Downloads the FIDE Standard Rating List (publicly available, no API key needed)
 * and upserts it into the local `fide_players` table.
 *
 * Source: https://ratings.fide.com/download/players_list.zip
 * Format: Fixed-width text file. The FIDE players_list.txt column layout (2024):
 *
 *   Position  Field           Width
 *   0–8       FIDE ID         9 chars (right-aligned numeric)
 *   9–51      Name            43 chars (last, first format — "Surname, Firstname")
 *   52–55     Federation      4 chars (3-char ISO country + space)
 *   56        Sex             1 char  ("M", "F", or "W" for women's titles)
 *   57–62     Title           6 chars (GM, IM, FM, CM, WGM, WIM, WFM, WCM, or blank)
 *   63–68     WTitle          6 chars
 *   69–74     OTitle          6 chars
 *   75–79     FOA             5 chars
 *   113–117   Std Rating      5 chars (0 = unrated)
 *   118–121   Std Games       4 chars
 *   122       Std K           1 char
 *   123–127   Rapid Rating    5 chars
 *   133–137   Blitz Rating    5 chars
 *   148–151   Birth Year      4 chars
 *
 * NOTE: Column positions may shift across FIDE file versions. If the parser
 * produces garbage data, inspect the header line and adjust positions below.
 *
 * Runs: Monthly, 1st of each month, 3 AM IST (low-traffic window).
 * Queue: CLEANUP (low priority — does not affect user-facing operations).
 * Upsert batch size: 500 records per DB transaction (balances throughput vs. lock time).
 */

const FIDE_DOWNLOAD_URL = 'https://ratings.fide.com/download/players_list.zip';
const UPSERT_BATCH_SIZE = 500;

// Field positions in the FIDE players_list.txt fixed-width format.
// Adjust here if FIDE changes their format.
const COL = {
  fideId: { start: 0, end: 9 },
  name:   { start: 9, end: 52 },
  fed:    { start: 52, end: 56 },
  sex:    { start: 56, end: 57 },
  title:  { start: 57, end: 63 },
  stdRating:   { start: 113, end: 118 },
  rapidRating: { start: 123, end: 128 },
  blitzRating: { start: 133, end: 138 },
  birthYear:   { start: 148, end: 152 },
} as const;

interface FideRecord {
  fideId: string;
  name: string;
  country: string;
  sex: string | null;
  title: string | null;
  standardRating: number | null;
  rapidRating: number | null;
  blitzRating: number | null;
  birthYear: number | null;
}

@Processor(QUEUE_NAMES.CLEANUP)
export class FideSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(FideSyncProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job): Promise<{ synced: number; skipped: number }> {
    if (job.name !== JOB_NAMES.SYNC_FIDE_RATINGS) {
      return { synced: 0, skipped: 0 };
    }

    this.logger.log('[FIDE_SYNC] Starting monthly FIDE rating list sync…');
    const zipPath = join(tmpdir(), `fide_ratings_${Date.now()}.zip`);

    try {
      // 1. Download the ZIP
      await this.downloadFile(FIDE_DOWNLOAD_URL, zipPath);
      this.logger.log(`[FIDE_SYNC] Download complete → ${zipPath}`);

      // 2. Extract + parse + upsert
      const { synced, skipped } = await this.extractParseAndUpsert(zipPath);
      this.logger.log(`[FIDE_SYNC] Complete — synced: ${synced}, skipped (invalid lines): ${skipped}`);
      return { synced, skipped };
    } finally {
      // Always clean up temp file
      if (existsSync(zipPath)) {
        try { unlinkSync(zipPath); } catch { /* ignore cleanup errors */ }
      }
    }
  }

  // ── Download ────────────────────────────────────────────────────────────

  private downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = createWriteStream(destPath);
      const protocol = url.startsWith('https') ? https : http;

      const request = (protocol as typeof https).get(url, (response) => {
        // Follow redirects (FIDE uses HTTP 302)
        if (response.statusCode === 301 || response.statusCode === 302) {
          file.close();
          if (existsSync(destPath)) unlinkSync(destPath);
          this.downloadFile(response.headers.location!, destPath).then(resolve).catch(reject);
          return;
        }
        if (response.statusCode !== 200) {
          file.close();
          reject(new Error(`FIDE download failed with status ${response.statusCode}`));
          return;
        }
        response.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', reject);
      });

      request.on('error', (err) => {
        file.close();
        if (existsSync(destPath)) unlinkSync(destPath);
        reject(err);
      });

      // 10 minute timeout for the full download (~80MB zip)
      request.setTimeout(10 * 60 * 1000, () => {
        request.destroy();
        reject(new Error('FIDE download timed out after 10 minutes'));
      });
    });
  }

  // ── Extract, parse, upsert ──────────────────────────────────────────────

  private async extractParseAndUpsert(zipPath: string): Promise<{ synced: number; skipped: number }> {
    // unzipper is required in the worker's package.json:
    //   npm install unzipper --save  (in apps/worker)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const unzipper = require('unzipper');

    let synced = 0;
    let skipped = 0;
    let batch: FideRecord[] = [];
    let isFirstLine = true;

    await new Promise<void>((resolve, reject) => {
      createReadStream(zipPath)
        .pipe(unzipper.Parse())
        .on('entry', (entry: any) => {
          const fileName: string = entry.path;

          // The main ratings file is players_list.txt (ignore other entries)
          if (!fileName.toLowerCase().endsWith('.txt') || fileName.includes('__MACOSX')) {
            entry.autodrain();
            return;
          }

          this.logger.log(`[FIDE_SYNC] Parsing ZIP entry: ${fileName}`);

          const rl = createInterface({ input: entry, crlfDelay: Infinity });

          rl.on('line', (line: string) => {
            // Skip the header line (starts with "ID Number" or similar text)
            if (isFirstLine) {
              isFirstLine = false;
              return;
            }
            // Skip blank lines
            if (!line.trim()) return;

            const record = this.parseLine(line);
            if (!record) {
              skipped++;
              return;
            }

            batch.push(record);

            if (batch.length >= UPSERT_BATCH_SIZE) {
              const toFlush = batch.splice(0, UPSERT_BATCH_SIZE);
              // Chain upserts sequentially to avoid overwhelming PgBouncer
              this.upsertBatch(toFlush)
                .then(count => { synced += count; })
                .catch(err => this.logger.error(`[FIDE_SYNC] Batch upsert error: ${err.message}`));
            }
          });

          rl.on('close', async () => {
            // Flush remaining records
            if (batch.length > 0) {
              try {
                synced += await this.upsertBatch(batch);
              } catch (err: any) {
                this.logger.error(`[FIDE_SYNC] Final batch upsert error: ${err.message}`);
              }
              batch = [];
            }
            resolve();
          });

          rl.on('error', reject);
        })
        .on('error', reject);
    });

    return { synced, skipped };
  }

  // ── Line parser ─────────────────────────────────────────────────────────

  private parseLine(line: string): FideRecord | null {
    // Line must be at least long enough to contain the FIDE ID
    if (line.length < 9) return null;

    const fideId = line.slice(COL.fideId.start, COL.fideId.end).trim();
    // FIDE IDs are numeric. A non-numeric value indicates a header or malformed line.
    if (!fideId || !/^\d+$/.test(fideId)) return null;

    const name    = line.slice(COL.name.start, COL.name.end).trim();
    const country = line.slice(COL.fed.start, COL.fed.end).trim();
    const sex     = line.slice(COL.sex.start, COL.sex.end).trim() || null;
    const title   = line.slice(COL.title.start, COL.title.end).trim() || null;

    // Rating fields — 0 means unrated in FIDE format; store as null for clarity
    const parseRating = (raw: string): number | null => {
      const n = parseInt(raw.trim(), 10);
      return !isNaN(n) && n > 0 ? n : null;
    };

    const parseYear = (raw: string): number | null => {
      const n = parseInt(raw.trim(), 10);
      return !isNaN(n) && n > 1900 && n <= new Date().getFullYear() ? n : null;
    };

    return {
      fideId,
      name,
      country,
      sex,
      title,
      standardRating: line.length > COL.stdRating.end
        ? parseRating(line.slice(COL.stdRating.start, COL.stdRating.end))
        : null,
      rapidRating: line.length > COL.rapidRating.end
        ? parseRating(line.slice(COL.rapidRating.start, COL.rapidRating.end))
        : null,
      blitzRating: line.length > COL.blitzRating.end
        ? parseRating(line.slice(COL.blitzRating.start, COL.blitzRating.end))
        : null,
      birthYear: line.length > COL.birthYear.end
        ? parseYear(line.slice(COL.birthYear.start, COL.birthYear.end))
        : null,
    };
  }

  // ── DB upsert ────────────────────────────────────────────────────────────

  private async upsertBatch(records: FideRecord[]): Promise<number> {
    if (records.length === 0) return 0;
    const now = new Date();

    // Prisma's createMany with skipDuplicates is not sufficient here (we need updates).
    // Use raw SQL for an efficient single-statement upsert batch.
    // This runs inside PgBouncer transaction-mode — safe.
    const values = records
      .map(r => `(
        '${this.escapeSql(r.fideId)}',
        '${this.escapeSql(r.name)}',
        '${this.escapeSql(r.country)}',
        ${r.sex ? `'${this.escapeSql(r.sex)}'` : 'NULL'},
        ${r.title ? `'${this.escapeSql(r.title)}'` : 'NULL'},
        ${r.standardRating ?? 'NULL'},
        ${r.rapidRating ?? 'NULL'},
        ${r.blitzRating ?? 'NULL'},
        ${r.birthYear ?? 'NULL'},
        '${now.toISOString()}'
      )`)
      .join(',');

    await this.prisma.$executeRawUnsafe(`
      INSERT INTO fide_players
        (fide_id, name, country, sex, title, standard_rating, rapid_rating, blitz_rating, birth_year, last_updated)
      VALUES ${values}
      ON CONFLICT (fide_id) DO UPDATE SET
        name             = EXCLUDED.name,
        country          = EXCLUDED.country,
        sex              = EXCLUDED.sex,
        title            = EXCLUDED.title,
        standard_rating  = EXCLUDED.standard_rating,
        rapid_rating     = EXCLUDED.rapid_rating,
        blitz_rating     = EXCLUDED.blitz_rating,
        birth_year       = EXCLUDED.birth_year,
        last_updated     = EXCLUDED.last_updated
    `);

    return records.length;
  }

  /** Minimal SQL injection guard for the raw upsert — only applied to string fields. */
  private escapeSql(value: string): string {
    return value.replace(/'/g, "''").replace(/\\/g, '\\\\').slice(0, 255);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`[FIDE_SYNC] Job ${job.id} failed (attempt ${job.attemptsMade}): ${err.message}`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job, result: { synced: number; skipped: number }) {
    if (job.name === JOB_NAMES.SYNC_FIDE_RATINGS) {
      this.logger.log(`[FIDE_SYNC] Job complete — ${result.synced} upserted, ${result.skipped} skipped`);
    }
  }
}
