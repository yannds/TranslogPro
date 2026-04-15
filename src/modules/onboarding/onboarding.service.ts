import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ISecretService, SECRET_SERVICE } from '../../infrastructure/secret/interfaces/secret.interface';
import { Inject } from '@nestjs/common';
import { randomBytes } from 'crypto';
import {
  seedTenantRoles,
  ensureDefaultAgency,
  DEFAULT_AGENCY_NAME,
  DEFAULT_WORKFLOW_CONFIGS,
  type TenantLanguage,
} from '../../../prisma/seeds/iam.seed';
import { STARTER_PACK_SLUGS } from '../../../server/seed/templates/templates.seeder';

export interface OnboardTenantDto {
  name:       string;
  slug:       string;
  adminEmail: string;
  adminName:  string;
  plan?:      string;
  /**
   * Langue par défaut du tenant (pilote le nom de l'agence par défaut :
   * "Agence principale" en fr, "Main Agency" en en). Défaut : 'fr'.
   */
  language?:  TenantLanguage;
}

/**
 * PRD §IV.11 — Module O : Onboarding Orchestrator.
 *
 * Provisioning ATOMIQUE d'un nouveau tenant :
 *   1. Créer l'enregistrement Tenant en DB
 *   2. Seeder les rôles IAM (TENANT_ADMIN, CASHIER, DRIVER…)
 *   3. Créer l'agence par défaut ("Agence principale" / "Main Agency") — INVARIANT ≥1 agence
 *   4. Créer l'utilisateur admin (rattaché à l'agence par défaut)
 *   5. Seeder les WorkflowConfig par défaut
 *   6. Activer les modules de base (InstalledModule)
 *   7. Dupliquer le pack de démarrage des templates de documents
 *   8. Marquer le tenant ACTIVE + provisionner la clé HMAC dans Vault
 */
@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SECRET_SERVICE) private readonly secretService: ISecretService,
  ) {}

  async onboard(dto: OnboardTenantDto) {
    const existing = await this.prisma.tenant.findUnique({ where: { slug: dto.slug } });
    if (existing) throw new ConflictException(`Tenant slug "${dto.slug}" déjà utilisé`);

    this.logger.log(`Onboarding tenant "${dto.slug}" — début provisioning atomique`);

    const language: TenantLanguage = dto.language ?? 'fr';

    const result = await this.prisma.transact(async (tx) => {
      // 1. Tenant — persiste la langue dès la création (drive l'i18n frontend)
      const tenant = await tx.tenant.create({
        data: {
          name:            dto.name,
          slug:            dto.slug,
          provisionStatus: 'PROVISIONING',
          language,
        },
      });

      // 2. Seed des rôles IAM — JAMAIS de SUPER_ADMIN ici
      const roleMap = await seedTenantRoles(tx as unknown as any, tenant.id);
      const tenantAdminRoleId = roleMap.get('TENANT_ADMIN');

      // 3. Agence par défaut AVANT l'admin — invariant "tout tenant a ≥1 agence".
      // Sans cela, toute permission scope `.agency` retourne 403 pour l'admin
      // (PermissionGuard exige un agencyId sur l'acteur).
      const defaultAgencyId = await ensureDefaultAgency(
        tx,
        tenant.id,
        DEFAULT_AGENCY_NAME[language],
      );

      // 4. Admin user assigné au rôle TENANT_ADMIN + rattaché à l'agence par défaut
      const admin = await tx.user.create({
        data: {
          email:    dto.adminEmail,
          name:     dto.adminName,
          tenantId: tenant.id,
          userType: 'STAFF',
          roleId:   tenantAdminRoleId ?? null,
          agencyId: defaultAgencyId,
        },
      });

      // 5. Seed WorkflowConfig par défaut
      await this.seedDefaultWorkflowConfigs(tx as unknown as PrismaService, tenant.id);

      // 6. Modules de base activés
      await this.seedInstalledModules(tx as unknown as PrismaService, tenant.id);

      // 7. Pack de démarrage — copies éditables des templates de documents
      await this.seedStarterTemplates(tx as unknown as PrismaService, tenant.id, admin.id);

      // 8. Marquer tenant ACTIVE
      await tx.tenant.update({
        where: { id: tenant.id },
        data:  { provisionStatus: 'ACTIVE' },
      });

      return { tenant, admin };
    });

    // Provisioning Vault hors transaction (idempotent)
    const hmacKey = randomBytes(32).toString('hex');
    await this.secretService.putSecret(`tenants/${result.tenant.id}/hmac`, { KEY: hmacKey });
    this.logger.log(`Vault HMAC key provisionnée pour tenant ${result.tenant.id}`);

    this.logger.log(`Tenant "${dto.slug}" onboardé avec succès (id=${result.tenant.id})`);
    return result;
  }

  private async seedDefaultWorkflowConfigs(prisma: PrismaService, tenantId: string) {
    // Source unique : DEFAULT_WORKFLOW_CONFIGS (iam.seed.ts) — Trip + Ticket +
    // Parcel + Traveler + Bus + Shipment. Toute modification doit se faire
    // là-bas pour que onboarding + backfill restent cohérents.
    await prisma.workflowConfig.createMany({
      data: DEFAULT_WORKFLOW_CONFIGS.map(c => ({
        ...c, tenantId, guards: [], sideEffects: [], isActive: true, version: 1,
      })),
      skipDuplicates: true,
    });
  }

  /**
   * Duplique les templates système du pack de démarrage en copies éditables pour le tenant.
   * Idempotent — skip les slugs déjà dupliqués (en cas de re-onboarding).
   */
  private async seedStarterTemplates(prisma: PrismaService, tenantId: string, createdById: string) {
    const systemTemplates = await prisma.documentTemplate.findMany({
      where: { tenantId: null, slug: { in: STARTER_PACK_SLUGS }, isActive: true },
    });

    if (systemTemplates.length === 0) {
      this.logger.warn(`Pack de démarrage : aucun template système trouvé — exécuter 'npm run db:seed' d'abord`);
      return;
    }

    for (const sys of systemTemplates) {
      const already = await prisma.documentTemplate.findFirst({
        where: { tenantId, slug: sys.slug },
      });
      if (already) continue;

      await prisma.documentTemplate.create({
        data: {
          tenantId,
          name:        sys.name,
          slug:        sys.slug,
          docType:     sys.docType,
          format:      sys.format,
          engine:      sys.engine,
          schemaJson:  sys.schemaJson ?? undefined,
          varsSchema:  sys.varsSchema ?? {},
          body:        sys.body,
          version:     1,
          isSystem:    false,
          isActive:    true,
          createdById,
        },
      });
    }
    this.logger.log(`Pack de démarrage : ${systemTemplates.length} templates dupliqués pour tenant ${tenantId}`);
  }

  private async seedInstalledModules(prisma: PrismaService, tenantId: string) {
    const baseModules = ['TICKETING', 'PARCEL', 'FLEET', 'CASHIER', 'TRACKING', 'NOTIFICATIONS'];
    await prisma.installedModule.createMany({
      data:           baseModules.map(key => ({ tenantId, moduleKey: key, isActive: true })),
      skipDuplicates: true,
    });
  }
}
