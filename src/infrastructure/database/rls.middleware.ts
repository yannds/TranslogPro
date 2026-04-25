import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenantContextService } from './tenant-context.service';

// Endpoints publics dont le tenantId vient du path param (écrans display)
const PUBLIC_TENANT_PATHS = [
  /^\/api\/tenants\/([^/]+)\/config$/,
  /^\/api\/tenants\/([^/]+)\/company$/,
  /^\/api\/tenants\/([^/]+)\/brand$/,
  /^\/api\/tenants\/([^/]+)\/stations\/([^/]+)\/display/,
  /^\/api\/tenants\/([^/]+)\/buses\/([^/]+)\/display/,
  /^\/api\/tenants\/([^/]+)\/parcels\/track\//,
  /^\/api\/public\/([^/]+)\/report$/,
];

@Injectable()
export class RlsMiddleware implements NestMiddleware {
  use(req: Request & { user?: { tenantId?: string; id?: string; agencyId?: string } }, _res: Response, next: NextFunction) {
    // Source de vérité: session Better Auth
    const sessionTenantId = req.user?.tenantId;

    if (sessionTenantId) {
      // Route authentifiée : tenantId vient UNIQUEMENT de la session
      TenantContextService.run(
        {
          tenantId: sessionTenantId,
          userId: req.user?.id,
          agencyId: req.user?.agencyId,
        },
        next,
      );
      return;
    }

    // Route publique : vérifier si c'est un endpoint autorisé sans auth
    for (const pattern of PUBLIC_TENANT_PATHS) {
      const match = req.path.match(pattern);
      if (match) {
        const pathTenantId = match[1];
        TenantContextService.run({ tenantId: pathTenantId }, next);
        return;
      }
    }

    // Endpoints non-authentifiés non-publics (login, health, etc.)
    next();
  }
}
