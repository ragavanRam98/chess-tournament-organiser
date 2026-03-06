// apps/api/src/registrations/dto/create-registration.dto.ts
import {
    IsString, IsDateString, IsPhoneNumber, IsEmail, IsOptional,
    IsInt, Min, Max, MinLength, MaxLength, Matches,
} from 'class-validator';

export class CreateRegistrationDto {
    @IsString() @MinLength(2) @MaxLength(100)
    playerName: string;

    @IsDateString()
    playerDob: string;

    @Matches(/^\+[1-9]\d{1,14}$/, { message: 'Phone must be E.164 format' })
    phone: string;

    @IsOptional() @IsEmail()
    email?: string;

    @IsOptional() @IsString() @MinLength(2) @MaxLength(100)
    city?: string;

    @IsOptional() @IsString() @MaxLength(20)
    fideId?: string;

    @IsOptional() @IsInt() @Min(0) @Max(3500)
    fideRating?: number;
}
