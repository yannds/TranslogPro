/**
 * current-tenant.ts — Abstraction unique de résolution du tenant courant.
 *
 * PRINCIPE : tout le code applicatif doit passer par `getCurrentTenantId(req)`
 * au lieu de lire `req.user.tenantId` directement. Cela permet de changer la
 * stratégie de résolution sans toucher aux appelants.
 *
 * PHASE 1  → impersonation > session > host
 * PHASE 3  → idem (les custom domains passent par TenantResolverService)
 * PHASE 4  → impersonation > session.activeTenantId (multi-membership) > host
 *            Seule cette fonction change pour supporter le switcher de tenant.
 *
 * Cette abstraction est le point de découplage clé entre la surface métier
 * (routes, services) et l'infrastructure de routage multi-tenant.
 */

import type { Request } from 'express';

// ─── Types partagés ──────────────────────────────────────────────────────────

export type TenantSource = 'session' | 'host' | 'impersonation' | 'path-param';

export interface ResolvedTenant {
  tenantId:   string;
  slug:       string;
  source:     TenantSource;
  hostname?:  string;
  isPrimary?: boolean;
}

/**
 * Contexte d'impersonation injecté par ImpersonationGuard (core/iam).
 * Dupliqué ici pour éviter un cycle d'import core/iam ↔ core/tenancy.
 */
export interface ImpersonationContextShape {
  sessionId:      string;
  targetTenantId: string;
  actorId:        string;
  actorTenantId:  string;
}

/**
 * Shape minimal de req.user attendu par getCurrentTenantId.
 * Compatible avec CurrentUserPayload (common/decorators/current-user.decorator).
 */
export interface SessionUserShape {
  id:       string;
  tenantId: string;
  agencyId?: string;
  roleId?:  string;
}

// ─── Extension Express.Request ───────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-namespace
declare global {
  namespace Express {
    interface Request {
      /**
       * Tenant résolu depuis le header Host par TenantHostMiddleware.
       * Présent pour toute requête dont le host correspond à un tenant (subdomain
       * ou custom domain Phase 3). Absent pour les hosts non mappés (health,
       * requêtes internes sans header Host).
       */
      resolvedHostTenant?: ResolvedTenant;

      /**
       * Contexte d'impersonation JIT si l'acteur a envoyé X-Impersonation-Token
       * valide. Injecté par ImpersonationGuard.
       */
      impersonation?: ImpersonationContextShape;

      /**
       * Utilisateur authentifié injecté par SessionMiddleware.
       * Typé ici pour rendre `req.user.tenantId` accessible sans cast.
       * (Convention existante du projet : white-label.middleware.ts fait pareil.)
       */
      user?: SessionUserShape & { roleName?: string; userType?: string };
    }
  }
}

// ─── API publique ────────────────────────────────────────────────────────────

/**
 * Retourne le tenantId effectif pour la requête courante, ou null si aucun
 * contexte tenant n'est résolu (route publique sans host mappé, health).
 *
 * Priorité (la plus haute gagne) :
 *   1. Impersonation (actor plateforme prend temporairement l'identité d'un tenant)
 *   2. Session utilisateur (req.user.tenantId posé par SessionMiddleware)
 *   3. Host résolu (req.resolvedHostTenant posé par TenantHostMiddleware)
 *
 * Règle d'usage : TOUT code métier lit via cette fonction ; ne JAMAIS accéder
 * directement à req.user.tenantId (sauf dans les middlewares/guards qui sont
 * responsables de poser ces valeurs).
 */
export function getCurrentTenantId(req: Request): string | null {
  if (req.impersonation?.targetTenantId) {
    return req.impersonation.targetTenantId;
  }
  if (req.user?.tenantId) {
    return req.user.tenantId;
  }
  if (req.resolvedHostTenant?.tenantId) {
    return req.resolvedHostTenant.tenantId;
  }
  return null;
}

/**
 * Variante stricte : lève si aucun tenant n'est résolu.
 * À utiliser dans les services qui NE DOIVENT PAS être appelés sans contexte.
 */
export function requireCurrentTenantId(req: Request): string {
  const id = getCurrentTenantId(req);
  if (!id) {
    throw new Error(
      'No tenant context — request must be routed through ' +
      'TenantHostMiddleware and/or SessionMiddleware before reaching here.',
    );
  }
  return id;
}

/**
 * Retourne la source effective du tenant courant (utile pour l'audit log
 * et le debug : savoir si une requête opère en impersonation, via session
 * ou uniquement via host).
 */
export function getCurrentTenantSource(req: Request): TenantSource | null {
  if (req.impersonation?.targetTenantId) return 'impersonation';
  if (req.user?.tenantId) return 'session';
  if (req.resolvedHostTenant?.tenantId) return 'host';
  return null;
}
