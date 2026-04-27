import { Injectable, Logger, ConflictException, Optional } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ISecretService, SECRET_SERVICE } from '../../infrastructure/secret/interfaces/secret.interface';
import { Inject } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { FareClassDefault } from '../tenant-settings/tenant-fare-class.service';
import { seedPeakPeriodsForTenant } from '../../../prisma/seeds/peak-periods.seed';
import {
  seedTenantRoles,
  ensureDefaultAgency,
  ensureVirtualRegisterForAgency,
  DEFAULT_AGENCY_NAME,
  DEFAULT_WORKFLOW_CONFIGS,
  installSystemBlueprintsForTenant,
  seedDefaultVehicleDocumentTypes,
  type TenantLanguage,
} from '../../../prisma/seeds/iam.seed';
import { STARTER_PACK_SLUGS } from '../../../server/seed/templates/templates.seeder';
import { seedCmsPages } from '../../../prisma/seeds/cms-pages.seed';
import { StaffProvisioningService } from '../staff/staff-provisioning.service';

export interface OnboardTenantDto {
  name:       string;
  slug:       string;
  adminEmail: string;
  adminName:  string;
  plan?:      string;
  /** ISO 3166-1 alpha-2 — drive timezone, devise, villes par défaut. Défaut : 'CG'. */
  country?:   string;
  /** Langue par défaut du tenant. Défaut : 'fr'. */
  language?:  TenantLanguage;
  /**
   * Type d'activité principal — pilote l'étape 4 du wizard d'onboarding
   * (TICKETING → trajet, PARCELS → tarif colis, MIXED → les deux).
   * Null si l'onboarding a été fait par un SA sans passer par le signup public.
   */
  businessActivity?: 'TICKETING' | 'PARCELS' | 'MIXED';
}

