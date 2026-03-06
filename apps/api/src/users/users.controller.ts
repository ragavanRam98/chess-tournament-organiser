// apps/api/src/users/users.controller.ts
import { Controller, Post, Body } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateOrganizerDto } from './dto/create-organizer.dto';

@Controller('users')
export class UsersController {
    constructor(private readonly usersService: UsersService) { }

    /** POST /users/register — Organizer self-registration (creates PENDING_VERIFICATION account) */
    @Post('register')
    register(@Body() dto: CreateOrganizerDto) {
        return this.usersService.registerOrganizer(dto);
    }
}
