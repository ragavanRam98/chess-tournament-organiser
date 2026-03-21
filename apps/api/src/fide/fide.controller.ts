// apps/api/src/fide/fide.controller.ts
import {
  Controller, Get, Post, Query, UseGuards, BadRequestException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FideService } from './fide.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('fide')
export class FideController {
  constructor(private readonly fideService: FideService) {}

  /** GET /fide/lookup?fide_id=12345678 — public, 30 req/min per IP */
  @Get('lookup')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  lookup(@Query('fide_id') fideId: string) {
    if (!fideId || !/^\d{1,20}$/.test(fideId.trim())) {
      throw new BadRequestException('Invalid FIDE ID format — must be numeric');
    }
    return this.fideService.lookupById(fideId.trim());
  }

  /**
   * GET /fide/status — admin-only, returns sync metadata.
   * Useful for monitoring: how many players are in the DB, when last synced.
   */
  @Get('status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  status() {
    return this.fideService.getSyncStatus();
  }

  /**
   * POST /fide/sync — admin-only, manually trigger an out-of-schedule FIDE sync.
   * Use after FIDE publishes a mid-month update or to bootstrap the DB on first deploy.
   */
  @Post('sync')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  triggerSync() {
    return this.fideService.triggerSync();
  }
}
