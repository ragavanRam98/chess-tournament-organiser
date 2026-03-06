import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import Razorpay from 'razorpay';

@Injectable()
export class RazorpayService {
    private readonly logger = new Logger(RazorpayService.name);
    private _client: Razorpay | null = null;

    /** Lazy-initialised so the server still boots in dev when Razorpay keys are not yet set. */
    private get client(): Razorpay {
        if (!this._client) {
            const keyId = process.env.RAZORPAY_KEY_ID;
            const keySecret = process.env.RAZORPAY_KEY_SECRET;
            if (!keyId || !keySecret) {
                throw new InternalServerErrorException(
                    'Razorpay credentials are not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.',
                );
            }
            this._client = new Razorpay({ key_id: keyId, key_secret: keySecret });
        }
        return this._client;
    }

    async createOrder(amountPaise: number, receipt?: string) {
        return this.client.orders.create({ amount: amountPaise, currency: 'INR', receipt });
    }

    async fetchPayment(paymentId: string) {
        return this.client.payments.fetch(paymentId);
    }
}
