/**
 * VoucherNotificationListener — fan-out multi-canal sur VOUCHER_ISSUED.
 *
 * Architecture (mêmes garanties que InvoiceNotificationListener) :
 *   - Subscribe via IEventBus (Outbox).
 *   - tenantId pris UNIQUEMENT depuis l'event (jamais le payload).
 *   - Multi-canal : IN_APP (si userId) + WhatsApp→SMS fallback (si phone) +
 *     EMAIL (si email).
 *   - i18n : Customer.language → tenant.language → 'fr'.
 *   - Killswitch : `notifications.lifecycle.enabled`.
 *   - Aucune exception remontée — un échec destinataire n'arrête pas le flow.
 *
 * Source des coordonnées du destinataire :
 *   1. Si `voucher.customerId` → lookup Customer (userId, email, phone, name, language).
 *   2. Sinon, fallback sur `voucher.recipientEmail` / `voucher.recipientPhone`.
 *   3. Si rien des deux → log debug et skip.
 */

import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  IEventBus,
  EVENT_BUS,
  DomainEvent,
} from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { EventTypes } from '../../common/types/domain-event.type';
import { NotificationService } from './notification.service';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { renderVoucherTemplate } from './email-templates/voucher-templates';

interface VoucherRecipient {
  userId?:   string | null;
  phone?:    string | null;
  email?:    string | null;
  name?:     string | null;
  language?: string | null;
}

@Injectable()
export class VoucherNotificationListener implements OnModuleInit {
  private readonly logger = new Logger(VoucherNotificationListener.name);

  constructor(
    private readonly prisma:        PrismaService,
    private readonly notifications: NotificationService,
    private readonly platformConfig: PlatformConfigService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  onModuleInit(): void {
    this.eventBus.subscribe(EventTypes.VOUCHER_ISSUED, (e) => this.onVoucherIssued(e));
  }

  private async onVoucherIssued(event: DomainEvent): Promise<void> {
    if (!(await this.lifecycleEnabled())) return;

    const tenantId  = event.tenantId;
    const voucherId = (event.payload as { voucherId?: string }).voucherId ?? event.aggregateId;

    try {
      const voucher = await this.prisma.voucher.findFirst({
        where: { id: voucherId, tenantId },
        select: {
          id:             true,
          code:           true,
          amount:         true,
          currency:       true,
          validityEnd:    true,
          usageScope:     true,
          origin:         true,
          customerId:     true,
          recipientEmail: true,
          recipientPhone: true,
        },
      });
      if (!voucher) {
        this.logger.debug(`[Voucher VOUCHER_ISSUED] voucher ${voucherId} introuvable (tenant ${tenantId})`);
        return;
      }

      const recipient = await this.resolveRecipient(tenantId, voucher);
      if (!recipient.email && !recipient.phone && !recipient.userId) {
        this.logger.debug(`[Voucher VOUCHER_ISSUED] aucun canal de contact — skip (voucher=${voucher.id})`);
        return;
      }

      const lang = await this.resolveLanguage(tenantId, recipient.language);
      const out  = renderVoucherTemplate('voucher.issued', lang, {
        recipientName:   recipient.name ?? '',
        voucherCode:     voucher.code,
        formattedAmount: `${formatNumber(voucher.amount)} ${voucher.currency}`,
        validityEnd:     formatDateLong(voucher.validityEnd, lang),
        scopeLabel:      scopeLabel(voucher.usageScope, lang),
        originLabel:     originLabel(voucher.origin, lang),
        redeemUrl:       '', // pas de portail dédié pour l'instant — bouton non rendu
      });

      const meta = { voucherId: voucher.id, code: voucher.code };

      if (recipient.userId) {
        await this.notifications.send({
          tenantId,
          userId:     recipient.userId,
          channel:    'IN_APP',
          templateId: 'voucher.issued',
          title:      out.title,
          body:       out.body,
          metadata:   meta,
        });
      }
      if (recipient.phone) {
        await this.notifications.sendWithChannelFallback({
          tenantId,
          phone:      recipient.phone,
          templateId: 'voucher.issued',
          title:      out.title,
          body:       out.body,
          metadata:   meta,
        });
      }
      if (recipient.email) {
        await this.notifications.send({
          tenantId,
          userId:     recipient.userId ?? undefined,
          email:      recipient.email,
          channel:    'EMAIL',
          templateId: 'voucher.issued',
          title:      out.title,
          body:       out.body,
          html:       out.html,
          metadata:   meta,
        });
      }
    } catch (err) {
      this.logger.error(
        `[Voucher VOUCHER_ISSUED] dispatch failed (voucher=${voucherId}): ${(err as Error).message}`,
      );
    }
  }

  /**
   * Construit le destinataire à partir du voucher :
   *  - customerId présent → lookup Customer (canal de référence)
   *  - sinon, fallback sur recipientEmail/recipientPhone du voucher (contact libre)
   */
  private async resolveRecipient(
    tenantId: string,
    voucher: { customerId: string | null; recipientEmail: string | null; recipientPhone: string | null },
  ): Promise<VoucherRecipient> {
    if (voucher.customerId) {
      const c = await this.prisma.customer.findFirst({
        where:  { id: voucher.customerId, tenantId },
        select: { name: true, email: true, phoneE164: true, userId: true, language: true },
      });
      if (c) {
        return {
          userId:   c.userId,
          email:    c.email   ?? voucher.recipientEmail ?? null,
          phone:    c.phoneE164 ?? voucher.recipientPhone ?? null,
          name:     c.name,
          language: c.language,
        };
      }
    }
    return {
      userId:   null,
      email:    voucher.recipientEmail ?? null,
      phone:    voucher.recipientPhone ?? null,
      name:     null,
      language: null,
    };
  }

  private async resolveLanguage(
    tenantId:    string,
    customerLang: string | null | undefined,
  ): Promise<'fr' | 'en'> {
    if (customerLang === 'fr' || customerLang === 'en') return customerLang;
    const tenant = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { language: true },
    });
    return tenant?.language === 'en' ? 'en' : 'fr';
  }

  private async lifecycleEnabled(): Promise<boolean> {
    try {
      return await this.platformConfig.getBoolean('notifications.lifecycle.enabled');
    } catch {
      return true;
    }
  }
}

