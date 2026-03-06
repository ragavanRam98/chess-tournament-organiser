// apps/api/src/tournaments/dto/update-tournament.dto.ts
import { PartialType } from '@nestjs/mapped-types';
import { CreateTournamentDto } from './create-tournament.dto';

/** Partial tournament update — only DRAFT tournaments may be updated */
export class UpdateTournamentDto extends PartialType(CreateTournamentDto) { }
