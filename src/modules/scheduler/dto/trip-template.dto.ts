import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

/**
 * DTO de création d'un TripTemplate (Module M PRD — Scheduler).
 *
 * Un template représente un trajet récurrent : `weekdays` indique les jours
 * de la semaine où le trip est généré automatiquement à 02h00 par
 * `SchedulerService.generateRecurringTrips`.
 */
export class CreateTripTemplateDto {
  @IsString()
  routeId!: string;

  /** Jours de la semaine — 0=dimanche, 6=samedi (ISO weekday RFC). */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekdays!: number[];

  /** Heure de départ HH:MM (24h). */
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'departureTime doit être au format HH:MM (24h)',
  })
  departureTime!: string;

  @IsOptional()
  @IsString()
  defaultBusId?: string;

  @IsOptional()
  @IsString()
  defaultDriverId?: string;

  /** Date à partir de laquelle le template ne doit plus générer de trip. */
  @IsOptional()
  @IsDateString()
  effectiveUntil?: string;
}

export class UpdateTripTemplateDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
