import { IsString, IsOptional, IsArray, IsObject } from 'class-validator';
import { WorkflowGraphDto } from './create-blueprint.dto';

export class SimulateWorkflowDto {
  /** Type d'entité à simuler */
  @IsString()  entityType!:  string;

  /** État initial pour la simulation */
  @IsString()  initialState!: string;

  /** Séquence d'actions à jouer */
  @IsArray()   @IsString({ each: true }) actions!: string[];

  /**
   * Rôle simulé pour vérification des permissions (roleId existant en DB).
   * Si omis, les permissions sont ignorées (mode "sudo" de conception).
   */
  @IsOptional() @IsString()  simulatedRoleId?: string;

  /**
   * Valeurs de contexte pour évaluer les guards.
   * Les clés correspondent aux noms de guards dans le registre.
   * Ex : { checkSoldeAgent: true, checkCapacityAvailable: false }
   * Également utilisé comme overrides pour les champs de l'entité sandbox.
   */
  @IsOptional() @IsObject()  context?: Record<string, unknown>;

  /**
   * Source du graphe à simuler (priorité : graph > blueprintId > tenant actif).
   * - graph : le graphe en cours d'édition côté designer (non-persisté)
   * - blueprintId : simuler contre un blueprint existant
   * - ni l'un ni l'autre : utilise le graphe actif du tenant
   */
  @IsOptional() @IsObject()  graph?:       WorkflowGraphDto;
  @IsOptional() @IsString()  blueprintId?: string;
}
