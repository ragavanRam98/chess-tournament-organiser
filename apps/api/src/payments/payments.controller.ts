import { Controller, Post, Req, Res, Headers, HttpCode } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
    constructor(private readonly paymentsService: PaymentsService) { }

    /**
     * POST /payments/webhook
     * Auth: None. Protected by HMAC-SHA256 signature ONLY.
     * Throttle: Skipped — Razorpay sends webhooks in bursts.
     */
    @Post('webhook')
    @SkipThrottle()
    @HttpCode(200)
    async webhook(
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
        @Headers('x-razorpay-signature') signature: string,
    ) {
        return this.paymentsService.handleWebhook((req as any).rawBody, signature, req.body);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
