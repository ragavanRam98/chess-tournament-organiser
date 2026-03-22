import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, Req } from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class AdminController {
    constructor(private readonly adminService: AdminService) { }

    @Get('tournaments')
    listTournaments(@Query() q: unknown) { return this.adminService.listTournaments(q); }

    @Patch('tournaments/:id/status')
    updateTournamentStatus(@Param('id') id: string, @Body() body: unknown, @Req() req: any) {
        return this.adminService.updateTournamentStatus(id, body, req.user?.sub ?? req.user?.id);
    }

    @Get('organizers')
    listOrganizers(@Query() q: unknown) { return this.adminService.listOrganizers(q); }

    @Patch('organizers/:id/verify')
    verifyOrganizer(@Param('id') id: string, @Req() req: any) {
        return this.adminService.verifyOrganizer(id, req.user?.sub ?? req.user?.id);
    }

    @Get('analytics')
    analytics() { return this.adminService.analytics(); }

    @Get('audit-logs')
    auditLogs(@Query() q: unknown) { return this.adminService.auditLogs(q); }

    @Post('registrations/:id/refund')
    refundRegistration(@Param('id') id: string, @Req() req: any) {
        return this.adminService.refundRegistration(id, req.user?.sub ?? req.user?.id);
    }

    @Get('integrity-check')
    integrityCheck() { return this.adminService.integrityCheck(); }
}
