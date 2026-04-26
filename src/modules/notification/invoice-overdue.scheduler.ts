/**
 * InvoiceOverdueScheduler — émet INVOICE_OVERDUE pour les factures ISSUED
 * dont l'échéance est dépassée.
 *
 * Fonctionnement :
 *   1. @Cron quotidien (07h UTC — relance matinale).
 *   2. Scanne `Invoice` cross-tenant : status=ISSUED + dueDate<now.
 *   3. Pour chaque facture, vérifie l'idempotence en consultant
 *      `Notification` (templateId='invoice.overdue' + metadata.invoiceId).
 *      S'il existe déjà au moins 1 envoi pour cette facture, on skip
 *      → une seule relance par facture.
 *   4. Émet `INVOICE_OVERDUE` via Outbox dans une tx — l'InvoiceNotificationListener
 *      fan-out aux canaux du client.
 *
 * Killswitch : `notifications.lifecycle.enabled` = false → skip tout le tick.
 *
 * Note : l'idempotence se fait sur la table Notification (et non un flag
 * en DB sur Invoice) pour rester cohérent avec le reste du système et
 * permettre d'envoyer plusieurs relances dans le futur en relâchant la
 * condition (ex. relance hebdomadaire = idempotency par semaine).
 */

import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  IEventBus,
  EVENT_BUS,
  DomainEvent,
} from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { EventTypes } from '../../common/types/domain-event.type';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class InvoiceOverdueScheduler {
  private readonly logger = new Logger(InvoiceOverdueScheduler.name);

  constructor(
    private readonly prisma:         PrismaService,
    private readonly platformConfig: PlatformConfigService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  /**
   * Tick quotidien — par défaut 07h UTC pour atterrir entre 8h et 10h locales
   * sur les fuseaux Afrique centrale (UTC+1) et Afrique de l'Ouest (UTC+0/+1).
   */
  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async tick(): Promise<void> {
    if (!(await this.enabled())) {
      this.logger.debug('[InvoiceOverdue] killswitch ON — tick skipped');
      return;
    }

    const overdue = await this.prisma.invoice.findMany({
      where: {
        status:  'ISSUED',
        dueDate: { lt: new Date() },
      },
      select: {
        id:            true,
        tenantId:      true,
        invoiceNumber: true,
        totalAmount:   true,
        currency:      true,
        dueDate:       true,
        paymentMethod: true,
      },
      take: 1000, // garde-fou anti-mass-emit en cas de premier tick après backlog
    });

    let emitted = 0;
    for (const inv of overdue) {
      const already = await this.prisma.notification.findFirst({
        where: {
          tenantId:   inv.tenantId,
          templateId: 'invoice.overdue',
          metadata:   { path: ['invoiceId'], equals: inv.id },
        },
        select: { id: true },
      });
      if (already) continue;

      await this.publishOverdue(inv);
      emitted++;
    }

    this.logger.log(`[InvoiceOverdue] tick — scanned=${overdue.length} emitted=${emitted}`);
  }

  private async publishOverdue(inv: {
    id:            string;
    tenantId:      string;
    invoiceNumber: string;
    totalAmount:   number;
    currency:      string | null;
    dueDate:       Date | null;
    paymentMethod: string | null;
  }): Promise<void> {
    const event: DomainEvent = {
      id:            uuidv4(),
      type:          EventTypes.INVOICE_OVERDUE,
      tenantId:      inv.tenantId,
      aggregateId:   inv.id,
      aggregateType: 'Invoice',
      payload: {
        invoiceId:     inv.id,
        invoiceNumber: inv.invoiceNumber,
        totalAmount:   inv.totalAmount,
        currency:      inv.currency,
        dueDate:       inv.dueDate?.toISOString() ?? null,
        paymentMethod: inv.paymentMethod ?? null,
      },
      occurredAt: new Date(),
    };
    await this.prisma.transact((tx) => this.eventBus.publish(event, tx));
  }

  private async enabled(): Promise<boolean> {
    try {
      return await this.platformConfig.getBoolean('notifications.lifecycle.enabled');
    } catch {
      return true;
    }
  }
}
