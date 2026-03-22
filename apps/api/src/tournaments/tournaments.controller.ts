import {
    Controller, Get, Post, Patch, Param, Body, Query, Req,
    UseGuards, HttpCode, UseInterceptors, UploadedFile, ParseFilePipe,
    MaxFileSizeValidator, FileTypeValidator, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { TournamentsService } from './tournaments.service';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { UpdateTournamentDto } from './dto/update-tournament.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { OrganizerOwnershipGuard } from '../auth/guards/organizer-ownership.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller()
export class TournamentsController {
    constructor(private readonly tournamentsService: TournamentsService) { }

    // ── Organizer routes (require ORGANIZER role) ──────────────────────────────

    @Get('organizer/tournaments')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ORGANIZER')
    listMine(@Req() req: any, @Query() query: unknown) {
        return this.tournamentsService.listByOrganizer(req.user.organizerId, query);
    }

    @Post('organizer/tournaments')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ORGANIZER')
    @HttpCode(201)
    create(@Req() req: any, @Body() dto: CreateTournamentDto) {
        return this.tournamentsService.create(req.user.organizerId, dto);
    }

    /** S1-4: OrganizerOwnershipGuard ensures the tournament belongs to the requesting organizer */
    @Get('organizer/tournaments/:id')
    @UseGuards(JwtAuthGuard, RolesGuard, OrganizerOwnershipGuard)
    @Roles('ORGANIZER')
    findOne(@Req() req: any, @Param('id') id: string) {
        return this.tournamentsService.findOneForOrganizer(id, req.user.organizerId);
    }

    /** GET /organizer/tournaments/:id/registrations — paginated participant list with search/filter/sort */
    @Get('organizer/tournaments/:id/registrations')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ORGANIZER')
    listRegistrations(@Req() req: any, @Param('id') id: string, @Query() query: Record<string, string>) {
        return this.tournamentsService.listRegistrationsForOrganizer(id, req.user.organizerId, query);
    }

    @Patch('organizer/tournaments/:id')
    @UseGuards(JwtAuthGuard, RolesGuard, OrganizerOwnershipGuard)
    @Roles('ORGANIZER')
    update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateTournamentDto) {
        return this.tournamentsService.update(id, req.user.organizerId, dto);
    }

    @Post('organizer/tournaments/:id/submit')
    @UseGuards(JwtAuthGuard, RolesGuard, OrganizerOwnershipGuard)
    @Roles('ORGANIZER')
    @HttpCode(200)
    submit(@Req() req: any, @Param('id') id: string) {
        return this.tournamentsService.submitForApproval(id, req.user.organizerId);
    }

    @Post('organizer/tournaments/:id/poster')
    @UseGuards(JwtAuthGuard, RolesGuard, OrganizerOwnershipGuard)
    @Roles('ORGANIZER')
    @UseInterceptors(FileInterceptor('poster'))
    @HttpCode(200)
    uploadPoster(
        @Param('id') id: string,
        @Req() req: any,
        @UploadedFile(
            new ParseFilePipe({
                validators: [
                    new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }), // 5 MB
                    new FileTypeValidator({ fileType: /^image\/(jpeg|png|webp)$/ }),
                ],
            }),
        )
        file: Express.Multer.File,
    ) {
        return this.tournamentsService.uploadPoster(id, req.user.organizerId, file);
    }

    // ── Public routes (no auth required) ──────────────────────────────────────

    @Get('tournaments')
    listPublic(@Query() query: unknown) {
        return this.tournamentsService.listPublic(query);
    }

    @Get('tournaments/:id')
    findPublic(@Param('id') id: string) {
        return this.tournamentsService.findPublic(id);
    }
}
