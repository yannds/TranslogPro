import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenantContextService } from './tenant-context.service';

// Endpoints publics dont le tenantId vient du path param (écrans display)
const PUBLIC_TENANT_PATHS = [
  /^\/api\/v1\/tenants\/([^/]+)\/stations\/([^/]+)\/display/,
  /^\/api\/v1\/tenants\/([^/]+)\/buses\/([^/]+)\/display/,
  /^\/api\/v1\/tenants\/([^/]+)\/parcels\/track\//,
  /^\/api\/v1\/public\/([^/]+)\/report$/,
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
