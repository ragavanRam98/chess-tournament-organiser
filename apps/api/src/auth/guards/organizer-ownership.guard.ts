import {
    Injectable,
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * S1-4 — OrganizerOwnershipGuard
 *
 * Verifies that the tournament identified by `:id` in the route params
 * belongs to the authenticated organizer (req.user.organizerId).
 *
 * Returns 403 FORBIDDEN if the record belongs to a different organizer.
 * Returns 404 NOT_FOUND if the tournament doesn't exist at all.
 *
 * Apply at method level on organizer-scoped single-resource routes.
 */
@Injectable()
export class OrganizerOwnershipGuard implements CanActivate {
    constructor(private readonly prisma: PrismaService) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest();
        const tournamentId: string = req.params['id'];
        const organizerId: string = req.user?.organizerId;

        if (!organizerId) {
            throw new ForbiddenException('FORBIDDEN');
        }

        const tournament = await this.prisma.tournament.findUnique({
            where: { id: tournamentId },
            select: { organizerId: true },
        });

        if (!tournament) {
            throw new NotFoundException('NOT_FOUND');
        }

        if (tournament.organizerId !== organizerId) {
            throw new ForbiddenException('FORBIDDEN');
        }

        return true;
    }
}
