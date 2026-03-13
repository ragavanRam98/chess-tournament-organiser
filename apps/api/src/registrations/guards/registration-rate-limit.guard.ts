import {
    Injectable,
    CanActivate,
    ExecutionContext,
    HttpException,
    HttpStatus,
} from '@nestjs/common';
import Redis from 'ioredis';

const MAX_ATTEMPTS = 3;
const WINDOW_SECONDS = 3600; // 1 hour

/**
 * S3-4 — RegistrationRateLimitGuard
 *
 * Limits registration attempts per phone per tournament to 3 per hour.
 * Uses Redis INCR + EXPIRE pattern:
 *   key: rate:reg:{tournamentId}:{phone}
 *   On 4th attempt within the window → 429 Too Many Requests
 */
@Injectable()
export class RegistrationRateLimitGuard implements CanActivate {
    constructor(private readonly redis: Redis) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest();
        const tournamentId: string = req.params['id'];
        const phone: string | undefined = req.body?.phone;

        // If phone is missing, let the DTO validation handle it downstream
        if (!phone || !tournamentId) return true;

        const key = `rate:reg:${tournamentId}:${phone}`;
        const count = await this.redis.incr(key);

        // Set TTL only on first increment (avoid resetting the window on each attempt)
        if (count === 1) {
            await this.redis.expire(key, WINDOW_SECONDS);
        }

        if (count > MAX_ATTEMPTS) {
            throw new HttpException(
                {
                    error: {
                        code: 'TOO_MANY_REQUESTS',
                        message: `Maximum ${MAX_ATTEMPTS} registration attempts per hour exceeded for this phone number.`,
                    },
                },
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }

        return true;
    }
}
