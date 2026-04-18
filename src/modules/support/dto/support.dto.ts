import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

// Catégories et priorités : enums techniques stables côté API.
// Les LABELS sont traduits côté frontend via i18n — rien n'est hardcodé UI.
export const SUPPORT_CATEGORIES = ['BUG', 'QUESTION', 'FEATURE_REQUEST', 'INCIDENT', 'BILLING', 'OTHER'] as const;
export type SupportCategory = typeof SUPPORT_CATEGORIES[number];

export const SUPPORT_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'] as const;
export type SupportPriority = typeof SUPPORT_PRIORITIES[number];

export const SUPPORT_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED'] as const;
export type SupportStatus = typeof SUPPORT_STATUSES[number];

export class CreateSupportTicketDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  description!: string;

  @IsOptional()
  @IsIn(SUPPORT_CATEGORIES as readonly string[])
  category?: SupportCategory;

  @IsOptional()
  @IsIn(SUPPORT_PRIORITIES as readonly string[])
  priority?: SupportPriority;
}

export class UpdateSupportTicketDto {
  @IsOptional()
  @IsIn(SUPPORT_STATUSES as readonly string[])
  status?: SupportStatus;

  @IsOptional()
  @IsIn(SUPPORT_PRIORITIES as readonly string[])
  priority?: SupportPriority;

  @IsOptional()
  @IsString()
  assignedToPlatformUserId?: string | null;
}

export class AddSupportMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(10_000)
  body!: string;

  @IsOptional()
  isInternal?: boolean;

  @IsOptional()
  attachments?: unknown[];
}
