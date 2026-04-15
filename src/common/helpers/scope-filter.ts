import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ScopeContext } from '../decorators/scope-context.decorator';

/** Sous-type minimal d'un client Prisma capable de retrouver un Trip par id. */
type TripFinder = {
  trip: {
    findFirst: (args: { where: Record<string, unknown>; select: { driverId: true } }) =>
      Promise<{ driverId: string | null } | null>;
  };
};

/**
 * Construit la clause Prisma `where` correspondant au scope de permission.
 *
 * Règle :
 *   - scope = 'own'    → filtre sur `{ [ownerField]: userId }`
 *   - scope = 'agency' → filtre sur `{ agencyId: scope.agencyId }`
 *   - scope = 'tenant' → aucun filtre additionnel (RLS s'en charge)
 *   - scope = 'global' → aucun filtre
 *
 * Exemple — liste des trajets visibles par un chauffeur :
 *   where: { tenantId, ...ownershipWhere(scope, 'driverId') }
 *
 * Source de vérité du ownerField : dépendant de l'entité.
 *   Trip    → 'driverId'
 *   Ticket  → 'passengerId'
 *   Parcel  → 'senderId'
 *   Claim   → 'reporterId'
 */
export function ownershipWhere(
  scope:       ScopeContext,
  ownerField:  string,
  agencyField: string = 'agencyId',
): Record<string, string> {
  if (scope.scope === 'own')    return { [ownerField]:  scope.userId };
  if (scope.scope === 'agency') return { [agencyField]: scope.agencyId ?? '__none__' };
  return {};
}

/**
 * Vérifie qu'une ressource déjà chargée est possédée par l'acteur lorsque
 * le scope est `own`. Utile après un `findOne` sans filtre — jette 403 sinon.
 *
 * N'échoue pas silencieusement si la ressource est `null` (laisse le
 * NotFoundException en amont se déclencher).
 */
export function assertOwnership<T extends Record<string, unknown>>(
  scope:      ScopeContext,
  resource:   T | null | undefined,
  ownerField: keyof T,
): void {
  if (!resource) return;
  if (scope.scope !== 'own') return;
  if (resource[ownerField] !== scope.userId) {
    throw new ForbiddenException(
      `Scope 'own' violation — resource not owned by actor (field=${String(ownerField)})`,
    );
  }
}

/**
 * Vérifie qu'un Trip est assigné à l'acteur lorsque scope=own.
 * Utilisé pour les ressources rattachées à un trajet (GPS, manifeste,
 * checklist, équipage…) qui n'ont pas de ownerField direct.
 *
 * Effet de bord : 1 SELECT sur Trip (driverId only). Acceptable pour la
 * sécurité — à mettre en cache par requête si jamais hot path.
 */
export async function assertTripOwnership(
  prisma:   TripFinder,
  tenantId: string,
  tripId:   string,
  scope:    ScopeContext,
): Promise<void> {
  if (scope.scope !== 'own') return;
  const trip = await prisma.trip.findFirst({
    where:  { id: tripId, tenantId },
    select: { driverId: true },
  });
  if (!trip) throw new NotFoundException(`Trip ${tripId} not found`);
  if (trip.driverId !== scope.userId) {
    throw new ForbiddenException(`Scope 'own' violation — trip not assigned to actor`);
  }
}
