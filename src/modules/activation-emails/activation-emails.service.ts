import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { EMAIL_SERVICE, IEmailService } from '../../infrastructure/notification/interfaces/email.interface';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import {
  buildActivationEmail, type ActivationDay, type ActivationLocale,
} from './emails/activation.templates';

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY  = 24 * MS_PER_HOUR;

/**
 * ActivationEmailService — drip post-signup en 3 emails maximum.
 *
 *   day1 — 24h+ après signup, si onboarding pas terminé
 *   day3 — 72h+ après signup, si aucun user STAFF invité (admin seul)
 *   day7 — 7 jours+, si aucun ticket ni colis créé
 *
 * Idempotence : `Tenant.activationEmailsSent` (JSON) stocke la date d'envoi de
 * chaque jour. Un tenant ne reçoit JAMAIS 2x le même email.
 *
 * Exécution : cron quotidien à 09h00 UTC (voir @Cron en bas).
 * Production : pilotable via `ACTIVATION_EMAILS_ENABLED=false` pour couper
 * temporairement sans redéployer.
 */
@Injectable()
export class ActivationEmailsService {
  private readonly logger = new Logger(ActivationEmailsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: PlatformConfigService,
    @Inject(EMAIL_SERVICE) private readonly email: IEmailService,
  ) {}

  @Cron('0 9 * * *') // 09:00 chaque jour — convention de scheduling, pas une valeur métier
  async runDailyDrip(): Promise<void> {
    if (process.env.ACTIVATION_EMAILS_ENABLED === 'false') {
      this.logger.log('Skipped — ACTIVATION_EMAILS_ENABLED=false');
      return;
    }
    this.logger.log('▶ Activation drip started');

    const now = Date.now();

    // Fenêtres de tir pilotées par PlatformConfig — zéro magic number.
    const [day1Hrs, day3Hrs, day7Hrs, maxAgeDays] = await Promise.all([
      this.config.getNumber('activation.day1.ageHours'),
      this.config.getNumber('activation.day3.ageHours'),
      this.config.getNumber('activation.day7.ageHours'),
      this.config.getNumber('activation.maxAgeDays'),
    ]);
    const maxAgeMs = maxAgeDays * MS_PER_DAY;

    // day1 tombe dans [day1Hrs, day3Hrs[ ; day3 dans [day3Hrs, day7Hrs[ ;
    // day7 dans [day7Hrs, maxAgeDays[. Bornes strictes pour éviter les doublons
    // quand les bornes chevauchent avec le jour suivant.
    const day1Candidates = await this.prisma.tenant.findMany({
      where: {
        createdAt: { lt: new Date(now - day1Hrs * MS_PER_HOUR), gte: new Date(now - day3Hrs * MS_PER_HOUR) },
        onboardingCompletedAt: null,
      },
      include: this.tenantInclude(),
    });
    const day3Candidates = await this.prisma.tenant.findMany({
      where: {
        createdAt: { lt: new Date(now - day3Hrs * MS_PER_HOUR), gte: new Date(now - day7Hrs * MS_PER_HOUR) },
      },
      include: this.tenantInclude(),
    });
    const day7Candidates = await this.prisma.tenant.findMany({
      where: {
        createdAt: { lt: new Date(now - day7Hrs * MS_PER_HOUR), gte: new Date(now - maxAgeMs) },
      },
      include: this.tenantInclude(),
    });

    let sent = 0;
    for (const tenant of day1Candidates) { if (await this.tryDay(tenant, 'day1')) sent++; }
    for (const tenant of day3Candidates) { if (await this.shouldDay3(tenant.id) && await this.tryDay(tenant, 'day3')) sent++; }
    for (const tenant of day7Candidates) { if (await this.shouldDay7(tenant.id) && await this.tryDay(tenant, 'day7')) sent++; }

    this.logger.log(`◀ Activation drip done — ${sent} email(s) sent`);
  }

  // ─── Guardrails par jour ────────────────────────────────────────────────────

  /** Condition day3 : aucun user STAFF autre que l'admin de création. */
  private async shouldDay3(tenantId: string): Promise<boolean> {
    const count = await this.prisma.user.count({ where: { tenantId, userType: 'STAFF' } });
    return count <= 1;
  }

  /** Condition day7 : aucune vente et aucun colis. */
  private async shouldDay7(tenantId: string): Promise<boolean> {
    const [tickets, parcels] = await Promise.all([
      this.prisma.ticket.count({ where: { tenantId } }),
      this.prisma.parcel.count({ where: { tenantId } }),
    ]);
    return tickets === 0 && parcels === 0;
  }

  // ─── Envoi idempotent ──────────────────────────────────────────────────────

  private async tryDay(
    tenant: Awaited<ReturnType<typeof this.findTenantForSend>>,
    day: ActivationDay,
  ): Promise<boolean> {
    if (!tenant) return false;
    const sent = (tenant.activationEmailsSent ?? {}) as Record<string, string>;
    if (sent[day]) {
      // Déjà envoyé → pas de doublon, même si le tenant retombe dans la fenêtre.
      return false;
    }

    const admin = tenant.users[0];
    if (!admin?.email) { this.logger.warn(`No admin email for tenant=${tenant.slug} — skip ${day}`); return false; }

    const baseDomain = process.env.PLATFORM_BASE_DOMAIN ?? 'translogpro.com';
    const tenantUrl  = `https://${tenant.slug}.${baseDomain}`;

    try {
      const tmpl = buildActivationEmail(day, {
        to:         { email: admin.email, name: admin.name ?? admin.email },
        adminName:  admin.name ?? admin.email.split('@')[0]!,
        tenantName: tenant.name,
        tenantSlug: tenant.slug,
        loginUrl:      `${tenantUrl}/login`,
        onboardingUrl: `${tenantUrl}/onboarding`,
        locale:     ((tenant.language ?? 'fr') as ActivationLocale),
      });

      await this.email.send({
        to:       { email: admin.email, name: admin.name ?? undefined },
        subject:  tmpl.subject,
        html:     tmpl.html,
        text:     tmpl.text,
        category: 'transactional',
        tenantId: tenant.id,
        idempotencyKey: `activation:${day}:${tenant.id}`,
      });

      // Mark as sent — JSON merge minimal, atomique à l'update.
      await this.prisma.tenant.update({
        where: { id: tenant.id },
        data:  { activationEmailsSent: { ...sent, [day]: new Date().toISOString() } },
      });

      this.logger.log(`[activation] ${day} sent to tenant=${tenant.slug}`);
      return true;
    } catch (err) {
      this.logger.warn(`[activation] ${day} failed for tenant=${tenant.slug}: ${(err as Error).message}`);
      return false;
    }
  }

  private tenantInclude() {
    return {
      users: {
        where:   { userType: 'STAFF' },
        orderBy: { id: 'asc' } as const,
        take:    1,
        select:  { id: true, email: true, name: true },
      },
    };
  }

  /** Type helper pour le return of findMany(...tenantInclude()). */
  private async findTenantForSend(id: string) {
    return this.prisma.tenant.findUnique({
      where:  { id },
      include: this.tenantInclude(),
    });
  }
}
