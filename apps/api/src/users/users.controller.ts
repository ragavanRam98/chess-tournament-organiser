// apps/api/src/users/users.controller.ts
import { Controller } from '@nestjs/common';
import { UsersService } from './users.service';

/**
 * UsersController — intentionally empty.
 *
 * The POST /users/register endpoint was removed because it duplicated
 * POST /auth/register without throttle or rate-limit protection.
 * Organizer self-registration is handled exclusively by AuthController.
 */
@Controller('users')
export class UsersController {
    constructor(private readonly usersService: UsersService) { }
}
