/**
 * BootstrapGuard — protège POST /platform/bootstrap
 *
 * Double condition pour passer :
 *   1. Header X-Bootstrap-Key === PLATFORM_BOOTSTRAP_KEY (env)
 *   2. Aucun utilisateur avec le rôle SUPER_ADMIN n'existe encore en DB
 *
 * Dès qu'un SUPER_ADMIN existe, l'endpoint retourne 403 définitivement.
 * La clé bootstrap ne doit jamais être exposée dans les logs ou le frontend.
 */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { PLATFORM_TENANT_ID } from '../../../../prisma/seeds/iam.seed';

@Injectable()
export class BootstrapGuard implements CanActivate {
  private readonly logger = new Logger(BootstrapGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { headers: Record<string, string> }>();
    const providedKey = request.headers['x-bootstrap-key'];
    const expectedKey = process.env.PLATFORM_BOOTSTRAP_KEY;

    // ── Vérification de la clé bootstrap ──────────────────────────────────────
    if (!expectedKey) {
      this.logger.error('PLATFORM_BOOTSTRAP_KEY non défini — endpoint bootstrap désactivé');
      throw new ForbiddenException('Bootstrap endpoint non configuré');
    }

    if (!providedKey || providedKey !== expectedKey) {
      this.logger.warn('Tentative bootstrap avec clé invalide');
      throw new ForbiddenException('Clé bootstrap invalide');
    }

    // ── Vérification idempotence : aucun SUPER_ADMIN ne doit exister ──────────
    const superAdminRole = await this.prisma.role.findFirst({
      where: { tenantId: PLATFORM_TENANT_ID, name: 'SUPER_ADMIN' },
    });

    if (superAdminRole) {
      const existingAdmin = await this.prisma.user.findFirst({
        where: { tenantId: PLATFORM_TENANT_ID, roleId: superAdminRole.id },
      });

      if (existingAdmin) {
        this.logger.warn('Tentative bootstrap bloquée — SUPER_ADMIN déjà existant');
        throw new ForbiddenException(
          'Bootstrap déjà effectué — utilisez les endpoints de gestion du staff',
        );
      }
    }

    return true;
  }
}
