/**
 * RefundNotificationListener — fan-out multi-canal sur les events
 * REFUND_CREATED / REFUND_APPROVED / REFUND_AUTO_APPROVED / REFUND_REJECTED.
 *
 * APPROVED et AUTO_APPROVED utilisent le MÊME template (`refund.approved`)
 * — l'expérience utilisateur est identique : "votre remboursement est validé".
 * Pour le système ce sont 2 events distincts (audit, métriques) mais pour le
 * client c'est la même bonne nouvelle.
 *
 * REFUND_PROCESSED est volontairement non-écouté pour ce tier — l'event est
 * émis par RefundService mais sans template associé. Un futur "virement
 * effectué" pourra simplement ajouter une subscribe + un template.
 *
 * Source des coordonnées du destinataire : Refund.ticketId → Ticket
 * (passengerName/Email/Phone + customer.userId/language). Si le ticket
 * est introuvable (orphelin), on skip silencieusement.
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
import { renderRefundTemplate, RefundTemplateId } from './email-templates/refund-templates';

interface RefundRecipient {
  userId?:   string | null;
  phone?:    string | null;
  email?:    string | null;
  name?:     string | null;
  language?: string | null;
}

@Injectable()
export class RefundNotificationListener implements OnModuleInit {
  private readonly logger = new Logger(RefundNotificationListener.name);

  constructor(
    private readonly prisma:        PrismaService,
    private readonly notifications: NotificationService,
    private readonly platformConfig: PlatformConfigService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  onModuleInit(): void {
    this.eventBus.subscribe(EventTypes.REFUND_CREATED,        (e) => this.handle(e, 'refund.created'));
    this.eventBus.subscribe(EventTypes.REFUND_APPROVED,       (e) => this.handle(e, 'refund.approved'));
    this.eventBus.subscribe(EventTypes.REFUND_AUTO_APPROVED,  (e) => this.handle(e, 'refund.approved'));
    this.eventBus.subscribe(EventTypes.REFUND_REJECTED,       (e) => this.handle(e, 'refund.rejected'));
  }

  private async handle(event: DomainEvent, templateId: RefundTemplateId): Promise<void> {
    if (!(await this.lifecycleEnabled())) return;

    const tenantId = event.tenantId;
    const refundId = (event.payload as { refundId?: string }).refundId ?? event.aggregateId;

    try {
      const refund = await this.prisma.refund.findFirst({
        where: { id: refundId, tenantId },
        select: {
          id:             true,
          ticketId:       true,
          amount:         true,
          originalAmount: true,
          policyPercent:  true,
          currency:       true,
          reason:         true,
          paymentMethod:  true,
          notes:          true,
        },
      });
      if (!refund) {
        this.logger.debug(`[Refund ${event.type}] refund ${refundId} introuvable (tenant ${tenantId})`);
        return;
      }

      // Lookup ticket pour récupérer le destinataire (passenger).
      const ticket = await this.prisma.ticket.findFirst({
        where: { id: refund.ticketId, tenantId },
        select: {
          passengerName:  true,
          passengerEmail: true,
          passengerPhone: true,
          customer:       { select: { language: true, userId: true } },
        },
      });
      if (!ticket) {
        this.logger.debug(`[Refund ${event.type}] ticket ${refund.ticketId} introuvable (tenant ${tenantId})`);
        return;
      }

      const recipient: RefundRecipient = {
        userId:   ticket.customer?.userId ?? null,
        phone:    ticket.passengerPhone,
        email:    ticket.passengerEmail,
        name:     ticket.passengerName,
        language: ticket.customer?.language ?? null,
      };

      const lang = await this.resolveLanguage(tenantId, recipient.language);
      const out  = renderRefundTemplate(templateId, lang, {
        recipientName:   recipient.name ?? '',
        formattedAmount: `${formatNumber(refund.amount)} ${refund.currency}`,
        ticketRef:       refund.ticketId,
        reasonLabel:     reasonLabel(refund.reason, lang),
        policyPercent:   refund.policyPercent != null ? `${Math.round(refund.policyPercent * 100)}%` : '',
        notes:           refund.notes ?? '',
        paymentMethod:   refund.paymentMethod ?? '-',
      });

      const meta = { refundId: refund.id, ticketId: refund.ticketId };

      if (recipient.userId) {
        await this.notifications.send({
          tenantId, userId: recipient.userId, channel: 'IN_APP',
          templateId, title: out.title, body: out.body, metadata: meta,
        });
      }
      if (recipient.phone) {
        await this.notifications.sendWithChannelFallback({
          tenantId, phone: recipient.phone, templateId,
          title: out.title, body: out.body, metadata: meta,
        });
      }
      if (recipient.email) {
        await this.notifications.send({
          tenantId, userId: recipient.userId ?? undefined,
          email: recipient.email, channel: 'EMAIL',
          templateId, title: out.title, body: out.body, html: out.html, metadata: meta,
        });
      }
    } catch (err) {
      this.logger.error(
        `[Refund ${event.type}] dispatch failed (refund=${refundId}): ${(err as Error).message}`,
      );
    }
  }

  private async resolveLanguage(
    tenantId:     string,
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

/** Libellé du motif refund — couvre les valeurs RefundReason connues. */
function reasonLabel(reason: string, lang: 'fr' | 'en'): string {
  if (lang === 'en') {
    if (reason === 'CLIENT_CANCEL')   return 'client cancellation';
    if (reason === 'TRIP_CANCELLED')  return 'trip cancelled';
    return reason;
  }
  if (reason === 'CLIENT_CANCEL')   return 'annulation client';
  if (reason === 'TRIP_CANCELLED')  return 'trajet annulé';
  return reason;
}
