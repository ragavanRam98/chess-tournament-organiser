import {
    ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * S7-5: Sentry-aware global exception filter
 *
 * Captures unhandled exceptions and sends them to Sentry (if configured).
 * Falls back to logging when Sentry is not available.
 * Always returns a uniform error shape to the client.
 */
@Catch()
export class SentryExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(SentryExceptionFilter.name);

    catch(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const request = ctx.getRequest<Request>();
        const response = ctx.getResponse<Response>();

        const status =
            exception instanceof HttpException
                ? exception.getStatus()
                : HttpStatus.INTERNAL_SERVER_ERROR;

        const message =
            exception instanceof HttpException
                ? exception.getResponse()
                : 'Internal Server Error';

        // Only capture 5xx errors to Sentry (not client errors)
        if (status >= 500) {
            this.captureToSentry(exception, request);
        }

        // Log the error
        this.logger.error(
            `[${request.method}] ${request.url} → ${status}`,
            exception instanceof Error ? exception.stack : String(exception),
        );

        response.status(status).json({
            error: {
                code: status,
                message: typeof message === 'string' ? message : (message as any)?.message ?? message,
                path: request.url,
                timestamp: new Date().toISOString(),
            },
        });
    }

    private captureToSentry(exception: unknown, request: Request) {
        try {
            if (!process.env.SENTRY_DSN) return;

            // Dynamic import to avoid hard dependency when Sentry is not installed
            const Sentry = require('@sentry/node');
            Sentry.withScope((scope: any) => {
                scope.setTag('url', request.url);
                scope.setTag('method', request.method);
                scope.setExtra('body', request.body);
                scope.setExtra('query', request.query);
                scope.setExtra('params', request.params);

                if ((request as any).user) {
                    scope.setUser({ id: (request as any).user.sub });
                }

                Sentry.captureException(exception);
            });
        } catch {
            // Sentry not installed or misconfigured — silently skip
        }
    }
}
