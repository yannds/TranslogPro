import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException, Inject } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { WorkflowEngine } from '../../core/workflow/workflow.engine';
import { PricingEngine } from '../../core/pricing/pricing.engine';
import { QrService } from '../../core/security/qr/qr.service';
import { IEventBus, EVENT_BUS, DomainEvent } from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { EventTypes } from '../../common/types/domain-event.type';
import { TicketAction } from '../../common/constants/workflow-states';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { IssueTicketDto, IssueBatchDto, ConfirmBatchDto } from './dto/issue-ticket.dto';
import { RefundService } from '../sav/refund.service';
import { RefundReason } from '../../common/constants/workflow-states';
import { CustomerResolverService } from '../crm/customer-resolver.service';
import { CustomerClaimService } from '../crm/customer-claim.service';
import { CashierService } from '../cashier/cashier.service';
import type {
  CashierPaymentMethod,
} from '../cashier/dto/record-transaction.dto';
import { v4 as uuidv4 } from 'uuid';

const PENDING_PAYMENT_TTL_MS = 15 * 60 * 1_000; // 15 minutes

/**
 * Accepte soit un token HMAC brut, soit une URL de verify publique
 *   (ex: https://app.example.com/verify/ticket/ID?q=TOKEN).
 * Retourne le token HMAC à vérifier. Si l'input n'est pas une URL, il est
 * retourné tel quel (rétro-compat avec les scanners qui captent le token nu).
 */
function extractQrToken(input: string): string {
  if (!input) return input;
  // Heuristique URL : commence par http(s):// ou contient "/verify/"
  if (/^https?:\/\//i.test(input) || input.includes('/verify/')) {
    try {
      const url = new URL(input, 'http://_');
      const q = url.searchParams.get('q');
      if (q) return q;
    } catch {
      // Pas une URL parseable → on tombe sur la chaîne brute
    }
  }
  return input;
}

interface SeatLayout {
  rows:        number;
  cols:        number;
  aisleAfter?: number;
  disabled?:   string[];
}

@Injectable()
export class TicketingService {
  private readonly logger = new Logger(TicketingService.name);