/** Defaults régionaux par pays — utilisés à l'onboarding pour auto-configurer timezone + devise. */
const COUNTRY_DEFAULTS: Record<string, { timezone: string; currency: string }> = {
  CG: { timezone: 'Africa/Brazzaville',    currency: 'XAF' },
  CD: { timezone: 'Africa/Kinshasa',       currency: 'CDF' },
  CM: { timezone: 'Africa/Douala',         currency: 'XAF' },
  GA: { timezone: 'Africa/Libreville',     currency: 'XAF' },
  TD: { timezone: 'Africa/Ndjamena',       currency: 'XAF' },
  CF: { timezone: 'Africa/Bangui',         currency: 'XAF' },
  GQ: { timezone: 'Africa/Malabo',         currency: 'XAF' },
  SN: { timezone: 'Africa/Dakar',          currency: 'XOF' },
  CI: { timezone: 'Africa/Abidjan',        currency: 'XOF' },
  ML: { timezone: 'Africa/Bamako',         currency: 'XOF' },
  BF: { timezone: 'Africa/Ouagadougou',    currency: 'XOF' },
  NE: { timezone: 'Africa/Niamey',         currency: 'XOF' },
  TG: { timezone: 'Africa/Lome',           currency: 'XOF' },
  BJ: { timezone: 'Africa/Porto-Novo',     currency: 'XOF' },
  GW: { timezone: 'Africa/Bissau',         currency: 'XOF' },
  GN: { timezone: 'Africa/Conakry',        currency: 'GNF' },
  SL: { timezone: 'Africa/Freetown',       currency: 'SLL' },
  LR: { timezone: 'Africa/Monrovia',       currency: 'LRD' },
  NG: { timezone: 'Africa/Lagos',          currency: 'NGN' },
  GH: { timezone: 'Africa/Accra',          currency: 'GHS' },
  GM: { timezone: 'Africa/Banjul',         currency: 'GMD' },
  CV: { timezone: 'Atlantic/Cape_Verde',   currency: 'CVE' },
  AO: { timezone: 'Africa/Luanda',         currency: 'AOA' },
  ST: { timezone: 'Africa/Sao_Tome',       currency: 'STN' },
  RW: { timezone: 'Africa/Kigali',         currency: 'RWF' },
  BI: { timezone: 'Africa/Bujumbura',      currency: 'BIF' },
  KE: { timezone: 'Africa/Nairobi',        currency: 'KES' },
  UG: { timezone: 'Africa/Kampala',        currency: 'UGX' },
  ET: { timezone: 'Africa/Addis_Ababa',    currency: 'ETB' },
  DJ: { timezone: 'Africa/Djibouti',       currency: 'DJF' },
  MA: { timezone: 'Africa/Casablanca',     currency: 'MAD' },
  TN: { timezone: 'Africa/Tunis',          currency: 'TND' },
  DZ: { timezone: 'Africa/Algiers',        currency: 'DZD' },
  CN: { timezone: 'Asia/Shanghai',         currency: 'CNY' },
  FR: { timezone: 'Europe/Paris',          currency: 'EUR' },
  BE: { timezone: 'Europe/Brussels',       currency: 'EUR' },
};

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
    private readonly prisma:         PrismaService,
    @Inject(SECRET_SERVICE) private readonly secretService: ISecretService,
    private readonly platformConfig: PlatformConfigService,
    // Optional pour rétrocompatibilité avec les tests qui instancient le service
    // sans le helper. En prod, StaffProvisioningService est toujours injecté
    // via le module (cf. onboarding.module.ts).
    @Optional() private readonly provisioning?: StaffProvisioningService,
  ) {}

  async onboard(dto: OnboardTenantDto) {
    const existing = await this.prisma.tenant.findUnique({ where: { slug: dto.slug } });
    if (existing) throw new ConflictException(`Tenant slug "${dto.slug}" déjà utilisé`);

    this.logger.log(`Onboarding tenant "${dto.slug}" — début provisioning atomique`);

    const language: TenantLanguage = dto.language ?? 'fr';
    const country = dto.country ?? 'CG';
    const regional = COUNTRY_DEFAULTS[country] ?? COUNTRY_DEFAULTS['CG'];

    const result = await this.prisma.transact(async (tx) => {
      // 1. Tenant — persiste la localisation dès la création
      const tenant = await tx.tenant.create({
        data: {
          name:            dto.name,
          slug:            dto.slug,
          provisionStatus: 'PROVISIONING',
          language,
          country,
          timezone: regional.timezone,
          currency: regional.currency,
          businessActivity: dto.businessActivity ?? null,
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

      // 3.bis. Caisse VIRTUELLE système de l'agence par défaut.
      // Invariant : toute agence a sa caisse virtuelle (side-effects comptables
      // sans caissier humain — voucher redeem, refund.process, paiement en ligne).
      await ensureVirtualRegisterForAgency(tx as unknown as any, tenant.id, defaultAgencyId);

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

      // 5.bis. Enregistre les blueprints système comme "installés" pour ce tenant
      // (UI marketplace + scénarios PageWfSimulate). N'écrit PAS les configs —
      // purement déclaratif via BlueprintInstall. Idempotent.
      await installSystemBlueprintsForTenant(tx as unknown as PrismaClient, tenant.id);

      // 5.ter. Types de documents véhicule par défaut (Assurance, Carte grise…)
      await seedDefaultVehicleDocumentTypes(tx, tenant.id);

      // 6. Modules de base activés
      await this.seedInstalledModules(tx as unknown as PrismaService, tenant.id);

      // 7. Pack de démarrage — copies éditables des templates de documents
      await this.seedStarterTemplates(tx as unknown as PrismaService, tenant.id, admin.id);

      // 7.bis. Pricing defaults marché — seed TenantBusinessConfig +
      // TenantTax (TVA isSystemDefault, appliedToPrice=false par défaut) +
      // TenantFareClass × N (depuis pricing.defaults.fareClasses).
      // Cf. pricing-defaults.backfill.ts pour le rattrapage des tenants
      // existants pré-migration.
      await this.seedPricingDefaults(tx as unknown as PrismaService, tenant.id);

      // 7.ter. Pages CMS par défaut (about, fleet, contact, post bienvenue)
      // + TenantPortalConfig initial. Idempotent (skipDuplicates).
      await seedCmsPages(tx as unknown as PrismaClient, tenant.id, {
        companyName: dto.name,
        city:        '',        // pas encore connue à l'onboarding — éditée via portail admin
        country:     country,
      });

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

    // Provisioning RH hors tx : crée Staff + StaffAssignment ACTIVE primaire pour
    // l'admin tenant (rôle TENANT_ADMIN). Sans cet appel, l'admin existait dans
    // IAM mais pas dans la liste Personnel. Best-effort : un échec ne fait pas
    // régresser l'onboarding (le tenant est ACTIVE, l'admin peut se connecter).
    if (this.provisioning) {
      try {
        await this.provisioning.ensureStaffForUser({
          userId:   result.admin.id,
          tenantId: result.tenant.id,
          role:     'TENANT_ADMIN',
        });
      } catch (err) {
        this.logger.warn(`Staff provisioning admin tenant=${result.tenant.id} failed: ${(err as Error).message}`);
      }
    }

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

  /**
   * Seed pricing defaults marché — TenantBusinessConfig + TenantTax (TVA) +
   * TenantFareClass × N. Idempotent : les upsert/skip garantissent la
   * ré-exécution sans doublon (important car le script backfill
   * `pricing-defaults.backfill.ts` appelle la même logique côté job).
   *
   * Source unique de vérité : `pricing.defaults.*` + `tax.defaults.*` dans le
   * registre platform-config. Aucune valeur n'est hardcodée ici.
   */
  private async seedPricingDefaults(prisma: PrismaService, tenantId: string) {
    // 1. TenantBusinessConfig — upsert minimal ; les colonnes ont toutes des
    // defaults Prisma. On charge aussi le registre des formats d'immatriculation
    // par défaut (36 pays) pour que le tenant soit opérationnel sans config admin.
    const { DEFAULT_LICENSE_PLATE_FORMATS } = await import('../../../prisma/seeds/license-plate-formats.seed');
    await prisma.tenantBusinessConfig.upsert({
      where:  { tenantId },
      create: { tenantId, licensePlateFormats: DEFAULT_LICENSE_PLATE_FORMATS as any },
      update: {},
    });

    // 2. TenantTax TVA (marquée isSystemDefault — non supprimable)
    const [tvaCode, tvaLabelKey, tvaRate, tvaEnabled, tvaAppliedToPrice, tvaAppliedToRecommendation] = await Promise.all([
      this.platformConfig.getString('tax.defaults.tvaCode'),
      this.platformConfig.getString('tax.defaults.tvaLabelKey'),
      this.platformConfig.getNumber('tax.defaults.tvaRate'),
      this.platformConfig.getBoolean('tax.defaults.tvaEnabled'),
      this.platformConfig.getBoolean('tax.defaults.tvaAppliedToPrice'),
      this.platformConfig.getBoolean('tax.defaults.tvaAppliedToRecommendation'),
    ]);

    await prisma.tenantTax.upsert({
      where:  { tenantId_code: { tenantId, code: tvaCode } },
      create: {
        tenantId,
        code:                    tvaCode,
        label:                   `TVA ${Math.round(tvaRate * 1000) / 10}%`,
        labelKey:                tvaLabelKey,
        rate:                    tvaRate,
        kind:                    'PERCENT',
        base:                    'SUBTOTAL',
        appliesTo:               ['ALL'],
        sortOrder:               0,
        enabled:                 tvaEnabled,
        appliedToPrice:          tvaAppliedToPrice,
        appliedToRecommendation: tvaAppliedToRecommendation,
        isSystemDefault:         true,
      },
      update: {}, // idempotent, ne pas écraser les choix admin
    });

    // 3. TenantFareClass × N (depuis pricing.defaults.fareClasses)
    const fareDefaults = await this.platformConfig.getJson<FareClassDefault[]>('pricing.defaults.fareClasses');
    for (const def of fareDefaults) {
      await prisma.tenantFareClass.upsert({
        where:  { tenantId_code: { tenantId, code: def.code } },
        create: {
          tenantId,
          code:            def.code,
          label:           def.code,
          labelKey:        def.labelKey,
          multiplier:      def.multiplier,
          sortOrder:       def.sortOrder,
          color:           def.color,
          enabled:         true,
          isSystemDefault: true,
        },
        update: {}, // ne pas écraser les ajustements admin
      });
    }

    this.logger.log(
      `[pricing-defaults] tenant ${tenantId} — TenantBusinessConfig + TenantTax(TVA) + ${fareDefaults.length} TenantFareClass seedés`,
    );

    // 4. Peak periods + activation YIELD_ENGINE (Sprint 5).
    // Les calendriers saisonniers par défaut selon le pays + activation du
    // module yield pour que la 5ème règle PEAK_PERIOD ait un effet.
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId }, select: { country: true },
    });
    const peakRes = await seedPeakPeriodsForTenant(
      prisma as any, tenantId, tenant?.country ?? null,
    );
    await prisma.installedModule.upsert({
      where:  { tenantId_moduleKey: { tenantId, moduleKey: 'YIELD_ENGINE' } },
      create: { tenantId, moduleKey: 'YIELD_ENGINE', isActive: true, config: {} },
      update: { isActive: true },
    });
    this.logger.log(
      `[pricing-defaults] tenant ${tenantId} — peak periods seedés: ${peakRes.created}, YIELD_ENGINE actif`,
    );
  }

  private async seedInstalledModules(prisma: PrismaService, tenantId: string) {
    const baseModules = ['TICKETING', 'PARCEL', 'FLEET', 'CASHIER', 'TRACKING', 'NOTIFICATIONS'];
    await prisma.installedModule.createMany({
      data:           baseModules.map(key => ({ tenantId, moduleKey: key, isActive: true })),
      skipDuplicates: true,
    });
  }
}
