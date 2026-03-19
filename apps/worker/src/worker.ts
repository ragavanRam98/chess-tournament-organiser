import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
import { Logger } from '@nestjs/common';

const logger = new Logger('Bootstrap');

async function bootstrap() {
  // S5-2: Use createApplicationContext (no HTTP server needed)
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['log', 'warn', 'error', 'debug'],
  });

  logger.log('✅ Worker started — BullMQ processors active');
  logger.log('   Cron schedulers: PAYMENT_RECONCILE every 15 min, PURGE_EXPIRED every 15 min');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.log(`Received ${signal} — shutting down worker gracefully...`);
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

void bootstrap();