// ─── Helpers (purs) ─────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  if (typeof n !== 'number' || Number.isNaN(n)) return '0';
  return Math.round(n).toLocaleString('fr-FR').replace(/ /g, ' ');
}

function formatDateLong(d: Date, lang: 'fr' | 'en'): string {
  return d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

/** Libellé de portée d'usage du voucher selon la langue. */
function scopeLabel(scope: string, lang: 'fr' | 'en'): string {
  if (lang === 'en') {
    if (scope === 'ANY_TRIP')     return 'on any of our trips';
    if (scope === 'SAME_ROUTE')   return 'on the same route';
    return 'within our company';
  }
  if (scope === 'ANY_TRIP')   return 'sur tous nos trajets';
  if (scope === 'SAME_ROUTE') return 'sur la même ligne';
  return 'au sein de notre compagnie';
}

/** Libellé de l'origine du voucher selon la langue (sans valeur honteuse en prod). */
function originLabel(origin: string, lang: 'fr' | 'en'): string {
  if (lang === 'en') {
    if (origin === 'INCIDENT')     return 'incident compensation';
    if (origin === 'MAJOR_DELAY')  return 'major delay compensation';
    if (origin === 'PROMO')        return 'promotional offer';
    if (origin === 'GESTURE')      return 'goodwill gesture';
    return 'commercial gesture';
  }
  if (origin === 'INCIDENT')    return 'compensation incident';
  if (origin === 'MAJOR_DELAY') return 'compensation retard majeur';
  if (origin === 'PROMO')       return 'offre promotionnelle';
  if (origin === 'GESTURE')     return 'geste commercial';
  return 'geste commercial';
}
