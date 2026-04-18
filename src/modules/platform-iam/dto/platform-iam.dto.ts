import { IsOptional, IsString, IsUUID, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Filtres AuditLog cross-tenant. Tous optionnels.
 *   - tenantId : scopage à un tenant donné ; sans ce filtre, retourne toutes lignes.
 *   - level    : info | warn | critical (enum libre côté DB).
 *   - action   : LIKE insensitive.
 *   - userId   : actor strict.
 *   - from/to  : bornes createdAt (ISO 8601).
 */
export class PlatformAuditQueryDto {
  @IsOptional() @IsUUID()
  tenantId?: string;

  @IsOptional() @IsString()
  level?: string;

  @IsOptional() @IsString()
  action?: string;

  @IsOptional() @IsUUID()
  userId?: string;

  @IsOptional() @IsString()
  from?: string;

  @IsOptional() @IsString()
  to?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  limit?: number;
}

/** Filtres pour la liste cross-tenant des users (diagnostic support). */
export class PlatformUsersQueryDto {
  @IsOptional() @IsUUID()
  tenantId?: string;

  @IsOptional() @IsString()
  search?: string;

  @IsOptional() @IsString()
  userType?: string;
}

/** Filtres sessions actives cross-tenant. */
export class PlatformSessionsQueryDto {
  @IsOptional() @IsUUID()
  tenantId?: string;

  @IsOptional() @IsUUID()
  userId?: string;
}