  constructor(
    private readonly prisma:   PrismaService,
    private readonly workflow: WorkflowEngine,
    private readonly pricing:  PricingEngine,
    private readonly qr:       QrService,
    private readonly refundService: RefundService,
    private readonly crmResolver: CustomerResolverService,
    private readonly crmClaim:    CustomerClaimService,
    private readonly cashier:     CashierService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  // ── Helpers siège ──────────────────────────────────────────────────────────

  /** Vérifie qu'un identifiant de siège existe dans le layout et n'est pas désactivé. */
  private isSeatValid(layout: SeatLayout, seatId: string): boolean {
    const parts = seatId.split('-');
    if (parts.length !== 2) return false;
    const row = parseInt(parts[0], 10);
    const col = parseInt(parts[1], 10);
    if (isNaN(row) || isNaN(col)) return false;
    if (row < 1 || row > layout.rows || col < 1 || col > layout.cols) return false;
    if (layout.disabled?.includes(seatId)) return false;
    return true;
  }

  /** Retourne le premier siège libre (ordre row-col) non occupé et non désactivé. */
  private findNextFreeSeat(layout: SeatLayout, occupiedSeats: Set<string>): string | null {
    for (let r = 1; r <= layout.rows; r++) {
      for (let c = 1; c <= layout.cols; c++) {
        const id = `${r}-${c}`;
        if (layout.disabled?.includes(id)) continue;
        if (occupiedSeats.has(id)) continue;
        return id;
      }
    }
    return null;
  }

  async issue(tenantId: string, dto: IssueTicketDto, actor: CurrentUserPayload, idempotencyKey?: string) {
    // 0. Résoudre les stations de montée/descente
    const trip = await this.prisma.trip.findUniqueOrThrow({
      where: { id: dto.tripId },
      include: { route: true, bus: { select: { id: true, capacity: true, seatLayout: true } } },
    });
    const boardingStationId  = dto.boardingStationId  ?? trip.route.originId;
    const alightingStationId = dto.alightingStationId;

    // 1. Calculate price (segment-aware)
    const price = await this.pricing.calculate({
      tenantId,
      tripId:              dto.tripId,
      fareClass:           dto.fareClass,
      boardingStationId,
      alightingStationId,
      discountCode:        dto.discountCode,
      luggageKg:           dto.luggageKg,
      wantsSeatSelection:  dto.wantsSeatSelection,
    });

    // 2. Create ticket in PENDING_PAYMENT with expiry (inside transaction for atomicity)
    const expiresAt = new Date(Date.now() + PENDING_PAYMENT_TTL_MS);

    const ticket = await this.prisma.transact(async (tx) => {
      // ── Garde capacité ──────────────────────────────────────────────────
      const activeCount = await tx.ticket.count({
        where: { tenantId, tripId: dto.tripId, status: { notIn: ['CANCELLED', 'EXPIRED'] } },
      });
      const seatLayout = trip.bus.seatLayout as SeatLayout | null;
      const totalSeats = seatLayout
        ? seatLayout.rows * seatLayout.cols - (seatLayout.disabled?.length ?? 0)
        : trip.bus.capacity;

      if (activeCount >= totalSeats) {
        throw new BadRequestException('Ce trajet est complet — plus aucune place disponible.');
      }

      // ── Garde doublon passager ──────────────────────────────────────────
      const normalizedName = dto.passengerName.trim().toLowerCase();
      const normalizedPhone = dto.passengerPhone.trim();
      const duplicate = await tx.ticket.findFirst({
        where: {
          tenantId,
          tripId:        dto.tripId,
          passengerName: { equals: normalizedName, mode: 'insensitive' },
          status:        { notIn: ['CANCELLED', 'EXPIRED'] },
        },
      });
      if (duplicate && duplicate.id) {
        // Vérifier aussi le téléphone pour confirmer le doublon
        const dupPhone = (duplicate as any).passengerPhone?.trim?.() ?? '';
        if (dupPhone === normalizedPhone) {
          throw new ConflictException(
            'Un billet existe déjà pour ce passager sur ce trajet.',
          );
        }
      }

      // ── Résolution du siège ─────────────────────────────────────────────
      let seatNumber = dto.seatNumber ?? null;

      if (trip.seatingMode === 'NUMBERED' && seatLayout) {
        const occupiedRows = await tx.ticket.findMany({
          where: { tenantId, tripId: dto.tripId, status: { notIn: ['CANCELLED', 'EXPIRED'] }, seatNumber: { not: null } },
          select: { seatNumber: true },
        });
        const occupiedSeats = new Set<string>(occupiedRows.map((t: { seatNumber: string | null }) => t.seatNumber!));

        if (dto.wantsSeatSelection && seatNumber) {
          // Le passager a choisi un siège → valider
          if (!this.isSeatValid(seatLayout, seatNumber)) {
            throw new BadRequestException(`Siège "${seatNumber}" invalide ou désactivé.`);
          }
          if (occupiedSeats.has(seatNumber)) {
            throw new ConflictException(`Le siège "${seatNumber}" est déjà attribué.`);
          }
        } else {
          // Attribution automatique du prochain siège libre
          seatNumber = this.findNextFreeSeat(seatLayout, occupiedSeats);
          if (!seatNumber) {
            throw new BadRequestException('Plus aucun siège disponible sur ce trajet.');
          }
        }
      }

      // Résolveur CRM (idempotent, intra-transaction) — crée ou retrouve le
      // Customer identifié par (phone, email). Null si aucun signal fourni.
      const crmRes = await this.crmResolver.resolveOrCreate(
        tenantId,
        {
          name:  dto.passengerName,
          phone: dto.passengerPhone,
          email: (dto as unknown as { passengerEmail?: string }).passengerEmail,
        },
        tx as unknown as Parameters<typeof this.crmResolver.resolveOrCreate>[2],
      );

      const t = await tx.ticket.create({
        data: {
          tenantId,
          tripId:             dto.tripId,
          passengerId:        actor.id,
          passengerName:      dto.passengerName.trim(),
          passengerPhone:     dto.passengerPhone?.trim() || null,
          passengerEmail:     (dto as unknown as { passengerEmail?: string }).passengerEmail?.trim() || null,
          customerId:         crmRes?.customer.id ?? null,
          seatNumber,
          boardingStationId,
          alightingStationId,
          fareClass:          dto.fareClass,
          pricePaid:          price.total,
          agencyId:           actor.agencyId ?? null,
          status:             'PENDING_PAYMENT',
          qrCode:             `pending-${uuidv4()}`,
          expiresAt,
          version:            0,
        },
      });

      // Phase 5 : compteurs CRM incrémentés dans la même transaction
      if (crmRes?.customer.id) {
        await this.crmResolver.bumpCounters(
          tx as unknown as { customer: { update: Function } },
          crmRes.customer.id, 'ticket',
          BigInt(Math.round(price.total * 100)),
        );
      }

      const event: DomainEvent = {
        id:            uuidv4(),
        type:          EventTypes.TICKET_ISSUED,
        tenantId,
        aggregateId:   t.id,
        aggregateType: 'Ticket',
        payload:       { ticketId: t.id, tripId: dto.tripId, price: price.total, customerId: crmRes?.customer.id ?? null },
        occurredAt:    new Date(),
      };
      await this.eventBus.publish(event, tx as any);

      return t;
    });

    // Emission magic link + recompute segments (fire-and-forget, hors transaction).
    if (ticket.customerId) {
      void this.crmClaim
        .issueToken(tenantId, ticket.customerId)
        .catch(err => this.logger.warn(`[CRM Claim] issueToken failed: ${err?.message ?? err}`));
      void this.crmResolver.recomputeSegmentsFor(tenantId, ticket.customerId);
    }

    return { ticket, pricing: price };
  }

  // ── Achat groupé ───────────────────────────────────────────────────────────

  async issueBatch(tenantId: string, dto: IssueBatchDto, actor: CurrentUserPayload, idempotencyKey?: string) {
    const trip = await this.prisma.trip.findUniqueOrThrow({
      where: { id: dto.tripId },
      include: { route: true, bus: { select: { id: true, capacity: true, seatLayout: true } } },
    });

    const seatLayout = trip.bus.seatLayout as SeatLayout | null;
    const totalSeats = seatLayout
      ? seatLayout.rows * seatLayout.cols - (seatLayout.disabled?.length ?? 0)
      : trip.bus.capacity;

    // Calculer tous les prix en amont (hors transaction pour limiter la durée du lock)
    const pricings = await Promise.all(
      dto.passengers.map(p =>
        this.pricing.calculate({
          tenantId,
          tripId:              dto.tripId,
          fareClass:           p.fareClass,
          boardingStationId:   p.boardingStationId ?? trip.route.originId,
          alightingStationId:  p.alightingStationId,
          discountCode:        dto.discountCode,
          luggageKg:           p.luggageKg,
          wantsSeatSelection:  p.wantsSeatSelection,
        }),
      ),
    );

    const expiresAt = new Date(Date.now() + PENDING_PAYMENT_TTL_MS);

    // Transaction atomique : soit tous les billets passent, soit aucun
    const tickets = await this.prisma.transact(async (tx) => {
      // ── Garde capacité globale ────────────────────────────────────────
      const activeCount = await tx.ticket.count({
        where: { tenantId, tripId: dto.tripId, status: { notIn: ['CANCELLED', 'EXPIRED'] } },
      });
      if (activeCount + dto.passengers.length > totalSeats) {
        const remaining = totalSeats - activeCount;
        throw new BadRequestException(
          `Pas assez de places : ${remaining} disponible(s), ${dto.passengers.length} demandée(s).`,
        );
      }

      // ── Garde doublons intra-batch ────────────────────────────────────
      const seen = new Set<string>();
      for (const p of dto.passengers) {
        const key = `${p.passengerName.trim().toLowerCase()}|${p.passengerPhone.trim()}`;
        if (seen.has(key)) {
          throw new BadRequestException(`Passager en doublon dans le groupe : ${p.passengerName}`);
        }
        seen.add(key);
      }

      // ── Garde doublons avec billets existants ─────────────────────────
      for (const p of dto.passengers) {
        const dup = await tx.ticket.findFirst({
          where: {
            tenantId,
            tripId:        dto.tripId,
            passengerName: { equals: p.passengerName.trim().toLowerCase(), mode: 'insensitive' },
            status:        { notIn: ['CANCELLED', 'EXPIRED'] },
          },
        });
        if (dup) {
          throw new ConflictException(
            `Un billet existe déjà pour "${p.passengerName}" sur ce trajet.`,
          );
        }
      }

      // ── Résolution des sièges ─────────────────────────────────────────
      const occupiedRows = await tx.ticket.findMany({
        where: { tenantId, tripId: dto.tripId, status: { notIn: ['CANCELLED', 'EXPIRED'] }, seatNumber: { not: null } },
        select: { seatNumber: true },
      });
      const occupiedSeats = new Set<string>(occupiedRows.map((t: { seatNumber: string | null }) => t.seatNumber!));

      const resolvedSeats: (string | null)[] = [];
      for (const p of dto.passengers) {
        if (trip.seatingMode === 'NUMBERED' && seatLayout) {
          if (p.wantsSeatSelection && p.seatNumber) {
            if (!this.isSeatValid(seatLayout, p.seatNumber)) {
              throw new BadRequestException(`Siège "${p.seatNumber}" invalide pour ${p.passengerName}.`);
            }
            if (occupiedSeats.has(p.seatNumber)) {
              throw new ConflictException(`Le siège "${p.seatNumber}" est déjà attribué.`);
            }
            occupiedSeats.add(p.seatNumber);
            resolvedSeats.push(p.seatNumber);
          } else {
            const seat = this.findNextFreeSeat(seatLayout, occupiedSeats);
            if (!seat) throw new BadRequestException(`Plus de siège disponible pour ${p.passengerName}.`);
            occupiedSeats.add(seat);
            resolvedSeats.push(seat);
          }
        } else {
          resolvedSeats.push(null);
        }
      }

      // ── Création des billets ──────────────────────────────────────────
      const created = [];
      for (let i = 0; i < dto.passengers.length; i++) {
        const p = dto.passengers[i];

        const crmRes = await this.crmResolver.resolveOrCreate(
          tenantId,
          {
            name:  p.passengerName,
            phone: p.passengerPhone,
            email: (p as unknown as { passengerEmail?: string }).passengerEmail,
          },
          tx as unknown as Parameters<typeof this.crmResolver.resolveOrCreate>[2],
        );

        const t = await tx.ticket.create({
          data: {
            tenantId,
            tripId:             dto.tripId,
            passengerId:        actor.id,
            passengerName:      p.passengerName.trim(),
            passengerPhone:     p.passengerPhone?.trim() || null,
            passengerEmail:     (p as unknown as { passengerEmail?: string }).passengerEmail?.trim() || null,
            customerId:         crmRes?.customer.id ?? null,
            seatNumber:         resolvedSeats[i],
            boardingStationId:  p.boardingStationId ?? trip.route.originId,
            alightingStationId: p.alightingStationId,
            fareClass:          p.fareClass,
            pricePaid:          pricings[i].total,
            agencyId:           actor.agencyId ?? null,
            status:             'PENDING_PAYMENT',
            qrCode:             `pending-${uuidv4()}`,
            expiresAt,
            version:            0,
          },
        });

        // Phase 5 : compteurs CRM incrémentés dans la même transaction
        if (crmRes?.customer.id) {
          await this.crmResolver.bumpCounters(
            tx as unknown as { customer: { update: Function } },
            crmRes.customer.id, 'ticket',
            BigInt(Math.round(pricings[i].total * 100)),
          );
        }

        const event: DomainEvent = {
          id:            uuidv4(),
          type:          EventTypes.TICKET_ISSUED,
          tenantId,
          aggregateId:   t.id,
          aggregateType: 'Ticket',
          payload:       { ticketId: t.id, tripId: dto.tripId, price: pricings[i].total, customerId: crmRes?.customer.id ?? null },
          occurredAt:    new Date(),
        };
        await this.eventBus.publish(event, tx as any);

        created.push(t);
      }

      return created;
    });

    // Recompute segments pour tous les Customers touchés (fire-and-forget)
    const touchedCustomers = [...new Set(
      tickets.map(t => (t as unknown as { customerId: string | null }).customerId).filter((s): s is string => !!s),
    )];
    for (const cid of touchedCustomers) {
      void this.crmResolver.recomputeSegmentsFor(tenantId, cid);
    }

    const grandTotal = pricings.reduce((sum, p) => sum + p.total, 0);

    return {
      tickets,
      pricingSummary: {
        perTicket: tickets.map((t, i) => ({
          ticketId:      t.id,
          passengerName: t.passengerName,
          seatNumber:    t.seatNumber,
          total:         pricings[i].total,
          fareClass:     pricings[i].fareClass,
          currency:      pricings[i].currency,
        })),
        grandTotal,
        currency: pricings[0]?.currency ?? '',
      },
    };
  }

  async confirmBatch(tenantId: string, dto: ConfirmBatchDto, actor: CurrentUserPayload, idempotencyKey?: string) {
    const results = [];
    for (const ticketId of dto.ticketIds) {
      const confirmed = await this.confirm(tenantId, ticketId, actor, idempotencyKey);
      results.push(confirmed);
    }

    // ── Traçabilité caisse : une ligne par billet confirmé ─────────────────
    // - Si dto.cashRegisterId === null → achat hors caisse (portail, paiement en ligne)
    // - Si dto.cashRegisterId fourni  → vérifié côté service (scope own)
    // - Sinon on retrouve la caisse ouverte de l'acteur (staff au guichet)
    if (dto.cashRegisterId !== null) {
      const registerId = dto.cashRegisterId
        ?? (await this.cashier.getMyOpenRegister(tenantId, actor.id))?.id;

      if (registerId) {
        const method = (dto.paymentMethod ?? 'CASH') as CashierPaymentMethod;
        for (const r of results) {
          const ticket = r.entity;
          try {
            await this.cashier.recordTransaction(
              tenantId,
              registerId,
              {
                type:          'TICKET',
                amount:        ticket.pricePaid ?? 0,
                paymentMethod: method,
                externalRef:   dto.externalRef
                  ? `${dto.externalRef}:${ticket.id}`
                  : `ticket:${ticket.id}`,
                referenceType: 'TICKET',
                referenceId:   ticket.id,
              },
              actor,
              undefined,
              { skipScopeCheck: false, actorId: actor.id },
            );
          } catch (err) {
            // N'invalide pas la confirmation ticket ; l'opérateur peut corriger la caisse.
            this.logger.warn(
              `Auto-record cashier TX failed ticket=${ticket.id} register=${registerId}: ${(err as Error).message}`,
            );
          }
        }
      }
    }

    return results;
  }

  async confirm(tenantId: string, ticketId: string, actor: CurrentUserPayload, idempotencyKey?: string) {
    const ticket = await this.findOne(tenantId, ticketId);
    const expiresAt = ticket.expiresAt;
    if (expiresAt && new Date() > expiresAt) {
      throw new BadRequestException('Ticket payment window expired');
    }

    // Generate QR code upon confirmation
    const qrToken = await this.qr.sign({
      ticketId: ticket.id,
      tenantId,
      tripId:   ticket.tripId,
      seatNumber: ticket.seatNumber,
      issuedAt: Date.now(),
    });

    return this.workflow.transition(ticket as any, {
      action: TicketAction.PAY,
      actor,
      idempotencyKey,
    }, {
      aggregateType: 'Ticket',
      persist: async (entity, state, prisma) => {
        return prisma.ticket.update({
          where: { id: entity.id },
          data:  { status: state, qrCode: qrToken, version: { increment: 1 } },
        }) as Promise<typeof entity>;
      },
    });
  }

  async validate(tenantId: string, qrInput: string, actor: CurrentUserPayload) {
    // Tolérer token HMAC brut OU URL publique de verify (/verify/ticket/:id?q=TOKEN).
    // Les billets récents encodent l'URL dans leur QR pour permettre au voyageur
    // de voir son document officiel. Les apps agent scannent le QR → reçoivent
    // l'URL → on doit extraire le token. La vérification HMAC filtre le reste.
    const qrToken = extractQrToken(qrInput);
    const payload = await this.qr.verify(qrToken, tenantId);
    const ticket  = await this.findOne(tenantId, payload.ticketId);

    if (ticket.status !== 'CONFIRMED' && ticket.status !== 'CHECKED_IN') {
      throw new BadRequestException(`Ticket is not in a validatable state: ${ticket.status}`);
    }

    return this.workflow.transition(ticket as any, {
      action: TicketAction.BOARD,
      actor,
    }, {
      aggregateType: 'Ticket',
      persist: async (entity, state, prisma) => {
        return prisma.ticket.update({
          where: { id: entity.id },
          data:  { status: state, version: { increment: 1 } },
        }) as Promise<typeof entity>;
      },
    });
  }

  async cancel(tenantId: string, ticketId: string, actor: CurrentUserPayload, reason?: string) {
    const ticket = await this.findOne(tenantId, ticketId);
    const wasConfirmed = ticket.status === 'CONFIRMED' || ticket.status === 'CHECKED_IN';

    const updated = await this.workflow.transition(ticket as any, {
      action:  TicketAction.CANCEL,
      actor,
      context: { reason },
    }, {
      aggregateType: 'Ticket',
      persist: async (entity, state, prisma) => {
        return prisma.ticket.update({
          where: { id: entity.id },
          data:  { status: state, version: { increment: 1 } },
        }) as Promise<typeof entity>;
      },
    });

    // Créer un remboursement basé sur la politique d'annulation du tenant
    if (wasConfirmed) {
      await this.refundService.createPolicyBasedRefund({
        tenantId,
        ticketId:       ticket.id,
        reason:         RefundReason.CLIENT_CANCEL,
        requestedBy:    actor.id,
        requestChannel: 'CASHIER',
      });
    }

    return updated;
  }

  async findOne(tenantId: string, id: string) {
    const ticket = await this.prisma.ticket.findFirst({ where: { id, tenantId } });
    if (!ticket) throw new NotFoundException(`Ticket ${id} not found`);
    return ticket;
  }

  async findMany(tenantId: string, tripId?: string, filters?: { status?: string }) {
    const tickets = await this.prisma.ticket.findMany({
      where: {
        tenantId,
        ...(tripId ? { tripId } : {}),
        ...(filters?.status ? { status: filters.status } : {}),
      },
      include: {
        boardingStation:  { select: { id: true, name: true, city: true } },
        alightingStation: { select: { id: true, name: true, city: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (tickets.length === 0) return [];

    // Hydrate trip + route (pas de relation Prisma directe)
    const tripIds = Array.from(new Set(tickets.map(t => t.tripId)));
    const trips = await this.prisma.trip.findMany({
      where: { id: { in: tripIds }, tenantId },
      include: {
        route: { include: { origin: true, destination: true } },
        bus:   { select: { id: true, plateNumber: true } },
      },
    });
    const tripMap = new Map(trips.map(t => [t.id, t]));

    return tickets.map(t => ({ ...t, trip: tripMap.get(t.tripId) ?? null }));
  }

  async findByTrip(tenantId: string, tripId: string) {
    return this.prisma.ticket.findMany({
      where:   { tenantId, tripId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Liste les billets de l'utilisateur courant (CUSTOMER) — page "Mes voyages".
   * Filtré par passengerId — un client ne voit jamais les billets d'autrui.
   * Trip n'est pas une relation Prisma sur Ticket : on hydrate en 2e requête.
   */
  async findMine(tenantId: string, userId: string) {
    const tickets = await this.prisma.ticket.findMany({
      where:   { tenantId, passengerId: userId },
      orderBy: { createdAt: 'desc' },
      take:    100,
    });
    if (tickets.length === 0) return [];

    const tripIds = Array.from(new Set(tickets.map(t => t.tripId)));
    const trips = await this.prisma.trip.findMany({
      where:   { id: { in: tripIds }, tenantId },
      include: {
        route: { select: { id: true, name: true } },
        bus:   { select: { id: true, plateNumber: true } },
      },
    });
    const tripMap = new Map(trips.map(t => [t.id, t]));

    return tickets.map(t => ({ ...t, trip: tripMap.get(t.tripId) ?? null }));
  }

  async trackByCode(tenantId: string, qrCode: string) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { tenantId, qrCode },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }
}
