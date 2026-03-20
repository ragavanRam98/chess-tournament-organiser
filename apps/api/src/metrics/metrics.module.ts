import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

/**
 * S7-6: Prometheus metrics module
 *
 * Exposes a /metrics endpoint with Prometheus-compatible metrics.
 * Includes HTTP request counters, histogram, uptime gauge, and BullMQ
 * queue depth gauges (when Redis is available).
 */
@Module({
    controllers: [MetricsController],
    providers: [MetricsService],
    exports: [MetricsService],
})
export class MetricsModule {}
