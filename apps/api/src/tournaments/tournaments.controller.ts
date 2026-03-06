import { Controller, Get, Post, Patch, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { TournamentsService } from './tournaments.service';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { UpdateTournamentDto } from './dto/update-tournament.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class TournamentsController {
    constructor(private readonly tournamentsService: TournamentsService) { }

    // ── Organizer routes ────────────────────────────────────────────────────────
    @Get('organizer/tournaments')
    @Roles('ORGANIZER')
    listMine(@Req() req: any, @Query() query: unknown) {
        return this.tournamentsService.listByOrganizer(req.user.organizerId, query);
    }

    @Post('organizer/tournaments')
    @Roles('ORGANIZER')
    create(@Req() req: any, @Body() dto: CreateTournamentDto) {
        return this.tournamentsService.create(req.user.organizerId, dto);
    }

    @Get('organizer/tournaments/:id')
    @Roles('ORGANIZER')
    findOne(@Req() req: any, @Param('id') id: string) {
        return this.tournamentsService.findOneForOrganizer(id, req.user.organizerId);
    }

    @Patch('organizer/tournaments/:id')
    @Roles('ORGANIZER')
    update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateTournamentDto) {
        return this.tournamentsService.update(id, req.user.organizerId, dto);
    }

    // ── Public routes ───────────────────────────────────────────────────────────
    @Get('tournaments')
    listPublic(@Query() query: unknown) {
        return this.tournamentsService.listPublic(query);
    }

    @Get('tournaments/:id')
    findPublic(@Param('id') id: string) {
        return this.tournamentsService.findPublic(id);
    }
}

