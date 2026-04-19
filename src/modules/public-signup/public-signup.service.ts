import {
  Injectable, Logger, Inject, BadRequestException, ConflictException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { PlatformBillingService } from '../platform-billing/platform-billing.service';
import { PlatformPlansService } from '../platform-plans/platform-plans.service';
import { AuthService } from '../auth/auth.service';
import { EMAIL_SERVICE, IEmailService } from '../../infrastructure/notification/interfaces/email.interface';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { WaitlistSubmitDto } from './dto/waitlist.dto';
import { PublicSignupDto } from './dto/signup.dto';
import { buildWelcomeEmail, type SignupLocale } from './emails/welcome.template';
import { buildWaitlistEmail } from './emails/waitlist.template';

// `waitlist.maxAttemptsPerEmail` vit désormais dans PlatformConfig — voir
// platform-config.registry.ts. Lu dynamiquement à chaque soumission.

/**
 * Routes publiques d'inscription SaaS :
 *   - Waitlist : capture prospect early-access (email seul)
 *   - Signup   : provisioning complet d'un nouveau tenant (admin + plan TRIAL)
 *   - Plans    : catalogue public
 *
 * Chaque opération :
 *   1. Valide côté DTO (class-validator)
 *   2. Hash les traces IP / User-Agent (RGPD — pas de PII brute)
 *   3. Compose les services métiers existants (OnboardingService,
 *      PlatformBillingService, AuthService) — zéro duplication.
 */
@Injectable()
export class PublicSignupService {
  private readonly logger = new Logger(PublicSignupService.name);

  constructor(
    private readonly prisma:   PrismaService,
    private readonly onboard:  OnboardingService,
    private readonly billing:  PlatformBillingService,
    private readonly plans:    PlatformPlansService,
    private readonly auth:     AuthService,
    private readonly config:   PlatformConfigService,
    @Inject(EMAIL_SERVICE) private readonly email: IEmailService,
  ) {}

  // ─── Waitlist ──────────────────────────────────────────────────────────────

  async submitWaitlist(dto: WaitlistSubmitDto, meta: { ip: string; ua: string }) {
    const maxAttempts = await this.config.getNumber('waitlist.maxAttemptsPerEmail');
    const existing = await this.prisma.waitlist.findUnique({ where: { email: dto.email } });

    if (existing && existing.attempts >= maxAttempts) {
      // Protection basique contre le spam répété sur le même email.
      this.logger.warn(`Waitlist max attempts reached for ${mask(dto.email)}`);
      // Réponse idempotente — on ne révèle pas l'état.
      return { ok: true as const };
    }

    if (existing) {
      await this.prisma.waitlist.update({
        where: { email: dto.email },
        data:  {
          lastAttemptAt: new Date(),
          attempts:      { increment: 1 },
          locale:        dto.locale      ?? existing.locale,
          source:        dto.source      ?? existing.source,
          referrer:      dto.referrer    ?? existing.referrer,
          utmSource:     dto.utmSource   ?? existing.utmSource,
          utmMedium:     dto.utmMedium   ?? existing.utmMedium,
          utmCampaign:   dto.utmCampaign ?? existing.utmCampaign,
        },
      });
    } else {
      await this.prisma.waitlist.create({
        data: {
          email:         dto.email,
          locale:        dto.locale,
          source:        dto.source,
          referrer:      dto.referrer,
          utmSource:     dto.utmSource,
          utmMedium:     dto.utmMedium,
          utmCampaign:   dto.utmCampaign,
          ipHash:        hash(meta.ip),
          userAgentHash: hash(meta.ua),
        },
      });
      this.logger.log(`Waitlist new entry: ${mask(dto.email)} (locale=${dto.locale ?? '-'})`);

      // Email de confirmation — fire-and-forget, ne bloque jamais la réponse HTTP.
      // Un échec est logué mais n'invalide pas l'inscription côté DB.
      void this.sendWaitlistConfirmation(dto.email, (dto.locale as SignupLocale) ?? 'fr');
    }

    return { ok: true as const };
  }

  private async sendWaitlistConfirmation(to: string, locale: SignupLocale) {
    try {
      const tmpl = buildWaitlistEmail({ to: { email: to }, locale });
      await this.email.send({
        to:        { email: to },
        subject:   tmpl.subject,
        html:      tmpl.html,
        text:      tmpl.text,
        category:  'transactional',
        tenantId:  null,
        idempotencyKey: `waitlist:${to}`,
      });
    } catch (err) {
      this.logger.warn(`Waitlist confirmation email failed for ${mask(to)}: ${(err as Error).message}`);
    }
  }

  // ─── Plans catalogue public ────────────────────────────────────────────────

  async listPublicPlans() {
    const all = await this.plans.listCatalog();
    // Exposer uniquement les champs nécessaires côté landing (zéro PII, zéro
    // métrique plateforme). Les `limits` et `sla` restent en JSON libre.
    return all.map(p => ({
      id:           p.id,
      slug:         p.slug,
      name:         p.name,
      description:  p.description,
      price:        p.price,
      currency:     p.currency,
      billingCycle: p.billingCycle,
      trialDays:    p.trialDays,
      limits:       p.limits,
      sla:          p.sla,
      sortOrder:    p.sortOrder,
      modules:      p.modules.map(m => m.moduleKey),
    }));
  }

  // ─── Signup (création tenant + admin + abonnement TRIAL) ───────────────────

  async signup(dto: PublicSignupDto, meta: { ip: string; ua: string }) {
    // 1. Slug disponibilité — court-circuit rapide pour un meilleur message UX.
    const clash = await this.prisma.tenant.findUnique({ where: { slug: dto.slug } });
    if (clash) throw new ConflictException(`Le sous-domaine "${dto.slug}" est déjà pris`);

    // 2. Email admin dédupliqué côté DB (par (tenantId, providerId, accountId))
    //    mais ici tenantId n'existe pas encore — pas de vérification prématurée.

    // 3. Choix du plan : soit slug fourni, soit premier public actif.
    const catalog = await this.plans.listCatalog();
    if (catalog.length === 0) {
      throw new BadRequestException('Aucun plan public disponible — contactez-nous.');
    }
    const chosen = dto.planSlug
      ? catalog.find(p => p.slug === dto.planSlug)
      : catalog[0];
    if (!chosen) throw new BadRequestException(`Plan "${dto.planSlug}" introuvable`);

    // 4. Onboarding atomique (tenant + rôles + agence par défaut + admin + modules…)
    const { tenant, admin } = await this.onboard.onboard({
      name:             dto.companyName,
      slug:             dto.slug,
      adminEmail:       dto.adminEmail,
      adminName:        dto.adminName,
      country:          dto.country  ?? 'CG',
      language:         (dto.language as any) ?? 'fr',
      businessActivity: dto.activity,
    });

    // 5. Compte credential (bcrypt 12 rounds) — hors transaction onboarding
    //    volontairement : un échec ici ne doit pas rollback le tenant ; le user
    //    pourra récupérer via "mot de passe oublié".
    try {
      await this.auth.createCredentialAccount(tenant.id, admin.id, dto.adminEmail, dto.password);
    } catch (err) {
      this.logger.error(`Signup OK tenant=${tenant.slug} mais createCredentialAccount a échoué: ${(err as Error).message}`);
      // On ne propage pas — le tenant existe, l'admin peut faire "mot de passe oublié".
    }

    // 6. Abonnement TRIAL (trialDays lu depuis Plan.trialDays côté billing)
    try {
      await this.billing.createSubscription({
        tenantId: tenant.id,
        planId:   chosen.id,
      });
    } catch (err) {
      this.logger.error(`Signup OK tenant=${tenant.slug} mais createSubscription a échoué: ${(err as Error).message}`);
    }

    this.logger.log(
      `Public signup: tenant=${tenant.slug} admin=${mask(dto.adminEmail)} plan=${chosen.slug} ` +
      `ip=${hash(meta.ip).slice(0, 8)}`,
    );

    // 7. Email de bienvenue — fire-and-forget. Tenant déjà créé, on n'échoue
    //    pas la réponse HTTP si l'envoi rate (logé côté provider + ici).
    void this.sendWelcomeEmail({
      to:         dto.adminEmail,
      adminName:  dto.adminName,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      trialDays:  chosen.trialDays,
      locale:     (dto.language as SignupLocale) ?? 'fr',
    });

    return {
      ok:         true as const,
      tenantId:   tenant.id,
      tenantSlug: tenant.slug,
      planSlug:   chosen.slug,
      trialDays:  chosen.trialDays,
      loginPath:  `/login`,
    };
  }

  private async sendWelcomeEmail(input: {
    to: string; adminName: string; tenantName: string; tenantSlug: string;
    trialDays: number; locale: SignupLocale;
  }) {
    const baseDomain = process.env.PLATFORM_BASE_DOMAIN ?? 'translogpro.com';
    const proto      = process.env.NODE_ENV === 'production' ? 'https' : 'https';
    const tenantUrl  = `${proto}://${input.tenantSlug}.${baseDomain}`;
    const loginUrl   = `${tenantUrl}/login`;

    try {
      const tmpl = buildWelcomeEmail({
        to:         { email: input.to, name: input.adminName },
        adminName:  input.adminName,
        tenantName: input.tenantName,
        tenantUrl,
        loginUrl,
        trialDays:  input.trialDays,
        locale:     input.locale,
      });
      await this.email.send({
        to:       { email: input.to, name: input.adminName },
        subject:  tmpl.subject,
        html:     tmpl.html,
        text:     tmpl.text,
        category: 'transactional',
        tenantId: null,
        idempotencyKey: `welcome:${input.tenantSlug}`,
      });
    } catch (err) {
      this.logger.warn(`Welcome email failed for tenant=${input.tenantSlug}: ${(err as Error).message}`);
    }
  }
}

// ─── Helpers locaux ──────────────────────────────────────────────────────────

function hash(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function mask(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  const prefix = local.slice(0, Math.min(2, local.length));
  return `${prefix}***@${domain}`;
}
