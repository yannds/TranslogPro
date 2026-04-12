import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ISecretService, SECRET_SERVICE } from '../../infrastructure/secret/interfaces/secret.interface';
import { Inject } from '@nestjs/common';
import { randomBytes } from 'crypto';

export interface OnboardTenantDto {
  name:       string;
  slug:       string;
  adminEmail: string;
  adminName:  string;
  plan?:      string;
}

/**
 * PRD §IV.11 — Module O : Onboarding Orchestrator.
 *
 * Provisioning ATOMIQUE d'un nouveau tenant :
 *   1. Créer l'enregistrement Tenant en DB
 *   2. Provisionner la clé HMAC dans Vault
 *   3. Créer l'utilisateur admin
 *   4. Seeder les WorkflowConfig par défaut (5 workflows PRD)
 *   5. Activer les modules de base (InstalledModule)
 *
 * Si une étape échoue, la transaction DB est rollbackée.
 * Vault est idempotent (putSecret ne duplique pas si la clé existe déjà).
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

    // ── Étapes DB dans une transaction ─────────────────────────────────────
    const result = await this.prisma.transact(async (tx) => {
      // 1. Tenant
      const tenant = await tx.tenant.create({
        data: { name: dto.name, slug: dto.slug, status: 'ACTIVE' },
      });

      // 2. Admin user
      const admin = await tx.user.create({
        data: {
          email:    dto.adminEmail,
          name:     dto.adminName,
          tenantId: tenant.id,
          role:     'TENANT_ADMIN',
        },
      });

      // 3. Seed WorkflowConfig par défaut (exemples Trip)
      await this.seedDefaultWorkflowConfigs(tx as unknown as PrismaService, tenant.id);

      // 4. Modules de base activés
      await this.seedInstalledModules(tx as unknown as PrismaService, tenant.id);

      return { tenant, admin };
    });

    // ── Provisioning Vault hors transaction (idempotent) ───────────────────
    const hmacKey = randomBytes(32).toString('hex');
    await this.secretService.putSecret(`tenants/${result.tenant.id}/hmac`, { KEY: hmacKey });
    this.logger.log(`Vault HMAC key provisionnée pour tenant ${result.tenant.id}`);

    this.logger.log(`Tenant "${dto.slug}" onboardé avec succès (id=${result.tenant.id})`);
    return result;
  }

  private async seedDefaultWorkflowConfigs(prisma: PrismaService, tenantId: string) {
    // Seed minimal — les transitions principales du Trip
    const configs = [
      { aggregateType: 'Trip', fromState: 'PLANNED',      action: 'ACTIVATE',       toState: 'PLANNED',      requiredPerm: 'data.trip.create.tenant' },
      { aggregateType: 'Trip', fromState: 'PLANNED',      action: 'START_BOARDING',  toState: 'OPEN',         requiredPerm: 'data.trip.update.agency' },
      { aggregateType: 'Trip', fromState: 'OPEN',         action: 'BEGIN_BOARDING',  toState: 'BOARDING',     requiredPerm: 'data.trip.update.agency' },
      { aggregateType: 'Trip', fromState: 'BOARDING',     action: 'DEPART',          toState: 'IN_PROGRESS',  requiredPerm: 'data.trip.update.agency' },
      { aggregateType: 'Trip', fromState: 'IN_PROGRESS',  action: 'PAUSE',           toState: 'IN_PROGRESS_PAUSED',   requiredPerm: 'data.trip.report.own' },
      { aggregateType: 'Trip', fromState: 'IN_PROGRESS_PAUSED', action: 'RESUME',    toState: 'IN_PROGRESS',  requiredPerm: 'data.trip.report.own' },
      { aggregateType: 'Trip', fromState: 'IN_PROGRESS',  action: 'REPORT_INCIDENT', toState: 'IN_PROGRESS_DELAYED',  requiredPerm: 'data.trip.report.own' },
      { aggregateType: 'Trip', fromState: 'IN_PROGRESS_DELAYED', action: 'CLEAR_INCIDENT', toState: 'IN_PROGRESS', requiredPerm: 'data.trip.report.own' },
      { aggregateType: 'Trip', fromState: 'IN_PROGRESS',  action: 'END_TRIP',        toState: 'COMPLETED',    requiredPerm: 'data.trip.update.agency' },
      { aggregateType: 'Trip', fromState: 'PLANNED',      action: 'CANCEL',          toState: 'CANCELLED',    requiredPerm: 'data.trip.update.agency' },
      // Ticket
      { aggregateType: 'Ticket', fromState: 'CREATED',         action: 'RESERVE',   toState: 'PENDING_PAYMENT', requiredPerm: 'data.ticket.create.agency' },
      { aggregateType: 'Ticket', fromState: 'PENDING_PAYMENT', action: 'PAY',        toState: 'CONFIRMED',       requiredPerm: 'data.ticket.create.agency' },
      { aggregateType: 'Ticket', fromState: 'PENDING_PAYMENT', action: 'EXPIRE',     toState: 'EXPIRED',         requiredPerm: 'data.ticket.create.agency' },
      { aggregateType: 'Ticket', fromState: 'CONFIRMED',       action: 'CHECK_IN',   toState: 'CHECKED_IN',      requiredPerm: 'data.ticket.scan.agency' },
      { aggregateType: 'Ticket', fromState: 'CHECKED_IN',      action: 'BOARD',      toState: 'BOARDED',         requiredPerm: 'data.ticket.scan.agency' },
      { aggregateType: 'Ticket', fromState: 'CONFIRMED',       action: 'CANCEL',     toState: 'CANCELLED',       requiredPerm: 'data.ticket.cancel.agency' },
    ];

    await prisma.workflowConfig.createMany({
      data: configs.map(c => ({ ...c, tenantId, guards: [], sideEffects: [], isActive: true, version: 1 })),
      skipDuplicates: true,
    });
  }

  private async seedInstalledModules(prisma: PrismaService, tenantId: string) {
    const baseModules = ['TICKETING', 'PARCEL', 'FLEET', 'CASHIER', 'TRACKING', 'NOTIFICATIONS'];
    await prisma.installedModule.createMany({
      data:           baseModules.map(code => ({ tenantId, moduleCode: code, isActive: true })),
      skipDuplicates: true,
    });
  }
}
