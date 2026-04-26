import { BadRequestException, Injectable, Logger, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { WorkflowEngine } from '../../core/workflow/workflow.engine';
import { IEventBus, EVENT_BUS, DomainEvent } from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { EventTypes } from '../../common/types/domain-event.type';
import { ParcelState } from '../../common/constants/workflow-states';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { CreateParcelDto } from './dto/create-parcel.dto';
import { CustomerResolverService } from '../crm/customer-resolver.service';
import { CustomerClaimService } from '../crm/customer-claim.service';
import { NotificationService } from '../notification/notification.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ParcelService {
  private readonly logger = new Logger(ParcelService.name);

  constructor(
    private readonly prisma:   PrismaService,
    private readonly workflow: WorkflowEngine,
    private readonly crmResolver: CustomerResolverService,
    private readonly crmClaim:    CustomerClaimService,
    private readonly notification: NotificationService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  async register(tenantId: string, dto: CreateParcelDto, actor: CurrentUserPayload) {
    const trackingCode = this.generateTrackingCode(tenantId);

    const parcel = await this.prisma.transact(async (tx) => {
      // ── Résolution CRM expéditeur ─────────────────────────────────────────
      // Si senderName/Phone/Email fourni → shadow ou match ; sinon on essaie
      // de retrouver le Customer attaché à l'User connecté (s'il en a un).
      const senderRes = dto.senderName || dto.senderPhone || dto.senderEmail
        ? await this.crmResolver.resolveOrCreate(tenantId, {
            name:  dto.senderName,
            phone: dto.senderPhone,
            email: dto.senderEmail,
          }, tx as unknown as Parameters<typeof this.crmResolver.resolveOrCreate>[2])
        : null;

      // ── Résolution CRM destinataire ───────────────────────────────────────
      const recipientRes = await this.crmResolver.resolveOrCreate(tenantId, {
        name:  dto.recipientName,
        phone: dto.recipientPhone,
        email: dto.recipientEmail,
      }, tx as unknown as Parameters<typeof this.crmResolver.resolveOrCreate>[2]);

      const created = await tx.parcel.create({
        data: {
          tenantId,
          trackingCode,
          senderId:            actor.id,
          senderCustomerId:    senderRes?.customer.id ?? null,
          recipientCustomerId: recipientRes?.customer.id ?? null,
          weight:        dto.weightKg,
          price:         dto.declaredValue ?? 0,
          destinationId: dto.destinationId,
          recipientInfo: {
            name:    dto.recipientName,
            phone:   dto.recipientPhone,
            email:   dto.recipientEmail ?? null,
            address: dto.address ?? '',
          },
          status:  ParcelState.CREATED,
          version: 0,
        },
      });

      // Phase 5 : compteurs CRM pour sender + recipient dans la même transaction
      // source='AGENT' → flip phoneVerified (agent au guichet confirme l'identité)
      const priceCents = BigInt(Math.round((dto.declaredValue ?? 0) * 100));
      if (senderRes?.customer.id) {
        await this.crmResolver.bumpCounters(
          tx as any,
          senderRes.customer.id, 'parcel', priceCents,
          { source: 'AGENT' },
        );
      }
      if (recipientRes?.customer.id && recipientRes.customer.id !== senderRes?.customer.id) {
        await this.crmResolver.bumpCounters(
          tx as any,
          recipientRes.customer.id, 'parcel', 0n,
          // destinataire : pas en présentiel, on ne flip pas phoneVerified ici.
          // Le flip se fera au retrait du colis par lui (AGENT_IN_PERSON).
        );
      }

      const event: DomainEvent = {
        id:            uuidv4(),
        type:          EventTypes.PARCEL_REGISTERED,
        tenantId,
        aggregateId:   created.id,
        aggregateType: 'Parcel',
        payload:       {
          parcelId:           created.id,
          trackingCode,
          senderCustomerId:   senderRes?.customer.id ?? null,
          recipientCustomerId: recipientRes?.customer.id ?? null,
        },
        occurredAt:    new Date(),
      };
      await this.eventBus.publish(event, tx as any);

      return created;
    });

    // Émission magic link + recompute segments pour sender et recipient
    // (fire-and-forget, hors transaction).
    const postTx = (cid: string | null | undefined) => {
      if (!cid) return;
      void this.crmClaim.issueToken(tenantId, cid).catch(err =>
        this.logger.warn(`[CRM Claim] issueToken failed: ${err?.message ?? err}`),
      );
      void this.crmResolver.recomputeSegmentsFor(tenantId, cid);
    };
    postTx(parcel.senderCustomerId);
    postTx(parcel.recipientCustomerId);

    // Notification tracking — WhatsApp préféré, SMS en repli (fire-and-forget).
    // Envoyée à l'expéditeur ET au destinataire s'ils ont un phoneE164.
    void this.dispatchTrackingNotifications(
      tenantId,
      parcel.trackingCode,
      parcel.senderCustomerId,
      parcel.recipientCustomerId,
    );

    return parcel;
  }

  /**
   * Notifie expéditeur + destinataire du code de suivi via WhatsApp (préféré)
   * avec repli SMS. Fire-and-forget — n'affecte jamais le succès de la création.
   */
  private async dispatchTrackingNotifications(
    tenantId:            string,
    trackingCode:        string,
    senderCustomerId:    string | null,
    recipientCustomerId: string | null,
  ): Promise<void> {
    const ids = [senderCustomerId, recipientCustomerId].filter(
      (v): v is string => !!v,
    );
    if (ids.length === 0) return;

    const customers = await this.prisma.customer.findMany({
      where:  { id: { in: Array.from(new Set(ids)) }, tenantId },
      select: { id: true, phoneE164: true, name: true, language: true },
    });

    const isRecipient = (cid: string) => cid === recipientCustomerId;

    for (const c of customers) {
      if (!c.phoneE164) continue;
      const body = this.renderTrackingBody(
        c.language ?? 'fr',
        c.name,
        trackingCode,
        isRecipient(c.id) ? 'recipient' : 'sender',
      );
      try {
        await this.notification.sendWithChannelFallback({
          tenantId,
          phone:      c.phoneE164,
          templateId: 'parcel.tracking',
          body,
          metadata:   { trackingCode, customerId: c.id },
        });
      } catch (err) {
        this.logger.warn(
          `[Parcel Notif] customer=${c.id} tracking=${trackingCode}: ${(err as Error)?.message ?? err}`,
        );
      }
    }
  }

  private renderTrackingBody(
    lang:         string,
    name:         string,
    trackingCode: string,
    role:         'sender' | 'recipient',
  ): string {
    if (lang === 'en') {
      return role === 'recipient'
        ? `Hello ${name}, a parcel is on its way for you. Tracking code: ${trackingCode}`
        : `Hello ${name}, your parcel has been registered. Tracking code: ${trackingCode}`;
    }
    return role === 'recipient'
      ? `Bonjour ${name}, un colis vous est destiné. Code de suivi : ${trackingCode}`
      : `Bonjour ${name}, votre colis a été enregistré. Code de suivi : ${trackingCode}`;
  }

  async findAll(tenantId: string, filters?: { status?: string }) {
    return this.prisma.parcel.findMany({
      where: {
        tenantId,
        ...(filters?.status ? { status: filters.status } : {}),
      },
      include: { destination: true, shipment: { select: { id: true, tripId: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const parcel = await this.prisma.parcel.findFirst({
      where: { id, tenantId },
      include: { destination: true, shipment: { select: { id: true, tripId: true, status: true } } },
    });
    if (!parcel) throw new NotFoundException(`Parcel ${id} not found`);
    return parcel;
  }

  async trackByCode(tenantId: string, trackingCode: string) {
    const parcel = await this.prisma.parcel.findFirst({
      where:   { tenantId, trackingCode },
      include: { destination: true },
    });
    if (!parcel) throw new NotFoundException(`Parcel with code ${trackingCode} not found`);
    return parcel;
  }

  async transition(
    tenantId:        string,
    parcelId:        string,
    action:          string,
    actor:           CurrentUserPayload,
    idempotencyKey?: string,
  ) {
    const parcel = await this.findOne(tenantId, parcelId);

    // Verrou Clôture fret : si l'agent quai/chauffeur a clos le chargement de
    // ce trajet, on refuse toute action LOAD ultérieure. Les autres actions
    // (ARRIVE/DELIVER…) restent permises — la clôture ne concerne que la
    // phase chargement avant départ.
    if (action === 'LOAD' && parcel.shipment?.tripId) {
      const trip = await this.prisma.trip.findFirst({
        where:  { id: parcel.shipment.tripId, tenantId },
        select: { freightClosedAt: true },
      });
      if (trip?.freightClosedAt) {
        throw new BadRequestException(
          `Chargement clôturé pour ce trajet le ${trip.freightClosedAt.toISOString()} — ` +
          `aucun nouveau colis ne peut être chargé.`,
        );
      }
    }

    return this.workflow.transition(parcel as Parameters<typeof this.workflow.transition>[0], {
      action,
      actor,
      idempotencyKey,
    }, {
      aggregateType: 'Parcel',
      persist: async (entity, state, p) => {
        const updated = (await p.parcel.update({
          where: { id: entity.id },
          data:  {
            status:  state,
            version: { increment: 1 },
          },
        })) as typeof entity;
        await this.maybeEmitParcelEvent(tenantId, updated as unknown as Parameters<typeof this.maybeEmitParcelEvent>[1], state, p);
        return updated;
      },
    });
  }

  /** Scan chargement/déchargement — mappe l'action sur une transition workflow */
  async scan(
    tenantId:        string,
    parcelId:        string,
    action:          string,
    _stationId:      string,
    actor:           CurrentUserPayload,
    idempotencyKey?: string,
  ) {
    return this.transition(tenantId, parcelId, action, actor, idempotencyKey);
  }

  /** Signalement dommage — transition vers DAMAGED */
  async reportDamage(
    tenantId:    string,
    parcelId:    string,
    description: string,
    actor:       CurrentUserPayload,
  ) {
    return this.transition(tenantId, parcelId, 'DAMAGE', actor, undefined);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Scénarios hub / entrepôt / retrait / retour (2026-04-19)
  // Toutes les transitions passent par WorkflowEngine (blueprint-driven).
  // Les méthodes ajoutent leurs propres stamps (hubArrivedAt, pickedUpAt, etc.)
  // dans la persist callback via le helper `transitionWithStamps`.
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Variante de `transition` qui enrichit la persist callback avec des champs
   * de stamping propres à l'action (hubArrivedAt, pickedUpAt, etc.).
   * Garde la même sémantique : permissions + guards + audit + idempotence
   * gérés par l'engine.
   */
  private async transitionWithStamps(
    tenantId: string,
    parcelId: string,
    action:   string,
    actor:    CurrentUserPayload,
    stamps:   Record<string, unknown>,
    idempotencyKey?: string,
  ) {
    const parcel = await this.findOne(tenantId, parcelId);
    return this.workflow.transition(
      parcel as Parameters<typeof this.workflow.transition>[0],
      { action, actor, idempotencyKey },
      {
        aggregateType: 'Parcel',
        persist: async (entity, state, p) => {
          const updated = (await p.parcel.update({
            where: { id: entity.id },
            data:  { status: state, version: { increment: 1 }, ...stamps },
          })) as typeof entity;
          await this.maybeEmitParcelEvent(tenantId, updated as unknown as Parameters<typeof this.maybeEmitParcelEvent>[1], state, p);
          return updated;
        },
      },
    );
  }

  /**
   * Émet le DomainEvent de notification correspondant à l'état cible — uniquement
   * pour les états qui méritent une notif client (in transit, ready for pickup,
   * delivered). Outbox atomique dans la persist callback. Mapping :
   *   IN_TRANSIT             → PARCEL_DISPATCHED   (parcel.in_transit)
   *   AVAILABLE_FOR_PICKUP   → PARCEL_ARRIVED      (parcel.ready_for_pickup)
   *   DELIVERED              → PARCEL_DELIVERED    (parcel.delivered)
   * Les autres états (AT_HUB_*, STORED_*, DAMAGED, RETURNED, DISPUTED) restent
   * silencieux côté notification — flux interne ou hors scope Tier 2.1.
   */
  private async maybeEmitParcelEvent(
    tenantId: string,
    parcel: { id: string; trackingCode: string; senderCustomerId: string | null; recipientCustomerId: string | null },
    toState: string,
    tx: unknown,
  ): Promise<void> {
    const eventType =
      toState === 'IN_TRANSIT'           ? EventTypes.PARCEL_DISPATCHED :
      toState === 'AVAILABLE_FOR_PICKUP' ? EventTypes.PARCEL_ARRIVED :
      toState === 'DELIVERED'            ? EventTypes.PARCEL_DELIVERED :
      null;
    if (!eventType) return;

    const event: DomainEvent = {
      id:            uuidv4(),
      type:          eventType,
      tenantId,
      aggregateId:   parcel.id,
      aggregateType: 'Parcel',
      payload: {
        parcelId:            parcel.id,
        trackingCode:        parcel.trackingCode,
        senderCustomerId:    parcel.senderCustomerId,
        recipientCustomerId: parcel.recipientCustomerId,
        toState,
      },
      occurredAt: new Date(),
    };
    await this.eventBus.publish(event, tx as Parameters<typeof this.eventBus.publish>[1]);
  }

  /**
   * Le colis arrive dans un hub intermédiaire (nodal).
   * IN_TRANSIT → AT_HUB_INBOUND. Stamp hubStationId + hubArrivedAt.
   */
  async arriveAtHub(
    tenantId: string,
    parcelId: string,
    hubStationId: string,
    actor: CurrentUserPayload,
    idempotencyKey?: string,
  ) {
    return this.transitionWithStamps(tenantId, parcelId, 'ARRIVE_AT_HUB', actor, {
      hubStationId,
      hubArrivedAt: new Date(),
    }, idempotencyKey);
  }

  /**
   * Stockage en entrepôt du hub.
   * AT_HUB_INBOUND → STORED_AT_HUB. Stamp hubStoredAt (début TTL stockage).
   */
  async storeAtHub(
    tenantId: string,
    parcelId: string,
    actor: CurrentUserPayload,
    idempotencyKey?: string,
  ) {
    return this.transitionWithStamps(tenantId, parcelId, 'STORE_AT_HUB', actor, {
      hubStoredAt: new Date(),
    }, idempotencyKey);
  }

  /**
   * Chargement sur bus sortant depuis le hub.
   * AT_HUB_INBOUND | STORED_AT_HUB → AT_HUB_OUTBOUND.
   */
  async loadOutboundFromHub(
    tenantId: string,
    parcelId: string,
    actor: CurrentUserPayload,
    idempotencyKey?: string,
  ) {
    return this.transitionWithStamps(tenantId, parcelId, 'LOAD_OUTBOUND', actor, {}, idempotencyKey);
  }

  /**
   * Départ depuis le hub (bus sort du hub vers destination finale ou prochain hub).
   * AT_HUB_OUTBOUND → IN_TRANSIT. Reset hubStationId (colis n'est plus au hub).
   */
  async departFromHub(
    tenantId: string,
    parcelId: string,
    actor: CurrentUserPayload,
    idempotencyKey?: string,
  ) {
    return this.transitionWithStamps(tenantId, parcelId, 'DEPART_FROM_HUB', actor, {
      hubStationId: null,
    }, idempotencyKey);
  }

  /**
   * Notification de mise à disposition au destinataire.
   * ARRIVED → AVAILABLE_FOR_PICKUP. Stamp pickupAvailableAt (début TTL retour).
   * TODO: trigger notification SMS/WhatsApp via NotificationService (sideEffect).
   */
  async notifyForPickup(
    tenantId: string,
    parcelId: string,
    actor: CurrentUserPayload,
    idempotencyKey?: string,
  ) {
    return this.transitionWithStamps(tenantId, parcelId, 'NOTIFY_FOR_PICKUP', actor, {
      pickupAvailableAt: new Date(),
    }, idempotencyKey);
  }

  /**
   * Destinataire retire le colis au comptoir destination.
   * AVAILABLE_FOR_PICKUP → DELIVERED. Stamp pickedUpAt.
   */
  async pickup(
    tenantId: string,
    parcelId: string,
    actor: CurrentUserPayload,
    idempotencyKey?: string,
  ) {
    return this.transitionWithStamps(tenantId, parcelId, 'PICKUP', actor, {
      pickedUpAt: new Date(),
    }, idempotencyKey);
  }

  /**
   * Destinataire ou expéditeur conteste le colis (manquant, cassé, litige).
   * DELIVERED | AVAILABLE_FOR_PICKUP → DISPUTED.
   */
  async dispute(
    tenantId: string,
    parcelId: string,
    reason:   string,
    actor:    CurrentUserPayload,
    idempotencyKey?: string,
  ) {
    const parcel = await this.findOne(tenantId, parcelId);
    return this.workflow.transition(
      parcel as Parameters<typeof this.workflow.transition>[0],
      { action: 'DISPUTE', actor, idempotencyKey, context: { reason } },
      {
        aggregateType: 'Parcel',
        persist: async (entity, state, p) => {
          return p.parcel.update({
            where: { id: entity.id },
            data:  { status: state, version: { increment: 1 } },
          }) as Promise<typeof entity>;
        },
      },
    );
  }

  /**
   * Initiation retour expéditeur (TTL retrait dépassé ou demande explicite).
   * AVAILABLE_FOR_PICKUP | STORED_AT_HUB → RETURN_TO_SENDER. Stamp returnInitiatedAt.
   * Permission: control.parcel.return_init.tenant (admin).
   */
  async initiateReturn(
    tenantId: string,
    parcelId: string,
    actor:    CurrentUserPayload,
    idempotencyKey?: string,
  ) {
    return this.transitionWithStamps(tenantId, parcelId, 'INITIATE_RETURN', actor, {
      returnInitiatedAt: new Date(),
    }, idempotencyKey);
  }

  /**
   * Finalisation du retour expéditeur (colis remis physiquement à l'expéditeur).
   * RETURN_TO_SENDER → RETURNED.
   */
  async completeReturn(
    tenantId: string,
    parcelId: string,
    actor:    CurrentUserPayload,
    idempotencyKey?: string,
  ) {
    return this.transitionWithStamps(tenantId, parcelId, 'COMPLETE_RETURN', actor, {}, idempotencyKey);
  }

  async findByShipment(tenantId: string, shipmentId: string) {
    return this.prisma.parcel.findMany({
      where:   { tenantId, shipmentId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Liste les colis expédiés par l'utilisateur courant (CUSTOMER) — page
   * "Mes colis". Filtré par senderId — un client ne voit jamais les colis
   * d'autrui. Inclut destination pour l'affichage. Tri par création desc.
   */
  async findMine(tenantId: string, userId: string) {
    return this.prisma.parcel.findMany({
      where:   { tenantId, senderId: userId },
      include: { destination: true },
      orderBy: { createdAt: 'desc' },
      take:    100,
    });
  }

  private generateTrackingCode(tenantId: string): string {
    const prefix = tenantId.slice(0, 4).toUpperCase();
    const ts     = Date.now().toString(36).toUpperCase();
    const rand   = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `${prefix}-${ts}-${rand}`;
  }
}
