import { Controller, Post, Get, Param, Body } from '@nestjs/common';
import { RegistrationsService } from './registrations.service';
import { CreateRegistrationDto } from './dto/create-registration.dto';

@Controller()
export class RegistrationsController {
    constructor(private readonly registrationsService: RegistrationsService) { }

    /** POST /tournaments/:id/categories/:catId/register — public, no auth */
    @Post('tournaments/:id/categories/:catId/register')
    register(
        @Param('id') tournamentId: string,
        @Param('catId') categoryId: string,
        @Body() dto: CreateRegistrationDto,
    ) {
        return this.registrationsService.register(tournamentId, categoryId, dto);
    }

    /** GET /registrations/:entryNumber/status — public status check */
    @Get('registrations/:entryNumber/status')
    status(@Param('entryNumber') entryNumber: string) {
        return this.registrationsService.getStatus(entryNumber);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
