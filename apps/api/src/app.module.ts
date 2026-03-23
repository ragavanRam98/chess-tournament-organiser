import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
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
import { FideModule } from './fide/fide.module';
import { ChessResultsModule } from './chess-results/chess-results.module';
import { HealthController } from './health/health.controller';
import { TenantMiddleware } from './common/middleware/tenant.middleware';

@Module({
    imports: [
        // ── Config (loads .env) ──────────────────────────────────────────────────
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: ['.env', '../../.env'],
        }),

        // ── Rate limiting — 20 req/min per IP default ────────────────────────────
        ThrottlerModule.forRoot([{
            ttl: 60000,
            limit: 20,
        }]),

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
        FideModule,
        ChessResultsModule,
    ],
    controllers: [HealthController],
    providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
    ],
})
export class AppModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer.apply(TenantMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
    }
}
