import { Module } from '@nestjs/common';
import { RegistrationsController } from './registrations.controller';
import { RegistrationsService } from './registrations.service';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';
import { PaymentsModule } from '../payments/payments.module';
import { RegistrationRateLimitGuard } from './guards/registration-rate-limit.guard';
import Redis from 'ioredis';

const REDIS_CLIENT = 'REDIS_CLIENT';

@Module({
    imports: [PrismaModule, QueueModule, PaymentsModule],
    controllers: [RegistrationsController],
    providers: [
        RegistrationsService,
        {
            provide: REDIS_CLIENT,
            useFactory: () => new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379'),
        },
        {
            provide: RegistrationRateLimitGuard,
            useFactory: (redis: Redis) => new RegistrationRateLimitGuard(redis),
            inject: [REDIS_CLIENT],
        },
    ],
    exports: [RegistrationsService],
})
export class RegistrationsModule { }
