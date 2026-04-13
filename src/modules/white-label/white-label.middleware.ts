/**
 * WhiteLabelMiddleware — Charge la configuration visuelle du tenant
 * au démarrage de chaque requête et l'attache à `req.tenantBrand`.
 *
 * Stratégie :
 *  - Extrait le tenantId depuis la session Better Auth (routes authentifiées).
 *  - Pour les routes publiques (display, portail voyageur), lit le path param
 *    `tenantId` ou le sous-domaine si la route en expose un.
 *  - Appel à WhiteLabelService.getBrand() → Redis cache L1 (TTL 5 min).
 *    Coût = 1 GET Redis (~0.3 ms local) si cache chaud, sinon 1 SELECT Postgres.
 *
 * Déclaration dans AppModule ou dans le module cible via `configure()`.
 */
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { WhiteLabelService, BrandConfig } from './white-label.service';

/** Extension du type Request Express pour typer `req.tenantBrand`. */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenantBrand?: BrandConfig;
    }
  }
}

@Injectable()
export class WhiteLabelMiddleware implements NestMiddleware {
  constructor(private readonly whiteLabelService: WhiteLabelService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const tenantId = this.resolveTenantId(req);

    if (tenantId) {
      // Erreurs de chargement de la marque sont non-bloquantes :
      // si Redis/DB est indisponible, on continue avec la marque par défaut.
      try {
        req.tenantBrand = await this.whiteLabelService.getBrand(tenantId);
      } catch {
        // default brand already returned by getBrand fallback — pas d'action
      }
    }

    next();
  }

  /**
   * Résolution du tenantId dans l'ordre de priorité :
   *  1. Session Better Auth (req.user.tenantId) — routes authentifiées
   *  2. Path param :tenantId — routes type /api/v1/tenants/:tenantId/...
   *  3. Sous-domaine — ex: "acme.translogpro.app" → slug "acme"
   *     (mappé en tenantId via un reverse-lookup — non implémenté ici)
   */
  private resolveTenantId(req: Request): string | null {
    // 1. Session (injecté par le SessionMiddleware de Better Auth)
    const user = (req as any).user as { tenantId?: string } | undefined;
    if (user?.tenantId) return user.tenantId;

    // 2. Path param (/api/v1/tenants/:tenantId/...)
    const raw     = req.params?.['tenantId'] ?? req.params?.['tid'];
    const paramId = Array.isArray(raw) ? raw[0] : raw;
    if (paramId) return paramId;

    return null;
  }
}
