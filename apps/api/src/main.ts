import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { SentryExceptionFilter } from './common/filters/sentry-exception.filter';
import cookieParser = require('cookie-parser');

async function bootstrap() {
    const app = await NestFactory.create(AppModule, {
        // rawBody: true enables reading raw body for Razorpay webhook HMAC verification
        rawBody: true,
        bufferLogs: true,
    });

    // S7-4: Use Pino logger as the NestJS logger
    app.useLogger(app.get(Logger));

    // ── Global prefix ────────────────────────────────────────────────────────────
    app.setGlobalPrefix('api/v1');

    // ── Exception filter — S7-5: Sentry-aware uniform error shape ─────────────────
    app.useGlobalFilters(new SentryExceptionFilter());

    // ── Cookie parser (needed for httpOnly refresh token cookie) ─────────────────
    app.use(cookieParser());

    // ── Validation pipe — enforces all DTOs globally ──────────────────────────────
    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,        // strip unknown properties
            forbidNonWhitelisted: true,
            transform: true,        // auto-transform plain objects to DTO class instances
            transformOptions: { enableImplicitConversion: true },
        }),
    );

    // ── CORS — allow only the frontend origin ─────────────────────────────────────
    app.enableCors({
        origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
        credentials: true,
    });

    const port = process.env.PORT ?? 3001;
    await app.listen(port);
    console.warn(`[API] Running at http://localhost:${port}/api/v1`);
}

void bootstrap();
