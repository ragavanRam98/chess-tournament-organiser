import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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

// S7-6: Prometheus metrics
import { MetricsModule } from './metrics/metrics.module';

@Module({
    imports: [
        // ── Config (loads .env) ──────────────────────────────────────────────────
        ConfigModule.forRoot({ isGlobal: true }),

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
})
export class AppModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer.apply(TenantMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
    }
}
