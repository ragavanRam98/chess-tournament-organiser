import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CategoriesService {
    constructor(private readonly prisma: PrismaService) { }

    async createMany(tournamentId: string, categories: any[]) {
        // TODO: bulk insert categories for a tournament
        throw new Error('Not implemented');
    }
}
