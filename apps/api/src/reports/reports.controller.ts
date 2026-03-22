import { Controller, Post, Get, Param, Body, Req, UseGuards, HttpCode, ParseUUIDPipe } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('organizer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ORGANIZER')
export class ReportsController {
    constructor(private readonly reportsService: ReportsService) { }

    /** POST /organizer/tournaments/:id/exports — trigger async export */
    @Post('tournaments/:id/exports') @HttpCode(202)
    trigger(@Param('id') tournamentId: string, @Req() req: any, @Body() body: Record<string, unknown>) {
        return this.reportsService.triggerExport(tournamentId, req.user.organizerId, String(body['format'] ?? 'xlsx'));
    }

    /** GET /organizer/exports/:jobId — poll status + get signed download URL */
    @Get('exports/:jobId')
    status(@Param('jobId', new ParseUUIDPipe()) jobId: string, @Req() req: any) {
        return this.reportsService.getExportStatus(jobId, req.user.organizerId);
    }
}
