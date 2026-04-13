import { IsEmail, IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Rôles autorisés via cet endpoint.
 * Les rôles tenant (TENANT_ADMIN, DRIVER, …) ne peuvent PAS être créés ici.
 * Le menu de sélection de rôle côté frontend ne doit jamais exposer ces valeurs
 * aux interfaces des tenants clients.
 */
export enum PlatformRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  SUPPORT_L1  = 'SUPPORT_L1',
  SUPPORT_L2  = 'SUPPORT_L2',
}

export class CreatePlatformStaffDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsEnum(PlatformRole)
  roleName: PlatformRole;
}
