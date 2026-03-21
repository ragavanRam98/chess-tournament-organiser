import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import helmet from 'helmet';
import cookieParser = require('cookie-parser');

async function bootstrap() {
    const app = await NestFactory.create(AppModule, {
        rawBody: true,
    });

    // ── Security headers (helmet) — MUST be before all other middleware ──────────
    app.use(
        helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    scriptSrc: ["'self'", 'checkout.razorpay.com'],
                    frameSrc: ["'self'", 'api.razorpay.com'],
                    imgSrc: ["'self'", 'data:', '*.razorpay.com'],
                    connectSrc: ["'self'"],
                },
            },
            crossOriginEmbedderPolicy: false,
        }),
    );

    // ── Global prefix ────────────────────────────────────────────────────────────
    app.setGlobalPrefix('api/v1');

    // ── Exception filter — uniform error shape ────────────────────────────────────
    app.useGlobalFilters(new GlobalExceptionFilter());

    // ── Cookie parser (needed for httpOnly refresh token cookie) ─────────────────
    app.use(cookieParser());

    // ── Validation pipe — enforces all DTOs globally ──────────────────────────────
    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
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
