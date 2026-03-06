import { Injectable } from '@nestjs/common';
import Razorpay from 'razorpay';

@Injectable()
export class RazorpayService {
    private readonly client: Razorpay;

    constructor() {
        this.client = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID!,
            key_secret: process.env.RAZORPAY_KEY_SECRET!,
        });
    }

    async createOrder(amountPaise: number, receipt?: string) {
        return this.client.orders.create({ amount: amountPaise, currency: 'INR', receipt });
    }

    async fetchPayment(paymentId: string) {
        return this.client.payments.fetch(paymentId);
    }
}
