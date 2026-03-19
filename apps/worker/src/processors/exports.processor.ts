import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import * as ExcelJS from 'exceljs';

/**
 * S6-3 + S6-4: Exports queue processor
 *
 * Handles two job types on the EXPORTS queue:
 * - GENERATE_EXPORT: Query CONFIRMED registrations, build .xlsx, upload to R2
 * - CLEANUP_EXPORT_FILES: Delete expired R2 objects (daily 2 AM IST cron)
 */
@Processor(QUEUE_NAMES.EXPORTS)
export class ExportsProcessor extends WorkerHost {
  private readonly logger = new Logger(ExportsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async process(job: Job): Promise<any> {
    switch (job.name) {
      case JOB_NAMES.GENERATE_EXPORT:
        return this.generateExport(job.data);
      case JOB_NAMES.CLEANUP_EXPORT_FILES:
        return this.cleanupExpiredExports();
      default:
        this.logger.warn(`[EXPORTS] Unknown job name: ${job.name}`);
        return { handled: false };
    }
  }

  // ── S6-3: GENERATE_EXPORT ────────────────────────────────────────────────

  private async generateExport(data: { exportJobId: string }): Promise<{ exportJobId: string; rowCount: number }> {
    const { exportJobId } = data;

    const exportJob = await this.prisma.exportJob.findUnique({
      where: { id: exportJobId },
    });

    if (!exportJob) {
      this.logger.warn(`[GENERATE_EXPORT] ExportJob ${exportJobId} not found — skipping`);
      return { exportJobId, rowCount: 0 };
    }

    // Mark PROCESSING
    await this.prisma.exportJob.update({
      where: { id: exportJobId },
      data: { status: 'PROCESSING' },
    });

    try {
      // Query CONFIRMED registrations for this tournament
      const registrations = await this.prisma.registration.findMany({
        where: {
          tournamentId: exportJob.tournamentId,
          status: 'CONFIRMED',
        },
        include: { category: { select: { name: true } } },
        orderBy: { entryNumber: 'asc' },
      });

      // Build Excel workbook
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Easy Chess Academy';
      workbook.created = new Date();

      const sheet = workbook.addWorksheet('Registrations');
      sheet.columns = [
        { header: 'Entry Number', key: 'entryNumber', width: 20 },
        { header: 'Player Name', key: 'playerName', width: 25 },
        { header: 'Date of Birth', key: 'playerDob', width: 15 },
        { header: 'Phone', key: 'phone', width: 18 },
        { header: 'Email', key: 'email', width: 30 },
        { header: 'City', key: 'city', width: 18 },
        { header: 'Category', key: 'category', width: 20 },
        { header: 'Status', key: 'status', width: 15 },
        { header: 'Confirmed At', key: 'confirmedAt', width: 22 },
      ];

      // Style header with blue background + white text
      const headerRow = sheet.getRow(1);
      headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '2563EB' } };

      // Populate data rows
      for (const reg of registrations) {
        sheet.addRow({
          entryNumber: reg.entryNumber,
          playerName: reg.playerName,
          playerDob: new Date(reg.playerDob).toLocaleDateString('en-IN'),
          phone: reg.phone,
          email: reg.email ?? '',
          city: reg.city ?? '',
          category: reg.category?.name ?? 'N/A',
          status: reg.status,
          confirmedAt: reg.confirmedAt ? new Date(reg.confirmedAt).toLocaleString('en-IN') : '',
        });
      }

      // Write to buffer and upload to R2
      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
      const storageKey = this.storage.buildExportKey(exportJob.organizerId, exportJob.tournamentId, exportJobId, 'xlsx');

      await this.storage.upload(storageKey, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

      // Mark DONE
      await this.prisma.exportJob.update({
        where: { id: exportJobId },
        data: { status: 'DONE', storageKey, completedAt: new Date() },
      });

      this.logger.log(`[GENERATE_EXPORT] Job ${exportJobId}: ${registrations.length} rows → R2 at ${storageKey}`);
      return { exportJobId, rowCount: registrations.length };

    } catch (err) {
      // Mark FAILED
      await this.prisma.exportJob.update({
        where: { id: exportJobId },
        data: { status: 'FAILED' },
      });
      this.logger.error(`[GENERATE_EXPORT] Job ${exportJobId} failed: ${(err as Error).message}`);
      throw err;
    }
  }

  // ── S6-4: CLEANUP_EXPORT_FILES ───────────────────────────────────────────

  private async cleanupExpiredExports(): Promise<{ cleaned: number }> {
    const now = new Date();

    const expired = await this.prisma.exportJob.findMany({
      where: {
        status: 'DONE',
        expiresAt: { lt: now },
      },
      select: { id: true, storageKey: true },
    });

    this.logger.log(`[CLEANUP_EXPORT] Found ${expired.length} expired export(s) to clean up`);

    let cleaned = 0;

    for (const expiredJob of expired) {
      try {
        if (expiredJob.storageKey) {
          await this.storage.delete(expiredJob.storageKey);
        }
        await this.prisma.exportJob.update({
          where: { id: expiredJob.id },
          data: { status: 'EXPIRED', storageKey: null },
        });
        cleaned++;
        this.logger.log(`[CLEANUP_EXPORT] Expired job ${expiredJob.id} — R2 object deleted`);
      } catch (err) {
        this.logger.error(`[CLEANUP_EXPORT] Failed to clean up job ${expiredJob.id}`, err);
      }
    }

    this.logger.log(`[CLEANUP_EXPORT] Done — ${cleaned}/${expired.length} exports cleaned`);
    return { cleaned };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`[EXPORTS] Job ${job.id} (${job.name}) failed: ${err.message}`);
  }
}
