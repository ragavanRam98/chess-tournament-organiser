import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';

/**
 * S6-1: SEND_EMAIL processor
 *
 * Handles email notification jobs enqueued by the API.
 * Templates: REGISTRATION_CONFIRMED, TOURNAMENT_CANCELLED, TOURNAMENT_APPROVED, REFUND_PROCESSED.
 *
 * In production: integrates with SendGrid. In dev: logs the email.
 */
@Processor(QUEUE_NAMES.NOTIFICATIONS)
export class SendEmailProcessor extends WorkerHost {
  private readonly logger = new Logger(SendEmailProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job): Promise<{ sent: boolean }> {
    if (job.name !== JOB_NAMES.SEND_EMAIL) return { sent: false };

    const { type, registrationId, organizerId, tournamentId } = job.data;

    switch (type) {
      case 'REGISTRATION_CONFIRMED':
        return this.sendRegistrationConfirmed(registrationId);
      case 'TOURNAMENT_CANCELLED':
        return this.sendTournamentCancelled(registrationId);
      case 'TOURNAMENT_APPROVED':
        return this.sendTournamentApproved(organizerId, tournamentId);
      case 'REFUND_PROCESSED':
        return this.sendRefundProcessed(registrationId, job.data.tournamentTitle);
      default:
        this.logger.warn(`[SEND_EMAIL] Unknown email type: ${type}`);
        return { sent: false };
    }
  }

  private async sendRegistrationConfirmed(registrationId: string): Promise<{ sent: boolean }> {
    const registration = await this.prisma.registration.findUnique({
      where: { id: registrationId },
      include: {
        tournament: { select: { title: true, startDate: true, venue: true } },
        category: { select: { name: true } },
      },
    });

    if (!registration || !registration.email) {
      this.logger.warn(`[SEND_EMAIL] Registration ${registrationId} not found or no email — skipping`);
      return { sent: false };
    }

    const emailPayload = {
      to: registration.email,
      subject: `Registration Confirmed — ${registration.tournament.title}`,
      html: this.renderRegistrationConfirmedHtml(registration),
    };

    await this.sendEmail(emailPayload);
    this.logger.log(`[SEND_EMAIL] REGISTRATION_CONFIRMED sent to ${registration.email} for ${registration.entryNumber}`);
    return { sent: true };
  }

  private async sendTournamentCancelled(registrationId: string): Promise<{ sent: boolean }> {
    const registration = await this.prisma.registration.findUnique({
      where: { id: registrationId },
      include: {
        tournament: { select: { title: true, startDate: true } },
      },
    });

    if (!registration || !registration.email) {
      this.logger.warn(`[SEND_EMAIL] Registration ${registrationId} not found or no email — skipping`);
      return { sent: false };
    }

    const emailPayload = {
      to: registration.email,
      subject: `Tournament Cancelled — ${registration.tournament.title}`,
      html: this.renderTournamentCancelledHtml(registration),
    };

    await this.sendEmail(emailPayload);
    this.logger.log(`[SEND_EMAIL] TOURNAMENT_CANCELLED sent to ${registration.email}`);
    return { sent: true };
  }

  private async sendTournamentApproved(organizerId: string, tournamentId: string): Promise<{ sent: boolean }> {
    const tournament: any = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        organizer: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!tournament) {
      this.logger.warn(`[SEND_EMAIL] Tournament ${tournamentId} not found — skipping`);
      return { sent: false };
    }

    const organizerEmail = tournament.organizer?.user?.email;
    const organizerName = tournament.organizer?.user?.name ?? tournament.organizer?.academyName;

    if (!organizerEmail) {
      this.logger.warn(`[SEND_EMAIL] No email for organizer — skipping`);
      return { sent: false };
    }

    const emailPayload = {
      to: organizerEmail,
      subject: `Tournament Approved — ${tournament.title}`,
      html: `<p>Hi ${organizerName},</p>
             <p>Your tournament <strong>${tournament.title}</strong> has been approved and is now accepting registrations.</p>
             <p>— KingSquare · <small style="color:#9ca3af">A product of Easy Chess Academy</small></p>`,
    };

