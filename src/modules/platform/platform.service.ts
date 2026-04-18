/**
 * PlatformService — gestion du staff interne TranslogPro
 *
 * Invariants absolus :
 *   • Tous les utilisateurs créés ici ont tenantId = PLATFORM_TENANT_ID
 *   • UserType est toujours 'STAFF' — jamais CUSTOMER ou ANONYMOUS
 *   • Les rôles sont strictement SUPER_ADMIN, SUPPORT_L1, SUPPORT_L2
 *   • Impossible de supprimer le dernier SUPER_ADMIN
 *   • Impossible de supprimer sa propre session active
 *   • L'impersonation est tracée sur chaque génération de document (audit log)
 */
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID }    from 'crypto';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { PLATFORM_TENANT_ID } from '../../../prisma/seeds/iam.seed';
import { BootstrapDto } from './dto/bootstrap.dto';
import { CreatePlatformStaffDto, PlatformRole } from './dto/create-platform-staff.dto';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';

@Injectable()
export class PlatformService {
  private readonly logger = new Logger(PlatformService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Bootstrap ──────────────────────────────────────────────────────────────

  /**
   * Crée le premier SUPER_ADMIN.
   * Appelé une seule fois — BootstrapGuard garantit l'idempotence.
   * Retourne un setupToken à usage unique pour que l'admin configure son mot de passe.
   */
  async bootstrap(dto: BootstrapDto) {
    const role = await this.resolvePlatformRole('SUPER_ADMIN');

    // Vérification email unique (global — unique constraint en DB)
    const existing = await this.prisma.user.findFirst({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException(`Email ${dto.email} déjà utilisé`);
    }

    const setupToken = dto.setupToken ?? randomUUID();

    const user = await this.prisma.user.create({
      data: {
        tenantId: PLATFORM_TENANT_ID,
        email:    dto.email,
        name:     dto.name,
        roleId:   role.id,
        userType: 'STAFF',
      },
    });

    this.logger.log(`[Bootstrap] Premier SUPER_ADMIN créé : ${user.id} (${user.email})`);

    return {
      userId:     user.id,
      email:      user.email,
      roleName:   'SUPER_ADMIN',
      setupToken,
      message:
        'SUPER_ADMIN créé. Configurez le mot de passe via le lien de setup. ' +
        'Cet endpoint est maintenant verrouillé.',
    };
  }

  // ─── Staff Management ────────────────────────────────────────────────────────

  async createStaff(dto: CreatePlatformStaffDto, actor: CurrentUserPayload) {
    this.assertPlatformActor(actor);

    const existing = await this.prisma.user.findFirst({ where: { email: dto.email } });
    if (existing) throw new ConflictException(`Email ${dto.email} déjà utilisé`);

    const role = await this.resolvePlatformRole(dto.roleName);

    const user = await this.prisma.user.create({
      data: {
        tenantId: PLATFORM_TENANT_ID,
        email:    dto.email,
        name:     dto.name,
        roleId:   role.id,
        userType: 'STAFF',
      },
    });

    this.logger.log(
      `[Platform] Staff créé : ${user.id} role=${dto.roleName} par actor=${actor.id}`,
    );

    return { userId: user.id, email: user.email, roleName: dto.roleName };
  }

  async listStaff() {
    const users = await this.prisma.user.findMany({
      where:   { tenantId: PLATFORM_TENANT_ID },
      include: { role: true },
      orderBy: { createdAt: 'asc' },
    });

    return users.map(u => ({
      id:        u.id,
      email:     u.email,
      name:      u.name,
      roleName:  u.role?.name ?? null,
      userType:  u.userType,
      createdAt: u.createdAt,
    }));
  }

  async updateStaffRole(
    targetId: string,
    roleName: PlatformRole | 'SUPER_ADMIN',
    actor: CurrentUserPayload,
  ) {
    this.assertPlatformActor(actor);

    const target = await this.prisma.user.findFirst({
      where:   { id: targetId, tenantId: PLATFORM_TENANT_ID },
      include: { role: true },
    });
    if (!target) throw new NotFoundException(`Staff ${targetId} introuvable`);

    if (target.role?.name === roleName) {
      return { updated: false, userId: targetId, roleName };
    }

    // Garde : interdire de retirer le dernier SUPER_ADMIN
    if (target.role?.name === 'SUPER_ADMIN' && roleName !== 'SUPER_ADMIN') {
      const count = await this.prisma.user.count({
        where: { tenantId: PLATFORM_TENANT_ID, role: { name: 'SUPER_ADMIN' } },
      });
      if (count <= 1) {
        throw new ForbiddenException('Impossible de rétrograder le dernier SUPER_ADMIN');
      }
    }

    const role = await this.resolvePlatformRole(roleName);

    await this.prisma.user.update({
      where: { id: targetId },
      data:  { roleId: role.id },
    });

    this.logger.log(
      `[Platform] Staff rôle modifié : ${targetId} → ${roleName} par actor=${actor.id}`,
    );

    return { updated: true, userId: targetId, roleName };
  }

  async removeStaff(targetId: string, actor: CurrentUserPayload) {
    this.assertPlatformActor(actor);

    if (targetId === actor.id) {
      throw new ForbiddenException('Impossible de supprimer son propre compte');
    }

    const target = await this.prisma.user.findFirst({
      where:   { id: targetId, tenantId: PLATFORM_TENANT_ID },
      include: { role: true },
    });

    if (!target) throw new NotFoundException(`Staff ${targetId} introuvable`);

    // Garde : dernier SUPER_ADMIN non supprimable
    if (target.role?.name === 'SUPER_ADMIN') {
      const count = await this.prisma.user.count({
        where: {
          tenantId: PLATFORM_TENANT_ID,
          role:     { name: 'SUPER_ADMIN' },
        },
      });
      if (count <= 1) {
        throw new ForbiddenException('Impossible de supprimer le dernier SUPER_ADMIN');
      }
    }

    await this.prisma.user.delete({ where: { id: targetId } });
    this.logger.log(`[Platform] Staff supprimé : ${targetId} par actor=${actor.id}`);

    return { deleted: true, userId: targetId };
  }

  // ─── Helpers privés ──────────────────────────────────────────────────────────

  private async resolvePlatformRole(roleName: PlatformRole | 'SUPER_ADMIN') {
    const role = await this.prisma.role.findFirst({
      where: { tenantId: PLATFORM_TENANT_ID, name: roleName },
    });
    if (!role) {
      throw new NotFoundException(
        `Rôle plateforme "${roleName}" introuvable — exécutez npm run db:seed`,
      );
    }
    return role;
  }

  private assertPlatformActor(actor: CurrentUserPayload): void {
    if (actor.tenantId !== PLATFORM_TENANT_ID) {
      throw new ForbiddenException(
        'Seul le staff de la plateforme peut gérer les comptes plateforme',
      );
    }
  }
}
