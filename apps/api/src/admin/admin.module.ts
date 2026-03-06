import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PrismaModule } from '../prisma/prisma.module';
import { TournamentsModule } from '../tournaments/tournaments.module';

@Module({
    imports: [PrismaModule, TournamentsModule],
    controllers: [AdminController],
    providers: [AdminService],
})
export class AdminModule { }
