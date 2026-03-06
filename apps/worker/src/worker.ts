import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';

@Module({})
export class WorkerModule { }

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(WorkerModule);
    console.warn('[Worker] BullMQ Worker started...');
}

void bootstrap();
