/**
 * Types partagés du module Manifest.
 *
 * Un manifeste est un document récapitulatif d'un trajet. On distingue trois
 * "kinds" :
 *   - ALL        : doc combiné passagers + colis (legacy, valeur par défaut
 *                  pour rétro-compatibilité — anciennement le seul type).
 *   - PASSENGERS : doc passagers uniquement (billets émis, sièges, drop-offs).
 *   - PARCELS    : doc colis uniquement (tracking codes, poids, destinations).
 *
 * Le chauffeur signe chaque kind séparément (acknowledge). Un trajet mixte
 * (passagers + colis) peut donc générer 2 manifestes signés indépendamment.
 */
export type ManifestKind = 'ALL' | 'PASSENGERS' | 'PARCELS';

export const MANIFEST_KINDS: readonly ManifestKind[] = ['ALL', 'PASSENGERS', 'PARCELS'] as const;

/** Normalise une valeur externe (body API, script) en ManifestKind sûr. */
export function coerceManifestKind(raw: unknown): ManifestKind {
  if (raw === 'PASSENGERS' || raw === 'PARCELS' || raw === 'ALL') return raw;
  return 'ALL';
}

/** Sous-chemin du storage pour différencier les kinds sans écraser les PDFs. */
export function manifestSubPath(tripId: string, kind: ManifestKind): string {
  return `manifests/${tripId}/${kind.toLowerCase()}`;
}
