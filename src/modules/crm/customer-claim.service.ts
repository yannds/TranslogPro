import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { createHash, randomBytes } from 'crypto';

/**
 * CustomerClaimService — Magic link "revendication" post-transaction anonyme.
 *
 * Flow :
 *   1. À la fin d'un ticket/colis où le Customer n'a pas encore de userId,
 *      on appelle `issueToken(customerId)` :
 *        - tire un token crypto-random (32 bytes hex = 64 chars)
 *        - stocke le SHA-256(token), jamais le clair (défense en cas de dump DB)
 *        - invalide tout précédent token actif du même Customer
 *        - envoie un message WhatsApp (fallback SMS) et/ou Email avec le lien
 *          `https://<portal>/claim?token=<clear>`
 *   2. La page portail appelle `previewToken(token)` → infos minimales non-PII
 *      pour l'aperçu (nb transactions, prénom, expiration).
 *   3. L'utilisateur crée son compte → `completeToken(token, userId)` lie le
 *      Customer à l'User et marque le token usedAt.
 *
 * Sécurité :
 *   - Token clair jamais stocké (seulement sha-256).
 *   - One-shot : usedAt ≠ null ⇒ plus utilisable.
 *   - TTL par défaut 30j (configurable plus tard par tenant).
 *   - Rate-limit côté controller (décorateur @Throttle).
 *   - Pas de fuite de PII complète au preview (masque email/phone).
 */

const DEFAULT_TTL_DAYS = 30;
// Fallback si TenantBusinessConfig absent. Jamais magic number en prod : la
// config tenant prime. Ces valeurs reflètent des défauts raisonnables pour
// un tenant moyen (200 SMS/jour, cooldown 24h).
const FALLBACK_DAILY_BUDGET      = 200;
const FALLBACK_COOLDOWN_HOURS    = 24;

type ClaimChannel = 'MAGIC_EMAIL' | 'MAGIC_WHATSAPP' | 'MAGIC_SMS';

export interface IssueTokenOptions {
  channels?: ClaimChannel[];        // ordre de préférence ; par défaut [WHATSAPP, SMS, EMAIL]
  ttlDays?:  number;                // override TTL
  portalBaseUrl?: string;           // ex. https://trans-express.translogpro.io
  createdByIp?: string;
}

export interface ClaimPreview {
  firstName:       string;          // prénom ou début du nom (pas le full name)
  ticketsCount:    number;
  parcelsCount:    number;
  expiresAt:       Date;
  channel:         ClaimChannel;
  phoneMasked?:    string;          // +242••••567
  emailMasked?:    string;          // m••@g••.com
}

@Injectable()
export class CustomerClaimService {
  private readonly logger = new Logger(CustomerClaimService.name);

  constructor(
    private readonly prisma:       PrismaService,
    private readonly notification: NotificationService,
  ) {}

