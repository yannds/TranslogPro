/**
 * TenantHostMiddleware — Résout le tenant depuis le header Host.
 *
 * POSITION DANS LA CHAÎNE : tout premier middleware, AVANT SessionMiddleware.
 * Pourquoi ? Parce que SessionMiddleware lira plus tard req.resolvedHostTenant
 * pour valider que la session appartient bien au tenant du host (anti cookie
 * smuggling cross-tenant — voir TenantIsolationGuard).
 *
 * COMPORTEMENT :
 *   - Lit req.headers.host
 *   - Appelle TenantResolverService.resolveFromHost(host)
 *   - Si match → req.resolvedHostTenant = ResolvedTenant
 *   - Si no match OU erreur → req.resolvedHostTenant reste undefined
 *
 * RÈGLE D'OR : ce middleware ne bloque JAMAIS une requête. Il se contente
 * d'injecter un contexte optionnel. C'est TenantIsolationGuard (plus tard
 * dans la chaîne) qui rejette les requêtes où session.tenantId ≠ host.tenantId.
 */

import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { TenantResolverService } from './tenant-resolver.service';

@Injectable()
export class TenantHostMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantHostMiddleware.name);

  constructor(private readonly resolver: TenantResolverService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    // En DEV uniquement, on autorise le client à surcharger le host via
    // X-Tenant-Host. Utile pour :
    //   - les apps mobile qui tapent localhost:3000 (HSTS/TLS-safe)
    //   - les tests Playwright sans Caddy
    // En prod, Kong/Caddy DOIT strip ce header côté edge — sinon injection
    // tenant triviale. Cf. infra/kong/config.yaml `request-transformer`.
    const headerHost =
      process.env.NODE_ENV === 'development' && typeof req.headers['x-tenant-host'] === 'string'
        ? (req.headers['x-tenant-host'] as string)
        : null;

    const hostname = headerHost
      ?? (typeof req.headers.host === 'string' ? req.headers.host : '');

    if (!hostname) {
      // Requête sans Host header (HTTP/0.9, curl --http1.0 -H "Host:", health
      // internes sur unix socket, etc.) — on laisse passer sans contexte.
      return next();
    }

    try {
      const resolved = await this.resolver.resolveFromHost(hostname);
      if (resolved) {
        req.resolvedHostTenant = resolved;
      }
    } catch (err) {
      // Erreur DB, perte de connexion, etc. Ne JAMAIS bloquer la requête
      // ici — les guards plus bas rejetteront si la requête nécessite un
      // tenant et que rien n'est résolu.
      this.logger.error(
        `[TenantHost] resolve failed for host="${hostname}": ${(err as Error).message}`,
      );
    }

    next();
  }
}