    await this.sendEmail(emailPayload);
    this.logger.log(`[SEND_EMAIL] TOURNAMENT_APPROVED sent to organizer for ${tournament.title}`);
    return { sent: true };
  }

  private async sendRefundProcessed(registrationId: string, tournamentTitle?: string): Promise<{ sent: boolean }> {
    const registration = await this.prisma.registration.findUnique({
      where: { id: registrationId },
      include: {
        tournament: { select: { title: true } },
      },
    });

    if (!registration || !registration.email) {
      this.logger.warn(`[SEND_EMAIL] Registration ${registrationId} not found or no email — skipping refund email`);
      return { sent: false };
    }

    const title = tournamentTitle ?? registration.tournament.title;

    const emailPayload = {
      to: registration.email,
      subject: `Refund Processed — ${title}`,
      html: this.renderRefundProcessedHtml(registration, title),
    };

    await this.sendEmail(emailPayload);
    this.logger.log(`[SEND_EMAIL] REFUND_PROCESSED sent to ${registration.email} for ${registration.entryNumber}`);
    return { sent: true };
  }

  // ── HTML rendering ─────────────────────────────────────────────────────

  private renderRegistrationConfirmedHtml(reg: any): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">Registration Confirmed ✓</h2>
        <p>Hi <strong>${reg.playerName}</strong>,</p>
        <p>Your registration for <strong>${reg.tournament.title}</strong> has been confirmed.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 8px; border: 1px solid #e5e7eb;">Entry Number</td><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>${reg.entryNumber}</strong></td></tr>
          <tr><td style="padding: 8px; border: 1px solid #e5e7eb;">Category</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${reg.category?.name ?? 'N/A'}</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #e5e7eb;">Tournament Date</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${new Date(reg.tournament.startDate).toLocaleDateString('en-IN')}</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #e5e7eb;">Venue</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${reg.tournament.venue ?? 'TBA'}</td></tr>
        </table>
        <p style="color: #6b7280; font-size: 14px;">Please save this email for your records.</p>
        <p>— KingSquare · <small style="color:#9ca3af">A product of Easy Chess Academy</small></p>
      </div>`;
  }

  private renderTournamentCancelledHtml(reg: any): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc2626;">Tournament Cancelled</h2>
        <p>Hi <strong>${reg.playerName}</strong>,</p>
        <p>We regret to inform you that the tournament <strong>${reg.tournament.title}</strong> has been cancelled.</p>
        <p>Your registration (${reg.entryNumber}) has been voided. If you made a payment, a refund will be processed shortly.</p>
        <p>— KingSquare · <small style="color:#9ca3af">A product of Easy Chess Academy</small></p>
      </div>`;
  }

  private renderRefundProcessedHtml(reg: any, tournamentTitle: string): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #16a34a;">Refund Processed</h2>
        <p>Hi <strong>${reg.playerName}</strong>,</p>
        <p>Your refund for <strong>${tournamentTitle}</strong> has been processed successfully.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 8px; border: 1px solid #e5e7eb;">Entry Number</td><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>${reg.entryNumber}</strong></td></tr>
          <tr><td style="padding: 8px; border: 1px solid #e5e7eb;">Tournament</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${tournamentTitle}</td></tr>
        </table>
        <p style="color: #6b7280; font-size: 14px;">The refund should reflect in your account within 5–7 business days depending on your bank.</p>
        <p>— KingSquare · <small style="color:#9ca3af">A product of Easy Chess Academy</small></p>
      </div>`;
  }

  // ── Email transport ────────────────────────────────────────────────────

  private async sendEmail(payload: { to: string; subject: string; html: string }): Promise<void> {
    if (process.env.SENDGRID_API_KEY) {
      try {
        const sgMail = await import('@sendgrid/mail');
        sgMail.default.setApiKey(process.env.SENDGRID_API_KEY);
        await sgMail.default.send({
          from: process.env.EMAIL_FROM ?? 'noreply@kingsquare.in',
          to: payload.to,
          subject: payload.subject,
          html: payload.html,
        });
      } catch (err) {
        this.logger.error(`[SEND_EMAIL] SendGrid error: ${(err as Error).message}`);
        throw err;
      }
    } else {
      this.logger.log(`[SEND_EMAIL] (dev) Would send to ${payload.to}: ${payload.subject}`);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`[SEND_EMAIL] Job ${job.id} failed: ${err.message}`);
  }
}
