import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';

/**
 * S7-4: Pino structured logging
 *
 * - JSON output for staging/prod, dev-friendly "pino-pretty" in development
 * - Sensitive field redaction: password, token, authorization header
 * - Request context: method, url, status, responseTime
 */
@Module({
    imports: [
        PinoLoggerModule.forRoot({
            pinoHttp: {
                // JSON in non-dev, pretty print in dev
                transport:
                    process.env.NODE_ENV !== 'production'
                        ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
                        : undefined,
                level: process.env.LOG_LEVEL ?? 'info',

                // Redact sensitive fields from logs
                redact: {
                    paths: [
                        'req.headers.authorization',
                        'req.headers.cookie',
                        'req.body.password',
                        'req.body.currentPassword',
                        'req.body.newPassword',
                        'req.body.token',
                        'req.body.refreshToken',
                    ],
                    censor: '[REDACTED]',
                },

                // Custom serializers for cleaner log output
                serializers: {
                    req(req) {
                        return {
                            id: req.id,
                            method: req.method,
                            url: req.url,
                            remoteAddress: req.remoteAddress,
                        };
                    },
                    res(res) {
                        return { statusCode: res.statusCode };
                    },
                },

                // Auto-assign log level based on status code
                customLogLevel(_req: any, res: any, err: any) {
                    if (res.statusCode >= 500 || err) return 'error';
                    if (res.statusCode >= 400) return 'warn';
                    return 'info';
                },

                // Quieter in test
                ...(process.env.NODE_ENV === 'test' ? { level: 'silent' } : {}),
            },
        }),
    ],
})
export class LoggerConfigModule {}
