import { Module } from '@nestjs/common';

/**
 * S7-5: Sentry integration module
 *
 * Initializes Sentry SDK on module creation if SENTRY_DSN is configured.
 * Works with SentryExceptionFilter for automatic error capture.
 */
@Module({})
export class SentryModule {
    constructor() {
        if (process.env.SENTRY_DSN) {
            try {
                const Sentry = require('@sentry/node');
                Sentry.init({
                    dsn: process.env.SENTRY_DSN,
                    environment: process.env.NODE_ENV ?? 'development',
                    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),

                    // Don't send PII by default
                    sendDefaultPii: false,

                    // Ignore expected HTTP errors
                    ignoreErrors: [
                        'NotFoundException',
                        'UnauthorizedException',
                        'ForbiddenException',
                        'BadRequestException',
                        'ConflictException',
                    ],
                });
                console.log('[Sentry] Initialized successfully');
            } catch {
                console.warn('[Sentry] @sentry/node not installed — skipping initialization');
            }
        }
    }
}
