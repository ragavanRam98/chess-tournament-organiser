import { Controller, Get, Header } from '@nestjs/common';
import { MetricsService } from './metrics.service';

/**
 * S7-6: Prometheus-compatible /metrics endpoint
 *
 * Returns text/plain in Prometheus exposition format.
 * This endpoint is NOT behind auth guards so Prometheus can scrape it.
 */
@Controller('metrics')
export class MetricsController {
    constructor(private readonly metricsService: MetricsService) {}

    @Get()
    @Header('Content-Type', 'text/plain; charset=utf-8')
    getMetrics(): string {
        return this.metricsService.getMetrics();
    }
}
