import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PrismaModule } from '../prisma/prisma.module';
import { TournamentsModule } from '../tournaments/tournaments.module';
import { QueueModule } from '../queue/queue.module';

@Module({
    imports: [PrismaModule, TournamentsModule, QueueModule],
    controllers: [AdminController],
    providers: [AdminService],
})
export class AdminModule { }
