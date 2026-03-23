import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { ChessResultsService } from './chess-results.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { OrganizerOwnershipGuard } from '../auth/guards/organizer-ownership.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller()
export class ChessResultsController {
  constructor(private readonly chessResultsService: ChessResultsService) {}

  // ── Organizer endpoints (protected) ────────────────────────────────────

  @Post('organizer/tournaments/:id/chess-results')
  @UseGuards(JwtAuthGuard, RolesGuard, OrganizerOwnershipGuard)
  @Roles('ORGANIZER')
  createLink(
    @Param('id') tournamentId: string,
    @Body() body: { categoryId?: string; chessResultsUrl: string },
  ) {
    return this.chessResultsService.createLink({
      tournamentId,
      categoryId: body.categoryId,
      chessResultsUrl: body.chessResultsUrl,
    });
  }

  @Get('organizer/tournaments/:id/chess-results')
  @UseGuards(JwtAuthGuard, RolesGuard, OrganizerOwnershipGuard)
  @Roles('ORGANIZER')
  getLinks(@Param('id') tournamentId: string) {
    return this.chessResultsService.getLinks(tournamentId);
  }

  @Delete('organizer/tournaments/:id/chess-results/:linkId')
  @UseGuards(JwtAuthGuard, RolesGuard, OrganizerOwnershipGuard)
  @Roles('ORGANIZER')
  @HttpCode(200)
  removeLink(@Param('linkId') linkId: string) {
    return this.chessResultsService.removeLink(linkId);
  }

  @Post('organizer/tournaments/:id/chess-results/:linkId/sync')
  @UseGuards(JwtAuthGuard, RolesGuard, OrganizerOwnershipGuard)
  @Roles('ORGANIZER')
  @HttpCode(200)
  triggerSync(@Param('linkId') linkId: string) {
    return this.chessResultsService.triggerSync(linkId);
  }

  // ── Public endpoint ────────────────────────────────────────────────────

  @Get('tournaments/:id/live')
  getLiveData(@Param('id') tournamentId: string) {
    return this.chessResultsService.getLiveData(tournamentId);
  }
}
