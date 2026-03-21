import { Controller, Post, Get, Param, Body, UseGuards, HttpCode } from '@nestjs/common';
import { RegistrationsService } from './registrations.service';
import { CreateRegistrationDto } from './dto/create-registration.dto';
import { RegistrationRateLimitGuard } from './guards/registration-rate-limit.guard';

@Controller()
export class RegistrationsController {
    constructor(private readonly registrationsService: RegistrationsService) { }

    /**
     * POST /tournaments/:id/categories/:catId/register — public, no auth
     * S3-4: RegistrationRateLimitGuard enforces 3 attempts/hour per phone per tournament
     */
    @Post('tournaments/:id/categories/:catId/register')
    @UseGuards(RegistrationRateLimitGuard)
    @HttpCode(201)
    register(
        @Param('id') tournamentId: string,
        @Param('catId') categoryId: string,
        @Body() dto: CreateRegistrationDto,
    ) {
        return this.registrationsService.register(tournamentId, categoryId, dto);
    }

    /**
     * GET /tournaments/:id/participants — public, no auth required.
     * Returns entry_number, player_name, city, category for CONFIRMED registrations only.
     * PII (phone, email, DOB, FIDE ID, payment) is never exposed.
     */
    @Get('tournaments/:id/participants')
    participants(@Param('id') tournamentId: string) {
        return this.registrationsService.getPublicParticipants(tournamentId);
    }

    /** GET /registrations/:entryNumber/status — public status check */
    @Get('registrations/:entryNumber/status')
    status(@Param('entryNumber') entryNumber: string) {
        return this.registrationsService.getStatus(entryNumber);
    }
}
