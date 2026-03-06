// apps/api/src/users/users.service.ts
import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrganizerDto } from './dto/create-organizer.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
    constructor(private readonly prisma: PrismaService) { }

    async registerOrganizer(dto: CreateOrganizerDto) {
        const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
        if (existing) throw new ConflictException('Email already registered');

        const passwordHash = await bcrypt.hash(dto.password, 12);

        const user = await this.prisma.user.create({
            data: {
                email: dto.email,
                passwordHash,
                role: 'ORGANIZER',
                status: 'PENDING_VERIFICATION',
                organizer: {
                    create: {
                        academyName: dto.academyName,
                        contactPhone: dto.contactPhone,
                        city: dto.city,
                        state: dto.state,
                        description: dto.description,
                    },
                },
            },
        });

        return { data: { id: user.id, email: user.email, status: user.status } };
    }
}
