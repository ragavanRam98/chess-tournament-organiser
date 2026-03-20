import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { MetricsInterceptor } from './metrics.interceptor';

/**
 * S7-6: Prometheus metrics module
 *
 * Exposes a /metrics endpoint with Prometheus-compatible metrics.
 * Includes HTTP request counters, histogram, uptime gauge, and BullMQ
 * queue depth gauges (when Redis is available).
 * Also registers the global MetricsInterceptor for HTTP request tracking.
 */
@Module({
    controllers: [MetricsController],
    providers: [
        MetricsService,
        // Global HTTP metrics interceptor — registered here so MetricsService is resolvable
        { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
    ],
    exports: [MetricsService],
})
export class MetricsModule {}
