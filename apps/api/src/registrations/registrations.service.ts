import {
    Injectable,
    ConflictException,
    NotFoundException,
    BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { PaymentsService } from '../payments/payments.service';
import { CreateRegistrationDto } from './dto/create-registration.dto';
import { differenceInYears } from 'date-fns';

@Injectable()
export class RegistrationsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly queue: QueueService,
        private readonly payments: PaymentsService,
    ) { }

    async register(tournamentId: string, categoryId: string, dto: CreateRegistrationDto) {
        // 1. Load tournament + category
        const tournament = await this.prisma.tournament.findUnique({
            where: { id: tournamentId },
            include: { categories: true },
        });
        if (!tournament) throw new NotFoundException('NOT_FOUND');
        if (!['APPROVED', 'ACTIVE'].includes(tournament.status)) {
            throw new ConflictException('TOURNAMENT_NOT_ACCEPTING');
        }

        const category = tournament.categories.find((c) => c.id === categoryId);
        if (!category) throw new NotFoundException('NOT_FOUND');

        // 2. Age validation (age at tournament start date)
        const ageAtTournament = differenceInYears(tournament.startDate, new Date(dto.playerDob));
        if (ageAtTournament < category.minAge || ageAtTournament > category.maxAge) {
            throw new BadRequestException('Age does not meet category requirements');
        }

        // 3. Duplicate detection — same phone in same tournament (non-cancelled)
        const duplicate = await this.prisma.registration.findFirst({
            where: { tournamentId, phone: dto.phone, status: { not: 'CANCELLED' } },
        });
        if (duplicate) throw new ConflictException('DUPLICATE_REGISTRATION');

        // 4. Seat locking + insert — SELECT FOR UPDATE prevents concurrent overselling
        const registration = await this.prisma.$transaction(async (tx) => {
            const locked = await tx.$queryRaw<Array<{ registered_count: number; max_seats: number }>>`
        SELECT registered_count, max_seats FROM categories WHERE id = ${categoryId} FOR UPDATE
      `;
            const cat = locked[0];
            if (cat.registered_count >= cat.max_seats) throw new ConflictException('SEAT_LIMIT_REACHED');

            // Generate human-readable entry number via DB sequence
            const seqResult = await tx.$queryRaw<[{ nextval: bigint }]>`SELECT nextval('entry_number_seq')`;
            const seq = seqResult[0].nextval.toString().padStart(6, '0');
            const year = new Date().getFullYear();
            const entryNumber = `KS-${year}-${seq}`;

            const reg = await tx.registration.create({
                data: {
                    tournamentId,
                    categoryId,
                    playerName: dto.playerName,
                    playerDob: new Date(dto.playerDob),
                    phone: dto.phone,
                    email: dto.email,
                    city: dto.city,
                    fideId: dto.fideId,
                    fideRating: dto.fideRating,
                    entryNumber,
                    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2-hour payment window
                },
            });

            await tx.category.update({
                where: { id: categoryId },
                data: { registeredCount: { increment: 1 } },
            });

            return reg;
        });

        // 5. Create Razorpay order and persist Payment record
        const paymentDetails = await this.payments.createOrder(
            registration.id,
            category.entryFeePaise,
        );

        return {
            data: {
                registration_id: registration.id,
                entry_number: registration.entryNumber,
                status: 'PENDING_PAYMENT',
                expires_at: registration.expiresAt,
                payment: paymentDetails,
            },
        };
    }

    /**
     * GET /tournaments/:id/participants — public, no auth required.
     *
     * Returns only CONFIRMED registrations. Deliberately omits PII:
     * phone, email, player_dob, fide_id, fide_rating, payment details.
     * Safe to expose publicly — same data class as a physical notice board
     * at the tournament venue.
     */
    async getPublicParticipants(tournamentId: string) {
        const tournament = await this.prisma.tournament.findUnique({
            where: { id: tournamentId },
            include: {
                categories: {
                    select: { id: true, name: true, maxSeats: true, registeredCount: true },
                    orderBy: { minAge: 'asc' },
                },
            },
        });
        if (!tournament) throw new NotFoundException('NOT_FOUND');

        // Only show participant lists for approved/active/closed tournaments
        if (!['APPROVED', 'ACTIVE', 'CLOSED'].includes(tournament.status)) {
            return {
                data: { participants: [], meta: { status: tournament.status, message: 'Registration not yet open' } },
            };
        }

        const registrations = await this.prisma.registration.findMany({
            where: { tournamentId, status: 'CONFIRMED' },
            include: { category: { select: { name: true } } },
            orderBy: [{ category: { minAge: 'asc' } }, { entryNumber: 'asc' }],
        });

        const participants = registrations.map(r => ({
            entry_number: r.entryNumber,
            player_name: r.playerName,
            city: r.city ?? '—',
            category: r.category.name,
        }));

        const byCategory = tournament.categories.map(c => ({
            name: c.name,
            registered: c.registeredCount,
            max_seats: c.maxSeats,
            seats_remaining: Math.max(0, c.maxSeats - c.registeredCount),
        }));

        return {
            data: {
                participants,
                meta: {
                    total_confirmed: participants.length,
                    total_seats: tournament.categories.reduce((s, c) => s + c.maxSeats, 0),
                    by_category: byCategory,
                },
            },
        };
    }

    async getStatus(entryNumber: string) {
        const reg = await this.prisma.registration.findUnique({
            where: { entryNumber },
            include: {
                tournament: { select: { title: true, startDate: true } },
                category: { select: { name: true } },
            },
        });
        if (!reg) throw new NotFoundException('NOT_FOUND');
        return {
            data: {
                entry_number: reg.entryNumber,
                player_name: reg.playerName,
                tournament: { title: reg.tournament.title, start_date: reg.tournament.startDate },
                category: reg.category.name,
                status: reg.status,
                confirmed_at: reg.confirmedAt,
            },
        };
    }
}
