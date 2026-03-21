import { Module } from '@nestjs/common';
import { TournamentsController } from './tournaments.controller';
import { TournamentsService } from './tournaments.service';
import { CategoriesService } from './categories.service';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';
import { StorageModule } from '../storage/storage.module';
import { OrganizerOwnershipGuard } from '../auth/guards/organizer-ownership.guard';

@Module({
    imports: [PrismaModule, QueueModule, StorageModule],
    controllers: [TournamentsController],
    providers: [TournamentsService, CategoriesService, OrganizerOwnershipGuard],
    exports: [TournamentsService],
})
export class TournamentsModule { }
