import {
    ExceptionFilter,
    Catch,
    ArgumentsHost,
    HttpException,
    HttpStatus,
    Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(GlobalExceptionFilter.name);

    catch(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const req = ctx.getRequest<Request>();
        const res = ctx.getResponse<Response>();

        let status = HttpStatus.INTERNAL_SERVER_ERROR;
        let code = 'INTERNAL_SERVER_ERROR';
        let message = 'An unexpected error occurred';

        if (exception instanceof HttpException) {
            status = exception.getStatus();
            const body = exception.getResponse();
            if (typeof body === 'string') {
                code = body;
                message = body;
            } else if (typeof body === 'object' && body !== null) {
                const b = body as Record<string, unknown>;
                code = (b['error'] as string) ?? exception.name;
                message = (b['message'] as string) ?? message;
            }
        }

        if (status >= 500) {
            this.logger.error(
                `[${req.method}] ${req.url} → ${status}`,
                exception instanceof Error ? exception.stack : String(exception),
            );
        }

        res.status(status).json({
            error: {
                code,
                message,
                path: req.url,
                timestamp: new Date().toISOString(),
            },
        });
    }
}
