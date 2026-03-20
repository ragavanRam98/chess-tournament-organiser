import {
    Injectable, NestInterceptor, ExecutionContext, CallHandler,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

/**
 * S7-6: HTTP metrics interceptor
 *
 * Records request count and duration for every HTTP request.
 * Applied globally via APP_INTERCEPTOR or in main.ts.
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
    constructor(private readonly metrics: MetricsService) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const req = context.switchToHttp().getRequest();
        const start = Date.now();

        return next.handle().pipe(
            tap({
                next: () => {
                    const res = context.switchToHttp().getResponse();
                    const duration = Date.now() - start;
                    const route = req.route?.path ?? req.url?.split('?')[0] ?? 'unknown';
                    this.metrics.recordHttpRequest(req.method, route, res.statusCode, duration);
                },
                error: () => {
                    const res = context.switchToHttp().getResponse();
                    const duration = Date.now() - start;
                    const route = req.route?.path ?? req.url?.split('?')[0] ?? 'unknown';
                    this.metrics.recordHttpRequest(req.method, route, res.statusCode || 500, duration);
                },
            }),
        );
    }
}
