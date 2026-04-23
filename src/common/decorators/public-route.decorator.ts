import { SetMetadata } from '@nestjs/common';

/**
 * Clé de métadonnée — exposée pour que `PermissionGuard` puisse la lire.
 */
export const PUBLIC_ROUTE_KEY = 'public_route';

/**
 * Marque une route comme **publique de façon explicite et intentionnelle**.
 *
 * SECURITY FIRST :
 *   - Une route SANS `@RequirePermission` est déjà considérée publique par
 *     `PermissionGuard` (cf. comportement par défaut).
 *   - Mais l'absence d'annotation est ambiguë : on ne sait pas si c'est
 *     intentionnel ou un oubli.
 *   - `@PublicRoute('motif')` documente l'intention et **bloque toute
 *     régression silencieuse** si la default policy bascule un jour vers
 *     "deny by default".
 *
 * Usage type :
 *   @PublicRoute('Public ticket tracking by code (no PII exposed)')
 *   @Get('track/:code')
 *   track(...) { ... }
 *
 * Le paramètre `reason` est obligatoire : il force le développeur à
 * justifier pourquoi cette route reste sans auth (utile à la code review
 * et aux audits de sécurité).
 */
export const PublicRoute = (reason: string) => SetMetadata(PUBLIC_ROUTE_KEY, reason);
