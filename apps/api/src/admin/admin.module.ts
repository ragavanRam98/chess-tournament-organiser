import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';

@Module({ imports: [PrismaModule, QueueModule], controllers: [AdminController], providers: [AdminService] })
export class AdminModule { }
