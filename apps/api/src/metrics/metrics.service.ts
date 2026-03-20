import { Injectable, OnModuleInit, Logger } from '@nestjs/common';

/**
 * S7-6: Lightweight Prometheus-compatible metrics service
 *
 * Tracks HTTP request counts by method/route/status, request duration
 * histogram, and application uptime. No external dependency required
 * — outputs text/plain Prometheus exposition format.
 */
@Injectable()
export class MetricsService implements OnModuleInit {
    private readonly logger = new Logger(MetricsService.name);
    private startTime: number;

    // HTTP counters: key = `{method}_{route}_{status}` → count
    private httpRequestsTotal = new Map<string, number>();
    // Duration buckets (ms): [10, 50, 100, 250, 500, 1000, 5000]
    private readonly buckets = [10, 50, 100, 250, 500, 1000, 5000];
    private httpDurationBuckets = new Map<string, number>();
    private httpDurationSum = 0;
    private httpDurationCount = 0;

    onModuleInit() {
        this.startTime = Date.now();
        this.logger.log('[Metrics] Prometheus metrics service initialized');
    }

    /**
     * Record an HTTP request metric.
     * Call this from middleware or interceptor.
     */
    recordHttpRequest(method: string, route: string, statusCode: number, durationMs: number) {
        const key = `${method}_${route}_${statusCode}`;
        this.httpRequestsTotal.set(key, (this.httpRequestsTotal.get(key) ?? 0) + 1);

        // Update histogram buckets
        for (const bucket of this.buckets) {
            const bucketKey = `${bucket}`;
            if (durationMs <= bucket) {
                this.httpDurationBuckets.set(bucketKey, (this.httpDurationBuckets.get(bucketKey) ?? 0) + 1);
            }
        }
        this.httpDurationSum += durationMs;
        this.httpDurationCount++;
    }

    /**
     * Generate Prometheus exposition format output
     */
    getMetrics(): string {
        const lines: string[] = [];

        // Uptime gauge
        const uptimeSeconds = (Date.now() - this.startTime) / 1000;
        lines.push('# HELP app_uptime_seconds Application uptime in seconds');
        lines.push('# TYPE app_uptime_seconds gauge');
        lines.push(`app_uptime_seconds ${uptimeSeconds.toFixed(1)}`);
        lines.push('');

        // HTTP requests total counter
        lines.push('# HELP http_requests_total Total HTTP requests');
        lines.push('# TYPE http_requests_total counter');
        for (const [key, count] of this.httpRequestsTotal.entries()) {
            const [method, route, status] = key.split('_');
            lines.push(`http_requests_total{method="${method}",route="${route}",status="${status}"} ${count}`);
        }
        lines.push('');

        // HTTP request duration histogram
        lines.push('# HELP http_request_duration_ms HTTP request duration in milliseconds');
        lines.push('# TYPE http_request_duration_ms histogram');
        let cumulativeCount = 0;
        for (const bucket of this.buckets) {
            cumulativeCount += this.httpDurationBuckets.get(`${bucket}`) ?? 0;
            lines.push(`http_request_duration_ms_bucket{le="${bucket}"} ${cumulativeCount}`);
        }
        lines.push(`http_request_duration_ms_bucket{le="+Inf"} ${this.httpDurationCount}`);
        lines.push(`http_request_duration_ms_sum ${this.httpDurationSum.toFixed(1)}`);
        lines.push(`http_request_duration_ms_count ${this.httpDurationCount}`);
        lines.push('');

        // Node.js process metrics
        const mem = process.memoryUsage();
        lines.push('# HELP process_resident_memory_bytes Resident memory size in bytes');
        lines.push('# TYPE process_resident_memory_bytes gauge');
        lines.push(`process_resident_memory_bytes ${mem.rss}`);
        lines.push('');

        lines.push('# HELP process_heap_bytes Heap memory used in bytes');
        lines.push('# TYPE process_heap_bytes gauge');
        lines.push(`process_heap_bytes ${mem.heapUsed}`);
        lines.push('');

        return lines.join('\n') + '\n';
    }
}
