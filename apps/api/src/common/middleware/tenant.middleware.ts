import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * S1-4 — TenantMiddleware
 *
 * Decodes the JWT payload (without verifying — JwtAuthGuard handles that)
 * and attaches `organizerId` directly to `req.user` so every downstream
 * handler and service can read it without re-querying.
 *
 * Applied globally across all routes in AppModule.configure().
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
    use(req: Request, _res: Response, next: NextFunction) {
        const authHeader = req.headers['authorization'];
        if (authHeader?.startsWith('Bearer ')) {
            const token = authHeader.slice(7);
            try {
                // Decode payload only — signature verified by JwtAuthGuard later
                const payload = JSON.parse(
                    Buffer.from(token.split('.')[1], 'base64url').toString('utf-8'),
                ) as { sub?: string; role?: string; organizerId?: string };

                // Merge into req.user so JwtStrategy validate() can enrich it further
                // If req.user is already populated (e.g. by passport) we don't overwrite
                if (!req.user) {
                    (req as any).tenantHint = { sub: payload.sub, role: payload.role };
                }
            } catch {
                // Invalid JWT format — let JwtAuthGuard handle the 401
            }
        }
        next();
    }
}
