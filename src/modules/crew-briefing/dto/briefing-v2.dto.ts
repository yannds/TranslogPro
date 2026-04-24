import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsIn,
  IsArray,
  ValidateNested,
  Min,
  Max,
  MaxLength,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';

export const SIGNATURE_METHODS = ['PIN', 'DRAW', 'BIOMETRIC'] as const;

export class CheckedItemV2Dto {
  @IsString() itemId!: string;

  @IsBoolean() passed!: boolean;

  @IsOptional() @IsInt() @Min(0)
  qty?: number;

  @IsOptional() @IsString() @MaxLength(800)
  notes?: string;

  @IsOptional() @IsArray() @IsString({ each: true })
  evidenceKeys?: string[];
}

export class DriverSignatureDto {
  @IsIn(SIGNATURE_METHODS as unknown as string[])
  method!: (typeof SIGNATURE_METHODS)[number];

  @IsString()
  blob!: string; // DataURL (DRAW), hash PIN, token biométrique

  @IsString()
  acknowledgedById!: string; // User.id chauffeur
}

export class CoPilotSignatureDto {
  @IsString()
  staffId!: string;
}

export class CreateBriefingV2HttpDto {
  @IsString()
  assignmentId!: string;

  @IsOptional() @IsString()
  templateId?: string;

  @IsString()
  conductedById!: string; // Staff.id

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CheckedItemV2Dto)
  items!: CheckedItemV2Dto[];

  @ValidateNested()
  @Type(() => DriverSignatureDto)
  driverSignature!: DriverSignatureDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CoPilotSignatureDto)
  coPilotSignature?: CoPilotSignatureDto;

  @IsOptional() @IsString() @MaxLength(2000)
  briefingNotes?: string;

  @IsOptional() @IsNumber() @Min(-90) @Max(90)
  gpsLat?: number;

  @IsOptional() @IsNumber() @Min(-180) @Max(180)
  gpsLng?: number;

  @IsOptional() @IsString() @MaxLength(1000)
  overrideReason?: string;

  @IsOptional() @IsString()
  overriddenById?: string; // User.id manager
}

export class ResolveSafetyAlertDto {
  @IsString()
  resolvedById!: string;

  @IsOptional() @IsString() @MaxLength(2000)
  resolutionNote?: string;
}
