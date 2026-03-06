// apps/api/src/users/dto/create-organizer.dto.ts
import { IsEmail, IsString, IsOptional, MinLength, MaxLength, Matches } from 'class-validator';

export class CreateOrganizerDto {
    @IsEmail()
    email: string;

    @IsString() @MinLength(8)
    password: string;

    @IsString() @MinLength(2) @MaxLength(255)
    academyName: string;

    @Matches(/^\+[1-9]\d{1,14}$/)
    contactPhone: string;

    @IsString() @MinLength(2) @MaxLength(100)
    city: string;

    @IsOptional() @IsString() @MaxLength(100)
    state?: string;

    @IsOptional() @IsString()
    description?: string;
}
