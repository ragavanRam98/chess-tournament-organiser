import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TournamentsModule } from './tournaments/tournaments.module';
import { RegistrationsModule } from './registrations/registrations.module';
import { PaymentsModule } from './payments/payments.module';
import { ReportsModule } from './reports/reports.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AdminModule } from './admin/admin.module';
import { QueueModule } from './queue/queue.module';
import { StorageModule } from './storage/storage.module';
import { HealthController } from './health/health.controller';
import { TenantMiddleware } from './common/middleware/tenant.middleware';

// S7-4: Pino structured logging
import { LoggerConfigModule } from './common/logger/logger.module';
// S7-5: Sentry error tracking
import { SentryModule } from './common/sentry/sentry.module';
// S7-6: Prometheus metrics
import { MetricsModule } from './metrics/metrics.module';
import { MetricsInterceptor } from './metrics/metrics.interceptor';

@Module({
    imports: [
        // ── Config (loads .env) ──────────────────────────────────────────────────
        ConfigModule.forRoot({ isGlobal: true }),

        // ── Observability ────────────────────────────────────────────────────────
        LoggerConfigModule,  // S7-4: Pino structured logging
        SentryModule,        // S7-5: Sentry error tracking
        MetricsModule,       // S7-6: Prometheus /metrics endpoint

        // ── Infrastructure ────────────────────────────────────────────────────────
        PrismaModule,
        QueueModule,
        StorageModule,

        // ── Feature modules ───────────────────────────────────────────────────────
        AuthModule,
        UsersModule,
        TournamentsModule,
        RegistrationsModule,
        PaymentsModule,
        ReportsModule,
        NotificationsModule,
        AdminModule,
    ],
    controllers: [HealthController],
    providers: [
        // S7-6: Global HTTP metrics interceptor
        { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
    ],
})
export class AppModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        // S1-4: Apply TenantMiddleware globally to decode organizerId hint from JWT
        consumer.apply(TenantMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
    }
}