  /** Émet un token + dispatche le magic link selon les canaux dispo.
   *
   * Protections anti-abus (flows publics anonymes) :
   *   - Cooldown par phone : si un token a déjà été émis pour ce phoneE164
   *     dans les `magicLinkPhoneCooldownHours` dernières heures → SKIP
   *     (anti-bombardement SMS d'un phone tiers via POST /portal/booking).
   *   - Budget quotidien tenant : si le nombre de tokens déjà émis
   *     aujourd'hui ≥ `dailyMagicLinkBudget` → SKIP (contrôle de coût
   *     opérateur, circuit-breaker contre abus massif).
   *
   * Les deux seuils viennent de `TenantBusinessConfig` (fallback codé en
   * constantes — jamais magic numbers en prod : la config tenant prime).
   *
   * Les skips retournent `null` (pas d'erreur) pour que l'appelant
   * fire-and-forget (booking/parcel) ne casse pas le flow principal. La
   * raison du skip est loggée.
   */
  async issueToken(
    tenantId:   string,
    customerId: string,
    opts:       IssueTokenOptions = {},
  ): Promise<{ token: string; channels: ClaimChannel[]; expiresAt: Date } | null> {
    const customer = await this.prisma.customer.findFirst({
      where: { tenantId, id: customerId, userId: null, deletedAt: null },
    });
    if (!customer) {
      this.logger.debug(`[CustomerClaim] customer ${customerId} not eligible (registered or deleted)`);
      return null;
    }
    if (!customer.phoneE164 && !customer.email) {
      this.logger.debug(`[CustomerClaim] customer ${customerId} has no contact channel`);
      return null;
    }

    // ── Anti-abus (cooldown phone + budget tenant) ────────────────────────
    const bizConfig = await this.prisma.tenantBusinessConfig.findUnique({
      where:  { tenantId },
      select: { dailyMagicLinkBudget: true, magicLinkPhoneCooldownHours: true },
    });
    const cooldownHours = bizConfig?.magicLinkPhoneCooldownHours ?? FALLBACK_COOLDOWN_HOURS;
    const dailyBudget   = bizConfig?.dailyMagicLinkBudget        ?? FALLBACK_DAILY_BUDGET;

    // Cooldown phone : 1 token actif max par phone sur la fenêtre
    if (customer.phoneE164 && cooldownHours > 0) {
      const cooldownFloor = new Date(Date.now() - cooldownHours * 3600_000);
      const recentForPhone = await this.prisma.customerClaimToken.findFirst({
        where: {
          tenantId,
          customer: { phoneE164: customer.phoneE164 },
          createdAt: { gte: cooldownFloor },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (recentForPhone) {
        this.logger.warn(
          `[CustomerClaim] cooldown hit phone=${this.maskPhone(customer.phoneE164)} tenant=${tenantId} (last=${recentForPhone.createdAt.toISOString()})`,
        );
        return null;
      }
    }

    // Budget tenant/jour (UTC minuit → maintenant)
    if (dailyBudget > 0) {
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      const sentToday = await this.prisma.customerClaimToken.count({
        where: { tenantId, createdAt: { gte: startOfDay } },
      });
      if (sentToday >= dailyBudget) {
        this.logger.warn(
          `[CustomerClaim] daily budget exhausted tenant=${tenantId} (${sentToday}/${dailyBudget})`,
        );
        return null;
      }
    }

    const tokenClear = randomBytes(32).toString('hex');
    const tokenHash  = this.hash(tokenClear);
    const ttlDays    = opts.ttlDays ?? DEFAULT_TTL_DAYS;
    const expiresAt  = new Date(Date.now() + ttlDays * 24 * 3600_000);

    // Canaux effectifs — filtrés par contact dispo
    const preferred = opts.channels ?? ['MAGIC_WHATSAPP', 'MAGIC_SMS', 'MAGIC_EMAIL'];
    const usable = preferred.filter(c => {
      if (c === 'MAGIC_EMAIL')    return !!customer.email;
      if (c === 'MAGIC_WHATSAPP') return !!customer.phoneE164;
      if (c === 'MAGIC_SMS')      return !!customer.phoneE164;
      return false;
    });
    if (usable.length === 0) return null;

    // Invalidation des tokens actifs précédents — 1 seul claim ouvert par client
    await this.prisma.customerClaimToken.updateMany({
      where: { customerId, usedAt: null, invalidatedAt: null, expiresAt: { gt: new Date() } },
      data:  { invalidatedAt: new Date() },
    });

    await this.prisma.customerClaimToken.create({
      data: {
        tenantId,
        customerId,
        tokenHash,
        channel:     usable[0],  // canal primaire d'envoi
        expiresAt,
        createdByIp: opts.createdByIp ?? null,
      },
    });

    // Dispatch — on envoie sur tous les canaux utilisables (max redondance pour
    // que le client reçoive le lien même si WhatsApp est offline).
    const magicUrl = this.buildMagicUrl(tokenClear, opts.portalBaseUrl);
    for (const channel of usable) {
      try {
        await this.dispatchMagicLink(tenantId, customer, channel, magicUrl);
      } catch (err) {
        this.logger.warn(
          `[CustomerClaim] dispatch ${channel} failed for customer ${customerId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    return { token: tokenClear, channels: usable, expiresAt };
  }

  /**
   * Preview : renvoie des infos NON sensibles pour la page claim.
   * Ne révèle JAMAIS le phone/email complet ni le nom complet.
   */
  async previewToken(token: string): Promise<ClaimPreview> {
    const record = await this.findActiveToken(token);

    // Defense in depth : counts tenant-scoped explicitement, même si
    // customerId est unique globalement. Protège contre un scénario où le
    // customerId serait par erreur partagé entre tenants (ex: restore
    // partiel, import cross-tenant).
    const [tickets, parcelsSent, parcelsReceived] = await Promise.all([
      this.prisma.ticket.count({ where: { customerId: record.customerId, tenantId: record.tenantId } }),
      this.prisma.parcel.count({ where: { senderCustomerId: record.customerId, tenantId: record.tenantId } }),
      this.prisma.parcel.count({ where: { recipientCustomerId: record.customerId, tenantId: record.tenantId } }),
    ]);

    const customer = await this.prisma.customer.findFirstOrThrow({
      where: { id: record.customerId, tenantId: record.tenantId },
    });

    return {
      firstName:    customer.firstName ?? (customer.name.split(' ')[0] ?? ''),
      ticketsCount: tickets,
      parcelsCount: parcelsSent + parcelsReceived,
      expiresAt:    record.expiresAt,
      channel:      record.channel as ClaimChannel,
      phoneMasked:  customer.phoneE164 ? this.maskPhone(customer.phoneE164) : undefined,
      emailMasked:  customer.email ? this.maskEmail(customer.email) : undefined,
    };
  }

  /**
   * Consomme le token : lie customer.userId = userId. Opération one-shot +
   * transactionnelle. L'appelant est responsable d'avoir créé l'User avec des
   * infos cohérentes (phone/email qui matchent le Customer).
   */
  async completeToken(token: string, userId: string): Promise<{ customerId: string }> {
    const record = await this.findActiveToken(token);

    return this.prisma.transact(async (tx) => {
      // Re-verify à l'intérieur de la transaction (course conditions)
      const current = await tx.customerClaimToken.findUnique({ where: { id: record.id } });
      if (!current || current.usedAt || current.invalidatedAt || current.expiresAt < new Date()) {
        throw new BadRequestException('Token expiré ou déjà utilisé');
      }

      const customer = await tx.customer.findUnique({ where: { id: record.customerId } });
      if (!customer) throw new NotFoundException('Customer introuvable');
      if (customer.userId) {
        throw new BadRequestException('Ce client est déjà rattaché à un compte');
      }

      // Vérifie que l'User appartient bien au même tenant (isolation)
      const user = await tx.user.findFirst({
        where: { id: userId, tenantId: record.tenantId },
        select: { id: true, customerProfile: { select: { id: true } } },
      });
      if (!user) throw new BadRequestException('Utilisateur non trouvé dans ce tenant');
      if (user.customerProfile) {
        throw new BadRequestException('Cet utilisateur est déjà rattaché à un autre client');
      }

      // Succès claim = preuve que le possesseur du phone/email a reçu le lien.
      // On peut donc basculer `phoneVerified = true` → les prochains
      // bumpCounters incrémenteront réellement les agrégats CRM de ce client.
      await tx.customer.update({
        where: { id: record.customerId },
        data:  {
          userId,
          lastSeenAt:       new Date(),
          phoneVerified:    true,
          phoneVerifiedAt:  new Date(),
          phoneVerifiedVia: 'MAGIC_LINK',
        },
      });
      await tx.customerClaimToken.update({
        where: { id: record.id },
        data:  { usedAt: new Date() },
      });

      return { customerId: record.customerId };
    });
  }

  /** Revenue le token clair en DB (recherche par hash). */
  private async findActiveToken(tokenClear: string) {
    const tokenHash = this.hash(tokenClear);
    const record = await this.prisma.customerClaimToken.findUnique({ where: { tokenHash } });
    if (!record) throw new NotFoundException('Token invalide');
    if (record.usedAt)        throw new BadRequestException('Token déjà utilisé');
    if (record.invalidatedAt) throw new BadRequestException('Token invalidé');
    if (record.expiresAt < new Date()) throw new BadRequestException('Token expiré');
    return record;
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private buildMagicUrl(token: string, portalBaseUrl?: string): string {
    const base = portalBaseUrl ?? process.env.PUBLIC_PORTAL_URL ?? 'https://translogpro.io';
    return `${base.replace(/\/$/, '')}/claim?token=${encodeURIComponent(token)}`;
  }

  private async dispatchMagicLink(
    tenantId: string,
    customer: { phoneE164: string | null; email: string | null; name: string; language: string | null },
    channel:  ClaimChannel,
    url:      string,
  ): Promise<void> {
    // Les templates i18n sont stockés côté front ou renderés par le caller.
    // Ici on envoie un message court + lien (fallback fr si pas de langue).
    const lang = customer.language ?? 'fr';
    const body = this.renderBody(lang, customer.name, url);

    if (channel === 'MAGIC_WHATSAPP' && customer.phoneE164) {
      await this.notification.send({
        tenantId,
        phone:      customer.phoneE164,
        channel:    'WHATSAPP',
        templateId: 'crm.claim.magic',
        body,
      });
    } else if (channel === 'MAGIC_SMS' && customer.phoneE164) {
      await this.notification.send({
        tenantId,
        phone:      customer.phoneE164,
        channel:    'SMS',
        templateId: 'crm.claim.magic',
        body,
      });
    } else if (channel === 'MAGIC_EMAIL' && customer.email) {
      await this.notification.send({
        tenantId,
        channel:    'EMAIL',
        templateId: 'crm.claim.magic',
        title:      this.renderSubject(lang),
        body,
        metadata:   { to: customer.email },
      });
    }
  }

  private renderBody(lang: string, name: string, url: string): string {
    if (lang === 'en') {
      return `Hello ${name}, open this link within 30 days to access your history: ${url}`;
    }
    return `Bonjour ${name}, ouvrez ce lien sous 30 jours pour accéder à votre historique : ${url}`;
  }

  private renderSubject(lang: string): string {
    return lang === 'en'
      ? 'Access your TransLog Pro history'
      : 'Accédez à votre historique TransLog Pro';
  }

  private maskPhone(e164: string): string {
    if (e164.length < 7) return e164;
    return `${e164.slice(0, 4)}••••${e164.slice(-3)}`;
  }
  private maskEmail(email: string): string {
    const [user, host] = email.split('@');
    if (!user || !host) return email;
    const uMask = user.length <= 2 ? user : `${user[0]}••${user[user.length - 1]}`;
    const hParts = host.split('.');
    const hMask  = hParts.length < 2 ? host : `${hParts[0][0]}••.${hParts.slice(1).join('.')}`;
    return `${uMask}@${hMask}`;
  }
}
