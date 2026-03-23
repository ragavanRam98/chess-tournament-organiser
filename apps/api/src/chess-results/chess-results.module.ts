import { Module } from '@nestjs/common';
import { ChessResultsController } from './chess-results.controller';
import { ChessResultsService } from './chess-results.service';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [PrismaModule, QueueModule],
  controllers: [ChessResultsController],
  providers: [ChessResultsService],
  exports: [ChessResultsService],
})
export class ChessResultsModule {}
