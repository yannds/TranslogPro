import { IsString, MinLength, MaxLength } from 'class-validator';

/**
 * Résolution d'un écart de caisse (CashRegister.status = DISCREPANCY).
 * Passe par WorkflowEngine action 'resolve' (blueprint cash-register-cycle,
 * requiredPerm = data.cashier.close.agency). La justification est OBLIGATOIRE
 * et tracée dans AuditLog + dénormalisée sur CashRegister.resolutionNote.
 */
export class ResolveDiscrepancyDto {
  @IsString()
  @MinLength(10)
  @MaxLength(1_000)
  resolutionNote: string;
}
