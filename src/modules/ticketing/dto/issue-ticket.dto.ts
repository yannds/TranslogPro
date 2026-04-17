import { IsString, IsOptional, IsInt, IsEnum, IsBoolean, IsArray, ValidateNested, Min, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';

export enum FareClass {
  STANDARD = 'STANDARD',
  CONFORT  = 'CONFORT',
  VIP      = 'VIP',
  STANDING = 'STANDING',
}

export class IssueTicketDto {
  @IsString()
  tripId: string;

  @IsString()
  passengerName: string;

  @IsString()
  passengerPhone: string;

  @IsEnum(FareClass)
  fareClass: FareClass;

  @IsString()
  @IsOptional()
  boardingStationId?: string;   // défaut = route.originId

  @IsString()
  alightingStationId: string;   // obligatoire — gare de descente

  @IsString()
  @IsOptional()
  seatNumber?: string;

  @IsBoolean()
  @IsOptional()
  wantsSeatSelection?: boolean; // true = le passager paie l'option choix de siège

  @IsInt() @Min(0)
  @IsOptional()
  luggageKg?: number;

  @IsString()
  @IsOptional()
  discountCode?: string;

  @IsString()
  @IsOptional()
  paymentMethod?: string;
}

// ── Batch (achat groupé) ─────────────────────────────────────────────────────

export class BatchPassengerDto {
  @IsString()
  passengerName: string;

  @IsString()
  passengerPhone: string;

  @IsEnum(FareClass)
  fareClass: FareClass;

  @IsString()
  @IsOptional()
  boardingStationId?: string;

  @IsString()
  alightingStationId: string;

  @IsString()
  @IsOptional()
  seatNumber?: string;

  @IsBoolean()
  @IsOptional()
  wantsSeatSelection?: boolean;

  @IsInt() @Min(0)
  @IsOptional()
  luggageKg?: number;
}

export class IssueBatchDto {
  @IsString()
  tripId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchPassengerDto)
  @ArrayMinSize(1)
  passengers: BatchPassengerDto[];

  @IsString()
  @IsOptional()
  discountCode?: string;

  @IsString()
  @IsOptional()
  paymentMethod?: string;
}

export class ConfirmBatchDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  ticketIds: string[];
}
