/**
 * InvoiceNotificationListener — fan-out multi-canal sur les 4 events
 * cycle de vie facture (issued, paid, overdue, cancelled).
 *
 * Architecture :
 *   - Subscribe via IEventBus (Outbox) — pas EventEmitter @OnEvent.
 *   - Multi-canal pour chaque destinataire : IN_APP (si userId) +
 *     WhatsApp→SMS fallback (si phone) + EMAIL (si email).
 *   - i18n : Customer.language → tenant.language → 'fr'.
 *   - Killswitch : `notifications.lifecycle.enabled` (PlatformConfig)
 *     pour couper tout le flux email/notif en cas d'incident provider.
 *
 * Sécurité :
 *   - tenantId toujours pris depuis l'event, jamais le payload.
 *   - Toutes les requêtes Prisma posent tenantId en racine (RLS V6.1).
 *   - Pas d'exception remontée — un échec sur 1 destinataire ne casse pas le flow.
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
import { renderInvoiceTemplate, InvoiceTemplateId } from './email-templates/invoice-templates';

interface InvoiceRecipient {
  userId?:   string | null;
  phone?:    string | null;
  email?:    string | null;
  name?:     string | null;
  language?: string | null;
}

@Injectable()
export class InvoiceNotificationListener implements OnModuleInit {
  private readonly logger = new Logger(InvoiceNotificationListener.name);

  constructor(
    private readonly prisma:        PrismaService,
    private readonly notifications: NotificationService,
    private readonly platformConfig: PlatformConfigService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  onModuleInit(): void {
    this.eventBus.subscribe(EventTypes.INVOICE_ISSUED,    (e) => this.handle(e, 'invoice.issued'));
    this.eventBus.subscribe(EventTypes.INVOICE_PAID,      (e) => this.handle(e, 'invoice.paid'));
    this.eventBus.subscribe(EventTypes.INVOICE_OVERDUE,   (e) => this.handle(e, 'invoice.overdue'));
    this.eventBus.subscribe(EventTypes.INVOICE_CANCELLED, (e) => this.handle(e, 'invoice.cancelled'));
  }

  /** Handler unifié — la seule différence entre les 4 events est le templateId. */
  private async handle(event: DomainEvent, templateId: InvoiceTemplateId): Promise<void> {
    if (!(await this.lifecycleEnabled())) return;

    const tenantId  = event.tenantId;
    const invoiceId = (event.payload as { invoiceId?: string }).invoiceId ?? event.aggregateId;

    try {
      const invoice = await this.prisma.invoice.findFirst({
        where: { id: invoiceId, tenantId },
        select: {
          id:            true,
          invoiceNumber: true,
          customerName:  true,
          customerEmail: true,
          customerPhone: true,
          customerId:    true,
          totalAmount:   true,
          currency:      true,
          dueDate:       true,
          paidAt:        true,
          paymentMethod: true,
          issuedAt:      true,
        },
      });
      if (!invoice) {
        this.logger.debug(`[Invoice ${event.type}] invoice ${invoiceId} introuvable (tenant ${tenantId})`);
        return;
      }

      // Lookup Customer pour obtenir userId (IN_APP) + language. customerId est
      // optionnel ; s'il n'existe pas on dispatche uniquement EMAIL/SMS sur les
      // champs dénormalisés de l'invoice.
      let customerLang: string | null = null;
      let customerUserId: string | null = null;
      if (invoice.customerId) {
        const c = await this.prisma.customer.findFirst({
          where:  { id: invoice.customerId, tenantId },
          select: { language: true, userId: true },
        });
        customerLang   = c?.language ?? null;
        customerUserId = c?.userId   ?? null;
      }

      const recipient: InvoiceRecipient = {
        userId:   customerUserId,
        phone:    invoice.customerPhone,
        email:    invoice.customerEmail,
        name:     invoice.customerName,
        language: customerLang,
      };

      const lang   = await this.resolveLanguage(tenantId, recipient.language);
      const vars   = this.buildVars(invoice, event, lang);
      const out    = renderInvoiceTemplate(templateId, lang, vars);
      const meta   = { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber };

      // 1. IN_APP — uniquement si userId connu (lecture portail Mes notifs)
      if (recipient.userId) {
        await this.notifications.send({
          tenantId,
          userId:     recipient.userId,
          channel:    'IN_APP',
          templateId,
          title:      out.title,
          body:       out.body,
          metadata:   meta,
        });
      }

      // 2. WhatsApp → SMS fallback (si phone)
      if (recipient.phone) {
        await this.notifications.sendWithChannelFallback({
          tenantId,
          phone:      recipient.phone,
          templateId,
          title:      out.title,
          body:       out.body,
          metadata:   meta,
        });
      }

      // 3. EMAIL (si email)
      if (recipient.email) {
        await this.notifications.send({
          tenantId,
          userId:     recipient.userId ?? undefined,
          email:      recipient.email,
          channel:    'EMAIL',
          templateId,
          title:      out.title,
          body:       out.body,
          html:       out.html,
          metadata:   meta,
        });
      }
    } catch (err) {
      this.logger.error(
        `[Invoice ${event.type}] dispatch failed (invoice=${invoiceId}): ${(err as Error).message}`,
      );
    }
  }

  /** Construit le set de variables typées pour le renderer. */
  private buildVars(
    invoice: {
      invoiceNumber: string;
      customerName:  string;
      totalAmount:   number;
      currency:      string | null;
      dueDate:       Date | null;
      paidAt:        Date | null;
      paymentMethod: string | null;
      issuedAt:      Date | null;
    },
    event: DomainEvent,
    lang: 'fr' | 'en',
  ) {
    const currency = invoice.currency ?? 'XAF';
    const formattedAmount = `${formatNumber(invoice.totalAmount)} ${currency}`;
    const dueDateStr = invoice.dueDate ? formatDateLong(invoice.dueDate, lang) : '-';
    const paidAtStr  = invoice.paidAt  ? formatDateLong(invoice.paidAt,  lang) : '-';
    const issuedStr  = invoice.issuedAt? formatDateLong(invoice.issuedAt,lang) : '-';
    const daysOverdue = invoice.dueDate
      ? String(Math.max(0, Math.floor((Date.now() - invoice.dueDate.getTime()) / 86_400_000)))
      : '0';
    return {
      invoiceNumber:   invoice.invoiceNumber,
      customerName:    invoice.customerName,
      formattedAmount,
      issuedDate:      issuedStr,
      dueDate:         dueDateStr,
      paidAt:          paidAtStr,
      paymentMethod:   invoice.paymentMethod ?? '-',
      daysOverdue,
      portalUrl:       '', // pas de portail facture dédié pour l'instant — vide = bouton non rendu
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

/** Formate un nombre avec espaces de milliers (style FR). 12500 → "12 500". */
function formatNumber(n: number): string {
  if (typeof n !== 'number' || Number.isNaN(n)) return '0';
  return Math.round(n).toLocaleString('fr-FR').replace(/ /g, ' ');
}

/** Date longue localisée fr/en — "lundi 27 avril 2026" / "Monday 27 April 2026". */
function formatDateLong(d: Date, lang: 'fr' | 'en'): string {
  return d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}
