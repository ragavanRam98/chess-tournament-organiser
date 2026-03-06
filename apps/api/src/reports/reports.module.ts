import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';
import { StorageModule } from '../storage/storage.module';

@Module({ imports: [PrismaModule, QueueModule, StorageModule], controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule { }
