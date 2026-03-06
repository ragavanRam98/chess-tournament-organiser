import { Module as NestModule } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';

@NestModule({ imports: [PrismaModule, QueueModule], providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule { }
