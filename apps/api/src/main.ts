import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cookieParser = require('cookie-parser') as () => unknown;

async function bootstrap() {
    const app = await NestFactory.create(AppModule, {
        // rawBody: true enables reading raw body for Razorpay webhook HMAC verification
        rawBody: true,
        bufferLogs: true,
    });

    // ── Global prefix ────────────────────────────────────────────────────────────
    app.setGlobalPrefix('api/v1');

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
