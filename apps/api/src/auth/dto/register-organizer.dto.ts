import { IsEmail, IsString, MinLength, MaxLength, IsOptional } from 'class-validator';

export class RegisterOrganizerDto {
    @IsEmail()
    email: string;

    @IsString()
    @MinLength(8)
    @MaxLength(64)
    password: string;

    @IsString()
    @MinLength(2)
    @MaxLength(120)
    academyName: string;

    @IsString()
    @MinLength(10)
    @MaxLength(20)
    contactPhone: string;

    @IsString()
    @MinLength(2)
    @MaxLength(60)
    city: string;

    @IsString()
    @MinLength(2)
    @MaxLength(60)
    state: string;

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    description?: string;
}
