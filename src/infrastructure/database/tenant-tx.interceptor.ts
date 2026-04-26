import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { firstValueFrom, from, Observable } from 'rxjs';
import { PrismaService } from './prisma.service';
import { TenantContextService } from './tenant-context.service';

/**
 * Wrappe chaque requete HTTP authentifiee dans une transaction Prisma avec
 * `set_config('app.tenant_id', X, true)`, et expose la tx au PrismaService
 * (via TenantTxStorage) pour la duree du handler.
 *
 * Permet de basculer la RLS Postgres en RESTRICTIVE : chaque connexion vue
 * par `app_runtime` aura son `app.tenant_id` defini → les policies peuvent
 * exiger un match strict sans `IS NULL` fallback.
 *
 * Skip si :
 *  - Pas de contexte tenant (login, signup, health, public reports)
 *  - Kill-switch `TENANT_DB_LEVEL_RLS=off` (ou autre que `on`)
 *
 * Edge case documente : un setImmediate / setTimeout fire-and-forget declenche
 * dans le handler verra dans son AsyncLocalStorage la tx, mais la tx aura ete
 * commit/rollback a la fin du handler. Eviter ce pattern (deja anti-pattern
 * vis-a-vis de la traçabilite des side-effects).
 */
@Injectable()
export class TenantTxInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TenantTxInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (process.env.TENANT_DB_LEVEL_RLS !== 'on') {
      return next.handle();
    }

    const tenantCtx = TenantContextService.getStore();
    if (!tenantCtx?.tenantId) {
      return next.handle();
    }

    const tenantId = tenantCtx.tenantId;
    return from(
      this.prisma.runInTenantTx(tenantId, async () => {
        return await firstValueFrom(next.handle());
      }),
    );
  }
}
