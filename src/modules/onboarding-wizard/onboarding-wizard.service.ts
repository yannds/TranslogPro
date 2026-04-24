import {
  Injectable, Logger, Inject, BadRequestException,
  ConflictException, NotFoundException, ForbiddenException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { EMAIL_SERVICE, IEmailService } from '../../infrastructure/notification/interfaces/email.interface';
import { AppConfigService } from '../../common/config/app-config.service';
import {
  UpdateBrandStepDto, UpdateAgencyStepDto, CreateFirstStationDto,
  CreateFirstRouteDto, InviteTeamStepDto,
} from './dto/onboarding-wizard.dto';

/**
 * OnboardingWizardService — orchestre les 5 étapes du wizard post-signup.
 *
 * Chaque méthode est idempotente sur son effet attendu (upsert plutôt que
 * create à l'aveugle) pour supporter la reprise à chaud si l'admin quitte
 * et revient plus tard (cookie / session active).
 *
 * Sécurité :
 *   - Toutes les méthodes prennent `tenantId` venant de la session et NE
 *     LE FONT PAS venir du body/path → pas d'escalade inter-tenant.
 *   - Le controller enforce `Permission.SETTINGS_MANAGE_TENANT` globalement.
 */
@Injectable()
export class OnboardingWizardService {
  private readonly logger = new Logger(OnboardingWizardService.name);

  constructor(
    private readonly prisma:    PrismaService,
    private readonly appConfig: AppConfigService,
    @Inject(EMAIL_SERVICE) private readonly email: IEmailService,
  ) {}

  // ─── État agrégé ────────────────────────────────────────────────────────────

  async getState(tenantId: string) {
    const [tenant, brand, agencyCount, stationCount, routeCount, userCount] =
      await Promise.all([
        this.prisma.tenant.findUnique({
          where:  { id: tenantId },
          select: {
            name: true, slug: true, language: true, country: true, currency: true,
            businessActivity: true, onboardingCompletedAt: true,
          },
        }),
        this.prisma.tenantBrand.findUnique({ where: { tenantId } }),
        this.prisma.agency.count({ where: { tenantId } }),
        this.prisma.station.count({ where: { tenantId } }),
        this.prisma.route.count({ where: { tenantId } }),
        this.prisma.user.count({ where: { tenantId, userType: 'STAFF' } }),
      ]);

    if (!tenant) throw new NotFoundException(`Tenant ${tenantId} introuvable`);

    // Une étape est "terminée" si la condition propre est vraie.
    const steps = {
      brand:   Boolean(brand?.brandName || brand?.logoUrl || brand?.primaryColor),
      agency:  agencyCount  > 0, // crée par onboarding atomique — toujours vrai en théorie
      station: stationCount > 0,
      route:   routeCount   > 0,
      team:    userCount    > 1, // > 1 car l'admin lui-même compte pour 1
    };

    const completedCount = Object.values(steps).filter(Boolean).length;
    return {
      tenant,
      steps,
      completedCount,
      totalSteps: 5,
      completedAt: tenant.onboardingCompletedAt,
      // Premier station/route existants — simplifie la reprise (pas besoin de
      // les recréer, juste de les détecter pour sauter les étapes).
      // Station n'a pas de createdAt en schema → ordre par id (cuid monotone).
      firstStationId: stationCount > 0
        ? (await this.prisma.station.findFirst({
            where: { tenantId }, orderBy: { id: 'asc' }, select: { id: true },
          }))?.id ?? null
        : null,
    };
  }

  // ─── Étape 1 : Branding (TenantBrand upsert) ────────────────────────────────

  async updateBrand(tenantId: string, dto: UpdateBrandStepDto) {
    const update = Object.fromEntries(Object.entries({
      brandName:    dto.brandName,
      logoUrl:      dto.logoUrl,
      faviconUrl:   dto.faviconUrl,
      primaryColor: dto.primaryColor,
      supportEmail: dto.supportEmail,
    }).filter(([, v]) => v !== undefined));

    // `brandName` est NOT NULL en schema — à la création, on dérive depuis Tenant.name
    // si l'admin n'a pas saisi de marque (improbable côté UI, mais défense en profondeur).
    let fallbackBrandName = dto.brandName;
    if (!fallbackBrandName) {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
      fallbackBrandName = tenant?.name ?? 'TransLog Pro';
    }

    return this.prisma.tenantBrand.upsert({
      where:  { tenantId },
      update,
      create: { tenantId, brandName: fallbackBrandName, ...update },
    });
  }

  // ─── Étape 2 : Renommer l'agence par défaut ────────────────────────────────

  async renameDefaultAgency(tenantId: string, dto: UpdateAgencyStepDto) {
    // "Agence par défaut" = la plus ancienne. C'est celle créée par l'onboarding
    // atomique. Si l'admin a déjà renommé manuellement, l'opération est un
    // no-op sémantique (on écrit le même nom).
    // Agency n'a pas de createdAt en schema → ordre par id (cuid monotone).
    const first = await this.prisma.agency.findFirst({
      where:   { tenantId },
      orderBy: { id: 'asc' },
      select:  { id: true, name: true },
    });
    if (!first) throw new ConflictException('Aucune agence à renommer — invariant violé');

    return this.prisma.agency.update({
      where: { id: first.id },
      data:  { name: dto.name },
    });
  }

  // ─── Étape 3 : Première station ─────────────────────────────────────────────

  async createFirstStation(tenantId: string, dto: CreateFirstStationDto) {
    // Si une station existe déjà, on n'en crée pas une seconde silencieusement
    // (l'admin pourrait croire avoir refait l'étape). On met à jour le nom/ville.
    const existing = await this.prisma.station.findFirst({
      where:   { tenantId },
      orderBy: { id: 'asc' },
    });
    const coords = dto.lat != null && dto.lng != null ? { lat: dto.lat, lng: dto.lng } : {};

    if (existing) {
      return this.prisma.station.update({
        where: { id: existing.id },
        data:  {
          name:        dto.name,
          city:        dto.city,
          type:        dto.type ?? existing.type,
          coordinates: coords,
        },
      });
    }

    return this.prisma.station.create({
      data: {
        tenantId,
        name:        dto.name,
        city:        dto.city,
        type:        dto.type ?? 'PRINCIPALE',
        coordinates: coords,
      },
    });
  }

  // ─── Étape 4a : Première route (si TICKETING/MIXED) ────────────────────────

  async createFirstRoute(tenantId: string, dto: CreateFirstRouteDto) {
    // Vérifie la station d'origine — isolation tenant.
    const origin = await this.prisma.station.findFirst({
      where:  { id: dto.originStationId, tenantId },
    });
    if (!origin) throw new ForbiddenException('Station d\'origine invalide pour ce tenant');

    // Destination : crée si un nom+ville ne correspond pas à une station existante.
    let destination = await this.prisma.station.findFirst({
      where: { tenantId, city: dto.destinationCity, name: dto.destinationName },
    });
    if (!destination) {
      destination = await this.prisma.station.create({
        data: {
          tenantId,
          name:        dto.destinationName,
          city:        dto.destinationCity,
          type:        'PRINCIPALE',
          coordinates: {},
        },
      });
    }

    // Route : "Origine → Destination".
    const routeName = `${origin.city} → ${destination.city}`;
    const existing  = await this.prisma.route.findFirst({
      where: { tenantId, name: routeName },
    });
    if (existing) return existing;

    return this.prisma.route.create({
      data: {
        tenantId,
        name:          routeName,
        originId:      origin.id,
        destinationId: destination.id,
        distanceKm:    dto.distanceKm ?? 0,
        basePrice:     dto.basePrice  ?? 0,
      },
    });
  }

  // ─── Étape 5 : Inviter l'équipe ─────────────────────────────────────────────

  async inviteTeam(tenantId: string, dto: InviteTeamStepDto) {
    const tenant = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { slug: true, language: true, name: true },
    });
    if (!tenant) throw new NotFoundException(`Tenant ${tenantId} introuvable`);

    // Résolution des rôles par slug — crée un index nom → id pour la demande.
    const roleSlugs = Array.from(new Set(dto.invites.map(i => i.roleSlug.toUpperCase())));
    const roles = await this.prisma.role.findMany({
      where:  { tenantId, name: { in: roleSlugs } },
      select: { id: true, name: true },
    });
    const roleByName = new Map(roles.map(r => [r.name.toUpperCase(), r.id]));
    const missing = roleSlugs.filter(s => !roleByName.has(s));
    if (missing.length) {
      throw new BadRequestException(`Rôles inconnus pour ce tenant : ${missing.join(', ')}`);
    }

    // L'agence par défaut — rattachement RH initial des invités.
    const defaultAgency = await this.prisma.agency.findFirst({
      where:   { tenantId },
      orderBy: { id: 'asc' },
      select:  { id: true },
    });

    const results: Array<{ email: string; userId?: string; status: 'created' | 'existing' | 'error'; reason?: string }> = [];

    for (const inv of dto.invites) {
      try {
        // Idempotent : si le user existe déjà dans ce tenant, on ne re-crée pas.
        const existing = await this.prisma.user.findFirst({
          where: { tenantId, email: inv.email },
        });
        if (existing) { results.push({ email: inv.email, userId: existing.id, status: 'existing' }); continue; }

        const user = await this.prisma.user.create({
          data: {
            tenantId,
            email:    inv.email,
            name:     inv.name,
            userType: 'STAFF',
            roleId:   roleByName.get(inv.roleSlug.toUpperCase())!,
            agencyId: defaultAgency?.id ?? null,
          },
        });

        // Account credential placeholder : password aléatoire invalide +
        // `forcePasswordChange=true`. Indispensable pour que l'invité puisse :
        //   1. Utiliser "mot de passe oublié" sur la page login (flow self).
        //   2. Recevoir un reset admin-initié depuis /admin/iam/users.
        // Sans cette row, le flow reset tombait sur 400 "Ce compte ne possède
        // pas d'identifiants" — fixé aussi en self-heal côté PasswordResetService.
        const randomHash = await bcrypt.hash(randomBytes(32).toString('hex'), 12);
        await this.prisma.account.create({
          data: {
            tenantId,
            userId:              user.id,
            providerId:          'credential',
            accountId:           inv.email,
            password:            randomHash,
            forcePasswordChange: true,
          },
        });

        // Fire-and-forget : email de bienvenue collègue (template simple inline).
        void this.sendColleagueInvite({
          toEmail:    inv.email,
          toName:     inv.name,
          tenantName: tenant.name,
          tenantSlug: tenant.slug,
          locale:     (tenant.language as any) ?? 'fr',
        });

        results.push({ email: inv.email, userId: user.id, status: 'created' });
      } catch (err) {
        this.logger.warn(`Invite ${inv.email} failed: ${(err as Error).message}`);
        results.push({ email: inv.email, status: 'error', reason: (err as Error).message });
      }
    }

    return { invites: results };
  }

  // ─── Finalisation ───────────────────────────────────────────────────────────

  async complete(tenantId: string) {
    return this.prisma.tenant.update({
      where: { id: tenantId },
      data:  { onboardingCompletedAt: new Date() },
      select: { id: true, onboardingCompletedAt: true },
    });
  }

  // ─── Helper email invite collègue ───────────────────────────────────────────

  private async sendColleagueInvite(p: {
    toEmail: string; toName: string; tenantName: string; tenantSlug: string; locale: string;
  }) {
    const baseDomain = this.appConfig.publicBaseDomain;
    const resetUrl   = `https://${p.tenantSlug}.${baseDomain}/auth/forgot-password?email=${encodeURIComponent(p.toEmail)}`;

    // Sujet + corps très courts — l'invite est secondaire à l'onboarding.
    const bundles: Record<string, { subject: string; body: string; cta: string }> = {
      fr: {
        subject: `Vous êtes invité(e) sur ${p.tenantName} (TransLog Pro)`,
        body:    `Bonjour ${p.toName},\n\nVous avez été invité(e) à rejoindre "${p.tenantName}" sur TransLog Pro. Pour commencer, définissez votre mot de passe via le lien ci-dessous.`,
        cta:     'Définir mon mot de passe',
      },
      en: {
        subject: `You're invited to ${p.tenantName} on TransLog Pro`,
        body:    `Hi ${p.toName},\n\nYou've been invited to join "${p.tenantName}" on TransLog Pro. To get started, set your password using the link below.`,
        cta:     'Set my password',
      },
    };
    const b = bundles[p.locale] ?? bundles.fr;

    const html = `<!doctype html>
<html lang="${p.locale}">
<body style="margin:0;padding:0;background:#f8fafc;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f8fafc;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="520" style="max-width:520px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;">
        <tr><td style="padding:24px;font-size:15px;line-height:1.6;">
          <p style="margin:0 0 14px;">${escapeHtml(b.body).replace(/\n/g, '<br>')}</p>
          <p style="margin:18px 0;">
            <a href="${resetUrl}" style="display:inline-block;background:#0d9488;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">
              ${escapeHtml(b.cta)} →
            </a>
          </p>
          <p style="margin:0;color:#64748b;font-size:13px;">TransLog Pro</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    try {
      await this.email.send({
        to:       { email: p.toEmail, name: p.toName },
        subject:  b.subject,
        html,
        text:     `${b.body}\n\n${b.cta}: ${resetUrl}\n\n— TransLog Pro`,
        category: 'transactional',
        tenantId: null,
        idempotencyKey: `invite:${p.tenantSlug}:${p.toEmail}`,
      });
    } catch (err) {
      this.logger.warn(`Colleague invite email failed to=${p.toEmail}: ${(err as Error).message}`);
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
