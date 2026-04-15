import { IsString, IsEmail, IsOptional, IsBoolean, IsArray, MinLength, MaxLength, IsEnum } from 'class-validator';

// ─── Users ────────────────────────────────────────────────────────────────────

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsString()
  roleId?: string;

  @IsOptional()
  @IsString()
  agencyId?: string;

  @IsOptional()
  @IsEnum(['STAFF', 'DRIVER'])
  userType?: 'STAFF' | 'DRIVER';
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  roleId?: string | null;

  @IsOptional()
  @IsString()
  agencyId?: string | null;
}

// ─── Roles ────────────────────────────────────────────────────────────────────

export class CreateRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;
}

export class UpdateRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;
}

export class SetPermissionsDto {
  @IsArray()
  @IsString({ each: true })
  permissions!: string[];
}

// ─── Audit / Sessions ─────────────────────────────────────────────────────────

export class AuditQueryDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  level?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}
