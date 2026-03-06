// apps/api/src/tournaments/dto/create-tournament.dto.ts
import {
    IsString, IsDateString, IsArray, ValidateNested, IsInt, Min,
    IsOptional, ArrayMinSize, MinLength, MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCategoryDto {
    @IsString() @MinLength(1) @MaxLength(50)
    name: string;

    @IsInt() @Min(0)
    minAge: number;

    @IsInt() @Min(0)
    maxAge: number;

    @IsInt() @Min(0)
    entryFeePaise: number;

    @IsInt() @Min(1)
    maxSeats: number;
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
    registrationDeadline: string;

    @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => CreateCategoryDto)
    categories: CreateCategoryDto[];
}
