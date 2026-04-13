import { IsString, IsOptional, IsArray, IsObject } from 'class-validator';

export class SimulateWorkflowDto {
  /** Type d'entité à simuler */
  @IsString()  entityType!:  string;
  /** État initial pour la simulation */
  @IsString()  initialState!: string;
  /** Séquence d'actions à jouer */
  @IsArray()   @IsString({ each: true }) actions!: string[];
  /**
   * Rôle simulé pour vérification des permissions.
   * Format: roleId existant en DB pour extraire les permissions.
   */
  @IsOptional() @IsString()  simulatedRoleId?: string;
  /**
   * Valeurs de contexte pour évaluer les guards.
   * Ex: { balance: 50000, hasValidId: true }
   */
  @IsOptional() @IsObject()  context?: Record<string, unknown>;
  /**
   * Si true, utilise le graphe du blueprint (blueprintId requis)
   * Si false, utilise le graphe actif du tenant en DB
   */
  @IsOptional() @IsString()  blueprintId?: string;
}
