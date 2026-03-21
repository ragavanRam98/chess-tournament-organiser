// apps/api/src/auth/auth.controller.ts
import { Controller, Post, Get, Body, Res, Req, UseGuards, HttpCode } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterOrganizerDto } from './dto/register-organizer.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    /** POST /auth/register — self-registration for new organizers (status: PENDING_VERIFICATION) */
    @Post('register')
    @Throttle({ default: { limit: 3, ttl: 60000 } })
    @HttpCode(201)
    async register(@Body() dto: RegisterOrganizerDto) {
        return this.authService.registerOrganizer(dto);
    }

    /** POST /auth/login — 5 attempts per minute — brute force protection */
    @Post('login')
    @Throttle({ default: { limit: 5, ttl: 60000 } })
    @HttpCode(200)
    async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
        return this.authService.login(dto, res);
    }

    /** POST /auth/refresh — rotates access token using httpOnly refresh cookie */
    @Post('refresh')
    @HttpCode(200)
    async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
        return this.authService.refresh(req, res);
    }

    /** POST /auth/logout — revokes refresh token session */
    @Post('logout')
    @UseGuards(JwtAuthGuard)
    @HttpCode(200)
    async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
        return this.authService.logout(req, res);
    }

    /**
     * GET /auth/me — returns the authenticated user's profile for the nav header.
     * Returns: id, email, role, displayName (academyName for organizers, "Super Admin" for admins).
     * Used by the frontend NavHeader to show the role-aware avatar without storing sensitive
     * data in the JWT payload.
     */
    @Get('me')
    @UseGuards(JwtAuthGuard)
    async me(@Req() req: any) {
        return this.authService.getMe(req.user.id);
    }
}
