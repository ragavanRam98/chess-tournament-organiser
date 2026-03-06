// apps/api/src/users/users.controller.ts
import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateOrganizerDto } from './dto/create-organizer.dto';

@Controller('users')
export class UsersController {
    constructor(private readonly usersService: UsersService) { }

    /** POST /users/register — Organizer self-registration (creates PENDING_VERIFICATION account) */
    @Post('register')
    @HttpCode(201)
    register(@Body() dto: CreateOrganizerDto) {
        return this.usersService.registerOrganizer(dto);
    }
}
