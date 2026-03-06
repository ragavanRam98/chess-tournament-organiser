import {
    Injectable, ConflictException, NotFoundException,
    BadRequestException, HttpException, HttpStatus,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import { CreateRegistrationDto } from './dto/create-registration.dto';
import { differenceInYears } from 'date-fns';

@Injectable()
export class RegistrationsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly queue: QueueService,
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

        const category = tournament.categories.find(c => c.id === categoryId);
        if (!category) throw new NotFoundException('NOT_FOUND');

        // 2. Age validation
        const ageAtTournament = differenceInYears(tournament.startDate, new Date(dto.playerDob));
        if (ageAtTournament < category.minAge || ageAtTournament > category.maxAge) {
            throw new BadRequestException('VALIDATION_ERROR: Age does not meet category requirements');
        }

        // 3. Duplicate detection
        const duplicate = await this.prisma.registration.findFirst({
            where: { tournamentId, phone: dto.phone, status: { not: 'CANCELLED' } },
        });
        if (duplicate) throw new ConflictException('DUPLICATE_REGISTRATION');

        // 4. Seat locking + insert — all inside a serializable transaction
        const registration = await this.prisma.$transaction(async (tx) => {
            // SELECT FOR UPDATE on the category row to prevent concurrent overselling
            const locked = await tx.$queryRaw<Array<{ registered_count: number; max_seats: number }>>`
        SELECT registered_count, max_seats FROM categories WHERE id = ${categoryId} FOR UPDATE
      `;
            const cat = locked[0];
            if (cat.registered_count >= cat.max_seats) throw new ConflictException('SEAT_LIMIT_REACHED');

            // Generate human-readable entry number via DB sequence
            const seqResult = await tx.$queryRaw<[{ nextval: bigint }]>`SELECT nextval('entry_number_seq')`;
            const seq = seqResult[0].nextval.toString().padStart(6, '0');
            const year = new Date().getFullYear();
            const entryNumber = `ECA-${year}-${seq}`;

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
                    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours
                },
            });

            await tx.category.update({
                where: { id: categoryId },
                data: { registeredCount: { increment: 1 } },
            });

            return reg;
        });

        // 5. Create Razorpay order (handled by PaymentsService — injected or called here)
        //    Returning stub — PaymentsService.createOrder() called in full implementation
        return {
            data: {
                registration_id: registration.id,
                entry_number: registration.entryNumber,
                status: 'PENDING_PAYMENT',
                expires_at: registration.expiresAt,
                payment: { /* populated by PaymentsService */ },
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
