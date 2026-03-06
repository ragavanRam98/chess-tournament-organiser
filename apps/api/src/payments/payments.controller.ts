import { Controller, Post, Req, Res, Headers, HttpCode } from '@nestjs/common';
import { Request, Response } from 'express';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
    constructor(private readonly paymentsService: PaymentsService) { }

    /**
     * POST /payments/webhook
     * Auth: None. Protected by HMAC-SHA256 signature ONLY.
     * CRITICAL: rawBody must be read before express.json() middleware.
     * Must respond within 3 seconds (Razorpay timeout).
     */
    @Post('webhook')
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
