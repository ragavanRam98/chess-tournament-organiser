// apps/api/src/tournaments/dto/create-tournament.dto.ts
import {
    IsString, IsDateString, IsArray, ValidateNested, IsInt, Min,
    IsOptional, ArrayMinSize, MinLength, MaxLength, Validate,
    ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments,
} from 'class-validator';
import { Type } from 'class-transformer';

// ── Custom validator: minAge must be less than maxAge ─────────────────────────
@ValidatorConstraint({ name: 'minAgeLessThanMaxAge', async: false })
class MinAgeLessThanMaxAge implements ValidatorConstraintInterface {
    validate(_: any, args: ValidationArguments) {
        const obj = args.object as CreateCategoryDto;
        return obj.minAge < obj.maxAge;
    }
    defaultMessage() {
        return 'minAge must be less than maxAge';
    }
}

export class CreateCategoryDto {
    @IsString() @MinLength(1) @MaxLength(50)
    name: string;

    @IsInt() @Min(0)
    minAge: number;

    @IsInt() @Min(0)
    @Validate(MinAgeLessThanMaxAge)
    maxAge: number;

    @IsInt() @Min(0)
    entryFeePaise: number;

    @IsInt() @Min(1)
    maxSeats: number;
}

// ── Custom validator: tournament date sanity checks ──────────────────────────
@ValidatorConstraint({ name: 'tournamentDates', async: false })
class TournamentDatesValidator implements ValidatorConstraintInterface {
    validate(_: any, args: ValidationArguments) {
        const obj = args.object as CreateTournamentDto;
        const now = new Date();
        now.setHours(0, 0, 0, 0); // compare date-only

        const start = new Date(obj.startDate);
        const end = new Date(obj.endDate);
        const deadline = new Date(obj.registrationDeadline);

        // All dates must be in the future
        if (start <= now) return false;
        if (end <= now) return false;
        if (deadline <= now) return false;

        // End date must be >= start date
        if (end < start) return false;

        // Registration deadline must be <= start date
        if (deadline > start) return false;

        return true;
    }
    defaultMessage(args: ValidationArguments) {
        const obj = args.object as CreateTournamentDto;
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const start = new Date(obj.startDate);
        const end = new Date(obj.endDate);
        const deadline = new Date(obj.registrationDeadline);

        if (start <= now) return 'startDate must be in the future';
        if (end <= now) return 'endDate must be in the future';
        if (deadline <= now) return 'registrationDeadline must be in the future';
        if (end < start) return 'endDate must be on or after startDate';
        if (deadline > start) return 'registrationDeadline must be on or before startDate';
        return 'Invalid tournament dates';
    }
}

export class CreateTournamentDto {
    @IsString() @MinLength(2) @MaxLength(255)
    title: string;

    @IsOptional() @IsString()
    description?: string;

    @IsString() @MinLength(2) @MaxLength(100)
    city: string;

    @IsString() @MinLength(2) @MaxLength(255)
    venue: string;

    @IsDateString()
    startDate: string;

    @IsDateString()
    endDate: string;

    @IsDateString()
    @Validate(TournamentDatesValidator)
    registrationDeadline: string;

    @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => CreateCategoryDto)
    categories: CreateCategoryDto[];
}
