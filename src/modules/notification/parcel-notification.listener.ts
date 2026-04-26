/**
 * ParcelNotificationListener — fan-out multi-canal sur les events du cycle
 * de vie d'un colis :
 *   PARCEL_REGISTERED  → templateId 'parcel.registered'         (sender + recipient)
 *   PARCEL_DISPATCHED  → templateId 'parcel.in_transit'         (recipient only)
 *   PARCEL_ARRIVED     → templateId 'parcel.ready_for_pickup'   (recipient only)
 *   PARCEL_DELIVERED   → templateId 'parcel.delivered'          (sender + recipient)
 *
 * Coexiste avec ParcelTripListener (sync state) et avec la notif tracking
 * SMS inline déjà présente dans ParcelService (qui reste opérationnelle pour
 * le canal SMS au moment de l'enregistrement).
 *
 * Source destinataires : Parcel.senderCustomerId / recipientCustomerId →
 * Customer (userId, email, phoneE164, name, language). Si aucun customer
 * lié, on lit le dénormalisé recipientInfo (legacy) pour le destinataire.
 */

import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  IEventBus, EVENT_BUS, DomainEvent,
} from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { EventTypes } from '../../common/types/domain-event.type';
import { NotificationService } from './notification.service';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { renderParcelTemplate, ParcelTemplateId } from './email-templates/parcel-templates';

interface PartyContact {
  userId?:   string | null;
  phone?:    string | null;
  email?:    string | null;
  name?:     string | null;
  language?: string | null;
  role:      'sender' | 'recipient';
}

@Injectable()
export class ParcelNotificationListener implements OnModuleInit {
  private readonly logger = new Logger(ParcelNotificationListener.name);

  constructor(
    private readonly prisma:        PrismaService,
    private readonly notifications: NotificationService,
    private readonly platformConfig: PlatformConfigService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  onModuleInit(): void {
    this.eventBus.subscribe(EventTypes.PARCEL_REGISTERED, (e) => this.handle(e, 'parcel.registered',       'both'));
    this.eventBus.subscribe(EventTypes.PARCEL_DISPATCHED, (e) => this.handle(e, 'parcel.in_transit',       'recipient'));
    this.eventBus.subscribe(EventTypes.PARCEL_ARRIVED,    (e) => this.handle(e, 'parcel.ready_for_pickup', 'recipient'));
    this.eventBus.subscribe(EventTypes.PARCEL_DELIVERED,  (e) => this.handle(e, 'parcel.delivered',        'both'));
  }

  private async handle(
    event:      DomainEvent,
    templateId: ParcelTemplateId,
    audience:   'sender' | 'recipient' | 'both',
  ): Promise<void> {
    if (!(await this.lifecycleEnabled())) return;

    const tenantId = event.tenantId;
    const parcelId = (event.payload as { parcelId?: string }).parcelId ?? event.aggregateId;

    try {
      const parcel = await this.prisma.parcel.findFirst({
        where: { id: parcelId, tenantId },
        select: {
          id: true, trackingCode: true, recipientInfo: true,
          senderCustomerId: true, recipientCustomerId: true,
          destination: { select: { city: true, name: true } },
          // hubStation pour pickup
          hubStation:   { select: { city: true, name: true } } as any,
        } as any,
      });
      if (!parcel) {
        this.logger.debug(`[Parcel ${event.type}] parcel ${parcelId} introuvable (tenant ${tenantId})`);
        return;
      }

      const parties: PartyContact[] = [];
      if (audience === 'sender' || audience === 'both') {
        const c = parcel.senderCustomerId
          ? await this.lookupCustomer(tenantId, parcel.senderCustomerId, 'sender')
          : null;
        if (c) parties.push(c);
      }
      if (audience === 'recipient' || audience === 'both') {
        const c = parcel.recipientCustomerId
          ? await this.lookupCustomer(tenantId, parcel.recipientCustomerId, 'recipient')
          : this.fromRecipientInfo(parcel.recipientInfo);
        if (c) parties.push(c);
      }
      if (parties.length === 0) {
        this.logger.debug(`[Parcel ${event.type}] aucun party à notifier (parcel=${parcelId})`);
        return;
      }

      const dest = (parcel.destination as { city: string | null; name: string } | null);
      const hub  = (parcel as any).hubStation as { city: string | null; name: string } | null;

      for (const party of parties) {
        const lang = await this.resolveLanguage(tenantId, party.language ?? null);
        const out  = renderParcelTemplate(templateId, lang, {
          recipientName:   party.name ?? '',
          trackingCode:    parcel.trackingCode,
          destinationName: dest?.city || dest?.name || '-',
          pickupStation:   hub?.city || hub?.name || dest?.city || dest?.name || '-',
          trackingUrl:     '', // construire via AppConfigService dans une V2
          recipientRole:   party.role,
        });
        const meta = { parcelId: parcel.id, trackingCode: parcel.trackingCode, role: party.role };

        if (party.userId) {
          await this.notifications.send({
            tenantId, userId: party.userId, channel: 'IN_APP',
            templateId, title: out.title, body: out.body, metadata: meta,
          });
        }
        if (party.phone) {
          await this.notifications.sendWithChannelFallback({
            tenantId, phone: party.phone, templateId,
            title: out.title, body: out.body, metadata: meta,
          });
        }
        if (party.email) {
          await this.notifications.send({
            tenantId, userId: party.userId ?? undefined,
            email: party.email, channel: 'EMAIL', templateId,
            title: out.title, body: out.body, html: out.html, metadata: meta,
          });
        }
      }
    } catch (err) {
      this.logger.error(
        `[Parcel ${event.type}] dispatch failed (parcel=${parcelId}): ${(err as Error).message}`,
      );
    }
  }

  private async lookupCustomer(
    tenantId:   string,
    customerId: string,
    role:       'sender' | 'recipient',
  ): Promise<PartyContact | null> {
    const c = await this.prisma.customer.findFirst({
      where:  { id: customerId, tenantId },
      select: { name: true, email: true, phoneE164: true, userId: true, language: true },
    });
    if (!c) return null;
    return {
      userId:   c.userId,
      email:    c.email,
      phone:    c.phoneE164,
      name:     c.name,
      language: c.language,
      role,
    };
  }

  /** Fallback recipient depuis le JSON dénormalisé `recipientInfo` (legacy). */
  private fromRecipientInfo(info: unknown): PartyContact | null {
    if (!info || typeof info !== 'object') return null;
    const o = info as { name?: string; phone?: string; email?: string };
    if (!o.email && !o.phone) return null;
    return {
      userId:   null,
      email:    o.email ?? null,
      phone:    o.phone ?? null,
      name:     o.name  ?? null,
      language: null,
      role:     'recipient',
    };
  }

  private async resolveLanguage(tenantId: string, lang: string | null): Promise<'fr' | 'en'> {
    if (lang === 'fr' || lang === 'en') return lang;
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { language: true } });
    return tenant?.language === 'en' ? 'en' : 'fr';
  }

  private async lifecycleEnabled(): Promise<boolean> {
    try { return await this.platformConfig.getBoolean('notifications.lifecycle.enabled'); }
    catch { return true; }
  }
}
