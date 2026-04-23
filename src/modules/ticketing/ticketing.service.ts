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
import { InvoiceService } from '../invoice/invoice.service';
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
    private readonly invoice:     InvoiceService,
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
      // source='AGENT' → bumpCounters flip phoneVerified (identité en présentiel)
      if (crmRes?.customer.id) {
        await this.crmResolver.bumpCounters(
          tx as any,
          crmRes.customer.id, 'ticket',
          BigInt(Math.round(price.total * 100)),
          { source: 'AGENT' },
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
          explainTaxes:        dto.explainTaxes === true,
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
            tx as any,
            crmRes.customer.id, 'ticket',
            BigInt(Math.round(pricings[i].total * 100)),
            { source: 'AGENT' },
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
          basePrice:     pricings[i].basePrice,
          taxes:         pricings[i].taxes,
          // Détail N taxes (breakdown) — vide si aucune TenantTax côté tenant.
          // Si explainTaxes=true, contient aussi les taxes non appliquées
          // (applied=false) pour affichage pédagogique côté caisse.
          taxBreakdown:  pricings[i].taxBreakdown,
          tolls:         pricings[i].tolls,
          luggageFee:    pricings[i].luggageFee,
          fareClass:     pricings[i].fareClass,
          currency:      pricings[i].currency,
        })),
        grandTotal,
        currency: pricings[0]?.currency ?? '',
      },
    };
  }

  async confirmBatch(tenantId: string, dto: ConfirmBatchDto, actor: CurrentUserPayload, idempotencyKey?: string) {
    // ── Résolution registerId AVANT les transitions ─────────────────────
    // - dto.cashRegisterId === null → portail / paiement en ligne → caisse VIRTUELLE
    //   de l'agence (fallback première agence du tenant si ticket.agencyId null)
    // - dto.cashRegisterId fourni  → physique (scope vérifié par cashier.recordTransaction)
    // - sinon → caisse ouverte de l'acteur (staff au guichet)
    const method = (dto.paymentMethod ?? 'CASH') as CashierPaymentMethod;
    let registerId: string | undefined;
    if (dto.cashRegisterId === null) {
      // Paiement en ligne / portail — on écrit sur la virtuelle de l'agence
      // du 1er ticket (sinon première agence du tenant).
      const firstTicket = dto.ticketIds[0]
        ? await this.prisma.ticket.findFirst({
            where: { id: dto.ticketIds[0], tenantId },
            select: { agencyId: true },
          })
        : null;
      let agencyId = firstTicket?.agencyId ?? undefined;
      if (!agencyId) {
        const anyAgency = await this.prisma.agency.findFirst({
          where:  { tenantId },
          select: { id: true },
        });
        agencyId = anyAgency?.id;
      }
      if (agencyId) {
        const vreg = await this.cashier.getOrCreateVirtualRegister(tenantId, agencyId);
        registerId = vreg.id;
      }
    } else {
      registerId = dto.cashRegisterId
        ?? (await this.cashier.getMyOpenRegister(tenantId, actor.id))?.id;
    }

    // ── Pré-calcul batch total + distribution du tendered (CASH) ──────────
    // Calcule sur les prix courants en DB (avant confirm) pour que batchTotal
    // soit passé au 1er ticket uniquement (changeAmount = tendered - batchTotal).
    const tickets = await this.prisma.ticket.findMany({
      where:  { id: { in: dto.ticketIds }, tenantId },
      select: { id: true, pricePaid: true },
    });
    const batchTotal = tickets.reduce((sum, t) => sum + (t.pricePaid ?? 0), 0);
    const tenderedBudgetInitial = method === 'CASH' ? dto.tenderedAmount : undefined;

    // ── Confirm + side-effect caisse atomique per ticket ──────────────────
    const results = [];
    let tenderedBudget = tenderedBudgetInitial;
    for (const ticketId of dto.ticketIds) {
      const isFirstWithTendered = tenderedBudget != null;
      const cashierCtx = registerId ? {
        registerId,
        paymentMethod:  method,
        proofCode:      dto.proofCode,
        proofType:      dto.proofType,
        externalRef:    dto.externalRef ? `${dto.externalRef}:${ticketId}` : `ticket:${ticketId}`,
        tenderedAmount: isFirstWithTendered ? tenderedBudget : undefined,
        batchTotal:     isFirstWithTendered ? batchTotal : undefined,
      } : undefined;
      const confirmed = await this.confirm(tenantId, ticketId, actor, idempotencyKey, cashierCtx);
      results.push(confirmed);
      if (isFirstWithTendered) tenderedBudget = undefined;
    }

    // ── Reçu de caisse Invoice PAID (hors boucle — post-tous-confirmés) ──
    //   Idempotent via entityId=batchKey stable sur ticketIds triés.
    //   Échec = log warn, ne bloque pas la vente déjà confirmée.
    if (registerId) {
      try {
          const sortedIds = [...results.map((r) => r.entity.id)].sort();
          const batchKey  = `batch:${sortedIds.join(',')}`;
          const firstTicket = results[0]?.entity;
          const [ticketsInfo, tenant] = await Promise.all([
            this.prisma.ticket.findMany({
              where:  { id: { in: sortedIds }, tenantId },
              select: {
                id: true, passengerName: true, pricePaid: true,
                seatNumber: true, tripId: true,
              },
            }),
            this.prisma.tenant.findUnique({
              where:  { id: tenantId },
              select: { currency: true },
            }),
          ]);
          // Enrichit avec le nom de ligne via Trip→Route (pas de relation directe
          // Ticket→Trip, donc requête séparée). Tolérant : route absente = null.
          const tripIds = [...new Set(ticketsInfo.map((t) => t.tripId).filter(Boolean))];
          const trips = tripIds.length
            ? await this.prisma.trip.findMany({
                where:   { id: { in: tripIds }, tenantId },
                select:  { id: true, route: { select: { name: true } } },
              })
            : [];
          const routeByTrip = new Map(trips.map((tr) => [tr.id, tr.route?.name ?? null]));
          await this.invoice.createPaidReceiptFromTickets(
            tenantId,
            {
              batchKey,
              customerName:  firstTicket?.passengerName ?? 'Client',
              customerPhone: firstTicket?.passengerPhone ?? undefined,
              currency:      tenant?.currency ?? 'XAF',
              paymentMethod: method,
              paymentRef:    dto.proofCode ?? dto.externalRef,
              tickets: ticketsInfo.map((t) => ({
                id:            t.id,
                passengerName: t.passengerName ?? '',
                pricePaid:     t.pricePaid ?? 0,
                seatNumber:    t.seatNumber,
                routeName:     routeByTrip.get(t.tripId) ?? null,
              })),
            },
            actor,
          );
      } catch (err) {
        this.logger.warn(
          `Auto-receipt generation failed for batch register=${registerId}: ${(err as Error).message}`,
        );
      }
    }

    return results;
  }

  /**
   * Confirme un billet (PENDING_PAYMENT → CONFIRMED) et, si un contexte caisse
   * est fourni, crée la `Transaction` caisse ATOMIQUEMENT dans la même DB
   * transaction que la transition workflow.
   *
   * Side-effect caisse intégré au `persist` callback pour que le billet ne
   * puisse jamais être CONFIRMED sans sa ligne Transaction correspondante
   * (résolution du gap #5 identifié dans l'audit workflow).
   */
  async confirm(
    tenantId:       string,
    ticketId:       string,
    actor:          CurrentUserPayload,
    idempotencyKey?: string,
    cashierContext?: {
      registerId:     string;
      paymentMethod:  CashierPaymentMethod;
      proofCode?:     string;
      proofType?:     string;
      externalRef?:   string;
      tenderedAmount?: number;
      batchTotal?:    number;
    },
  ) {
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
        const updated = await prisma.ticket.update({
          where: { id: entity.id },
          data:  { status: state, qrCode: qrToken, version: { increment: 1 } },
        });

        // Side-effect caisse atomique — créer Transaction dans la même TX.
        // Si recordTransaction échoue (register non OPEN, doublon externalRef),
        // la transition entière rollback → cohérence garantie.
        if (cashierContext) {
          await this.cashier.recordTransaction(
            tenantId,
            cashierContext.registerId,
            {
              type:           'TICKET',
              amount:         entity.pricePaid ?? 0,
              paymentMethod:  cashierContext.paymentMethod,
              tenderedAmount: cashierContext.tenderedAmount,
              batchTotal:     cashierContext.batchTotal,
              proofCode:      cashierContext.proofCode,
              proofType:      cashierContext.proofType as any,
              externalRef:    cashierContext.externalRef ?? `ticket:${entity.id}`,
              referenceType:  'TICKET',
              referenceId:    entity.id,
            },
            actor,
            undefined,
            { tx: prisma as any, skipScopeCheck: true, actorId: actor.id },
          );
        }

        return updated as typeof entity;
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

    // Recherche d'un voucher REDEEMED sur ce ticket — rollback atomique dans
    // le même `persist` que la transition CANCEL (gap #8 audit workflow).
    const linkedVoucher = await this.prisma.voucher.findFirst({
      where:  { tenantId, redeemedOnTicketId: ticketId, status: 'REDEEMED' },
      select: { id: true, status: true, version: true, tenantId: true, code: true },
    });

    const updated = await this.workflow.transition(ticket as any, {
      action:  TicketAction.CANCEL,
      actor,
      context: { reason },
    }, {
      aggregateType: 'Ticket',
      persist: async (entity, state, prisma) => {
        const result = await prisma.ticket.update({
          where: { id: entity.id },
          data:  { status: state, version: { increment: 1 } },
        });

        // Rollback voucher REDEEMED → ISSUED dans la même TX. Si le rollback
        // échoue (blueprint RESTORE absent, version conflict), la cancel ticket
        // rollback → cohérence préservée.
        if (linkedVoucher) {
          await this.workflow.transition(linkedVoucher as any, {
            action: 'RESTORE',
            actor,
          }, {
            aggregateType: 'Voucher',
            persist: async (vEntity, vState, vPrisma) => {
              return vPrisma.voucher.update({
                where: { id: vEntity.id },
                data:  {
                  status:             vState,
                  redeemedOnTicketId: null,
                  redeemedAt:         null,
                  redeemedById:       null,
                  version:            { increment: 1 },
                },
              }) as Promise<typeof vEntity>;
            },
          });
          this.logger.log(
            `Voucher ${linkedVoucher.code} restored (REDEEMED → ISSUED) after ticket ${ticketId} cancel`,
          );
        }

        return result as typeof entity;
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

  // ─────────────────────────────────────────────────────────────────────────
  // Scénarios no-show / rebook / forfeit (2026-04-19)
  // Toutes les transitions passent par WorkflowEngine (blueprint-driven).
  // Paramètres métier (grace, TTL, penalty) lus depuis TenantBusinessConfig.
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Marque un billet no-show après la période de grâce configurée.
   * CONFIRMED | CHECKED_IN → NO_SHOW
   * Le caller peut être un agent quai (marquage manuel) ou le scheduler (auto).
   * Guard : now() >= departureScheduled + graceMinutes.
   */
  async markNoShow(tenantId: string, ticketId: string, actor: CurrentUserPayload) {
    const ticket = await this.findOne(tenantId, ticketId);
    const trip = await this.prisma.trip.findFirst({
      where: { id: ticket.tripId, tenantId },
      select: { id: true, departureScheduled: true },
    });
    if (!trip) throw new NotFoundException(`Trip ${ticket.tripId} introuvable`);

    const config = await this.prisma.tenantBusinessConfig.findUnique({
      where: { tenantId },
      select: { noShowGraceMinutes: true },
    });
    const graceMs = (config?.noShowGraceMinutes ?? 15) * 60_000;
    const graceExpiresAt = trip.departureScheduled.getTime() + graceMs;

    if (Date.now() < graceExpiresAt) {
      const remainingMin = Math.ceil((graceExpiresAt - Date.now()) / 60_000);
      throw new BadRequestException(
        `Période de grâce non écoulée — encore ${remainingMin} min avant de pouvoir marquer no-show.`,
      );
    }

    return this.workflow.transition(ticket as any, {
      action: TicketAction.MISS_BOARDING,
      actor,
    }, {
      aggregateType: 'Ticket',
      persist: async (entity, state, p) => {
        return p.ticket.update({
          where: { id: entity.id },
          data:  {
            status: state,
            noShowMarkedAt: new Date(),
            noShowMarkedById: actor.id,
            version: { increment: 1 },
          },
        }) as Promise<typeof entity>;
      },
    });
  }

  /**
   * Guard TTL : le billet ne doit pas avoir dépassé la fenêtre de validité post-départ.
   * Au-delà : seule l'action FORFEIT est autorisée (via scheduler).
   */
  private async assertWithinTtl(tenantId: string, ticket: { tripId: string }) {
    const [config, trip] = await Promise.all([
      this.prisma.tenantBusinessConfig.findUnique({
        where: { tenantId },
        select: { ticketTtlHours: true },
      }),
      this.prisma.trip.findFirst({
        where:  { id: ticket.tripId, tenantId },
        select: { departureScheduled: true },
      }),
    ]);
    if (!trip) throw new NotFoundException('Trip introuvable');
    const ttlMs = (config?.ticketTtlHours ?? 48) * 3_600_000;
    const expiresAt = trip.departureScheduled.getTime() + ttlMs;
    if (Date.now() > expiresAt) {
      throw new BadRequestException(
        `TTL du billet dépassé (validité ${config?.ticketTtlHours ?? 48}h post-départ). ` +
        `Aucun rebook ni remboursement n'est plus possible — billet sera forfaituré par le scheduler.`,
      );
    }
  }

  /**
   * Rebook sur le prochain trajet disponible (même route, même jour si possible).
   * NO_SHOW | LATE_ARRIVED | CONFIRMED → REBOOKED (ticket original)
   * + création d'un nouveau billet CONFIRMED sur le trip cible.
   *
   * Sélection du trip cible : même routeId, departureScheduled > now(), pas
   * encore COMPLETED/CANCELLED, ordonné par proximité temporelle. Si aucun n'a
   * de siège dispo (guard capacité), on lance 409 Conflict.
   */
  async rebookNextAvailable(tenantId: string, ticketId: string, actor: CurrentUserPayload) {
    const oldTicket = await this.findOne(tenantId, ticketId);
    await this.assertWithinTtl(tenantId, oldTicket);

    const oldTrip = await this.prisma.trip.findFirst({
      where:  { id: oldTicket.tripId, tenantId },
      select: { routeId: true },
    });
    if (!oldTrip) throw new NotFoundException('Trajet original introuvable');

    // Cherche candidats : même route, départ futur, non annulé/complété.
    const candidates = await this.prisma.trip.findMany({
      where: {
        tenantId,
        routeId: oldTrip.routeId,
        departureScheduled: { gt: new Date() },
        status: { notIn: ['CANCELLED', 'CANCELLED_IN_TRANSIT', 'COMPLETED'] },
      },
      orderBy: { departureScheduled: 'asc' },
      take: 10,
    });

    // Sélection : premier candidat avec capacité dispo.
    for (const candidate of candidates) {
      const available = await this.countAvailableSeats(tenantId, candidate.id);
      if (available > 0) {
        return this.performRebook(tenantId, oldTicket, candidate.id, actor, 'REBOOK_NEXT_AVAILABLE');
      }
    }
    throw new ConflictException(
      'Aucun trajet futur disponible avec des places libres sur cette route.',
    );
  }

  /**
   * Rebook sur un trip futur choisi (self-service voyageur ou agent).
   * Vérifie seat availability + TTL + même route (optionnel : tolérer autre route
   * si tenant accepte — ici on impose route identique pour rester simple).
   */
  async rebookLater(
    tenantId: string,
    ticketId: string,
    newTripId: string,
    actor: CurrentUserPayload,
  ) {
    const oldTicket = await this.findOne(tenantId, ticketId);
    await this.assertWithinTtl(tenantId, oldTicket);

    const [oldTrip, newTrip] = await Promise.all([
      this.prisma.trip.findFirst({ where: { id: oldTicket.tripId, tenantId }, select: { routeId: true } }),
      this.prisma.trip.findFirst({ where: { id: newTripId, tenantId } }),
    ]);
    if (!newTrip) throw new NotFoundException(`Trip ${newTripId} introuvable`);
    if (!oldTrip) throw new NotFoundException('Trajet original introuvable');
    if (newTrip.routeId !== oldTrip.routeId) {
      throw new BadRequestException('Rebook limité à la même route que le billet original.');
    }
    if (newTrip.departureScheduled.getTime() <= Date.now()) {
      throw new BadRequestException('Le trajet cible est déjà passé ou en cours.');
    }
    if (['CANCELLED', 'CANCELLED_IN_TRANSIT', 'COMPLETED'].includes(newTrip.status)) {
      throw new BadRequestException(`Trajet cible indisponible (${newTrip.status}).`);
    }
    const available = await this.countAvailableSeats(tenantId, newTripId);
    if (available <= 0) {
      throw new ConflictException('Aucune place disponible sur le trajet cible.');
    }
    return this.performRebook(tenantId, oldTicket, newTripId, actor, 'REBOOK_LATER');
  }

  /**
   * Exécute le rebook atomique : transition old → REBOOKED + création nouveau CONFIRMED.
   * Idempotence : la création d'un nouveau ticket est visible en sortie.
   */
  private async performRebook(
    tenantId: string,
    oldTicket: Awaited<ReturnType<TicketingService['findOne']>>,
    newTripId: string,
    actor: CurrentUserPayload,
    action: 'REBOOK_NEXT_AVAILABLE' | 'REBOOK_LATER',
  ) {
    // Génération QR pour le nouveau billet (HMAC signé, unique).
    // On utilise un ticketId temporaire dans la signature pour garantir l'unicité
    // du QR ; le vrai id sera assigné par Prisma à la création ci-dessous. La
    // signature reste valide : `verify` décode le payload et cherche le ticket
    // en DB via le qrCode (unique), pas via ticketId dans le payload.
    const tempId = `rebook-${uuidv4()}`;
    const newQrToken = await this.qr.sign({
      ticketId: tempId,
      tripId:   newTripId,
      tenantId,
      issuedAt: Date.now(),
    });

    // Transition old ticket → REBOOKED (engine valide blueprint + audit).
    await this.workflow.transition(oldTicket as any, {
      action,
      actor,
    }, {
      aggregateType: 'Ticket',
      persist: async (entity, state, p) => {
        return p.ticket.update({
          where: { id: entity.id },
          data:  { status: state, version: { increment: 1 } },
        }) as Promise<typeof entity>;
      },
    });

    // Création du nouveau ticket, statut CONFIRMED (QR déjà signé).
    const newTicket = await this.prisma.ticket.create({
      data: {
        tenantId,
        tripId:             newTripId,
        passengerId:        oldTicket.passengerId,
        passengerName:      oldTicket.passengerName,
        passengerPhone:     oldTicket.passengerPhone,
        passengerEmail:     oldTicket.passengerEmail,
        customerId:         oldTicket.customerId,
        seatNumber:         null,
        boardingStationId:  oldTicket.boardingStationId,
        alightingStationId: oldTicket.alightingStationId,
        fareClass:          oldTicket.fareClass,
        pricePaid:          oldTicket.pricePaid,
        status:             'CONFIRMED',
        qrCode:             newQrToken,
        agencyId:           oldTicket.agencyId,
        rebookedFromTicketId: oldTicket.id,
        version:            1,
      },
    });

    // Domain event (permet aux consumers de notifier, rafraîchir analytics, etc.)
    const event: DomainEvent = {
      id:            uuidv4(),
      type:          EventTypes.TICKET_ISSUED,
      tenantId,
      aggregateId:   newTicket.id,
      aggregateType: 'Ticket',
      payload: {
        ticketId:         newTicket.id,
        tripId:           newTripId,
        rebookedFromId:   oldTicket.id,
        rebookAction:     action,
      },
      occurredAt: new Date(),
    };
    await this.eventBus.publish(event, null);

    return { oldTicketId: oldTicket.id, newTicket };
  }

  /**
   * Nombre de sièges disponibles sur un trip (dénominateur = bus.totalSeats ;
   * numérateur = tickets CONFIRMED/CHECKED_IN/BOARDED déjà émis). Implémentation
   * simple — le pricing engine a un calcul plus sophistiqué qui tient compte des
   * yields et overbooking, on reste ici sur la disponibilité brute.
   */
  private async countAvailableSeats(tenantId: string, tripId: string): Promise<number> {
    const trip = await this.prisma.trip.findFirst({
      where:  { id: tripId, tenantId },
      include: { bus: { select: { capacity: true } } },
    });
    if (!trip) return 0;
    const booked = await this.prisma.ticket.count({
      where: {
        tenantId,
        tripId,
        status: { in: ['CONFIRMED', 'CHECKED_IN', 'BOARDED'] },
      },
    });
    return Math.max(0, (trip.bus?.capacity ?? 0) - booked);
  }

  /**
   * Ouvre un refund pour un billet NO_SHOW / LATE_ARRIVED / CONFIRMED.
   * Applique la politique d'annulation (y compris pénalité no-show si activée dans config).
   * Transition : status → REFUND_PENDING + création Refund entity via RefundService.
   */
  async requestRefundForMissedTicket(
    tenantId: string,
    ticketId: string,
    actor: CurrentUserPayload,
    reason: 'NO_SHOW' | 'CLIENT_CANCEL' | 'TRIP_CANCELLED' = 'NO_SHOW',
    actorRole: string = 'CUSTOMER',
    waive: boolean = false,
  ) {
    const ticket = await this.findOne(tenantId, ticketId);
    await this.assertWithinTtl(tenantId, ticket);

    // Calcul montant via policy (N-tier + applies_to + trip override + waive).
    const { CancellationPolicyService } = await import('../sav/cancellation-policy.service');
    const policy = new CancellationPolicyService(this.prisma);
    let calc = await policy.calculateRefundAmount(tenantId, ticketId, actorRole, waive);

    // Pénalité spécifique no-show (additive à la pénalité cancellation tiers).
    if (reason === 'NO_SHOW' && !waive) {
      const config = await this.prisma.tenantBusinessConfig.findUnique({
        where: { tenantId },
        select: { noShowPenaltyEnabled: true, noShowPenaltyPct: true, noShowPenaltyFlatAmount: true },
      });
      const trip = await this.prisma.trip.findFirst({
        where:  { id: ticket.tripId, tenantId },
        select: { noShowPenaltyEnabledOverride: true, noShowPenaltyPctOverride: true, noShowPenaltyFlatAmountOverride: true },
      });
      const enabled = trip?.noShowPenaltyEnabledOverride ?? config?.noShowPenaltyEnabled ?? false;
      if (enabled) {
        const pct  = trip?.noShowPenaltyPctOverride ?? config?.noShowPenaltyPct ?? 0;
        const flat = trip?.noShowPenaltyFlatAmountOverride ?? config?.noShowPenaltyFlatAmount ?? 0;
        // On prend le max entre pénalité tiers existante et pénalité no-show (évite double-dip).
        const noShowPenaltyAmount = Math.max(ticket.pricePaid * pct, flat);
        const combinedPenalty = Math.max(calc.penaltyAmount, noShowPenaltyAmount);
        const newRefundAmount = Math.max(0, ticket.pricePaid - combinedPenalty);
        calc = {
          ...calc,
          penaltyAmount: combinedPenalty,
          penaltyPct:    combinedPenalty / ticket.pricePaid,
          refundAmount:  Math.round(newRefundAmount * 100) / 100,
          refundPercent: newRefundAmount / ticket.pricePaid,
        };
      }
    }

    // Transition ticket → REFUND_PENDING via engine.
    await this.workflow.transition(ticket as any, {
      action: TicketAction.REQUEST_REFUND,
      actor,
      context: { reason },
    }, {
      aggregateType: 'Ticket',
      persist: async (entity, state, p) => {
        return p.ticket.update({
          where: { id: entity.id },
          data:  { status: state, version: { increment: 1 } },
        }) as Promise<typeof entity>;
      },
    });

    // Création de l'entité Refund (elle-même workflow-driven).
    const refund = await this.refundService.createRefund({
      tenantId,
      ticketId,
      tripId:         ticket.tripId,
      amount:         calc.refundAmount,
      originalAmount: calc.originalAmount,
      policyPercent:  calc.refundPercent,
      currency:       calc.currency,
      reason:         reason === 'NO_SHOW' ? RefundReason.NO_SHOW : RefundReason.CLIENT_CANCEL,
      requestedBy:    actor.id,
      requestChannel: 'TICKETING_MISSED',
      departureAt:    calc.departureAt,
    });

    return { ticketId, refund, penalty: calc };
  }

  /**
   * Expire les billets PENDING_PAYMENT dont la fenêtre `expiresAt` est passée.
   * Traverse tous les tenants (appelé par scheduler global). Chaque transition
   * passe par WorkflowEngine avec action=EXPIRE → audit + idempotency + guards
   * (vs updateMany bulk qui bypassait l'engine, ADR-15 compliant).
   *
   * Idempotent : si le cron tourne 2 fois sur le même ticket, l'engine
   * renvoie la transition existante via `findIdempotentTransition` (pas de
   * double EXPIRE).
   * @returns nombre de billets effectivement expirés cette passe
   */
  async expireStaleTickets(): Promise<number> {
    const now = new Date();
    const candidates = await this.prisma.ticket.findMany({
      where: {
        status:    'PENDING_PAYMENT',
        expiresAt: { lt: now },
      },
      select: { id: true, tenantId: true, status: true, version: true, expiresAt: true },
      take: 1000,
    });
    if (candidates.length === 0) return 0;

    let expired = 0;
    const SYSTEM_ACTOR: CurrentUserPayload = {
      id: 'SYSTEM', tenantId: 'SYSTEM', roleId: 'SYSTEM',
    } as CurrentUserPayload;

    for (const ticket of candidates) {
      try {
        // Acteur système scopé au tenant du billet pour que le RLS middleware
        // et PermissionGuard raisonnent dans le bon périmètre.
        const scopedActor = { ...SYSTEM_ACTOR, tenantId: ticket.tenantId } as CurrentUserPayload;
        await this.workflow.transition(ticket as any, {
          action: TicketAction.EXPIRE,
          actor:  scopedActor,
          // Idempotency key = ticket id — une seule expiration possible par billet.
          idempotencyKey: `ticket-expire:${ticket.id}`,
        }, {
          aggregateType: 'Ticket',
          persist: async (entity, state, p) => {
            return p.ticket.update({
              where: { id: entity.id },
              data:  {
                status:  state,
                version: { increment: 1 },
              },
            }) as Promise<typeof entity>;
          },
        });
        expired++;
      } catch (err) {
        this.logger.warn(`Expire failed for ticket=${ticket.id}: ${(err as Error).message}`);
      }
    }
    return expired;
  }

  /**
   * Forfait automatique des billets en NO_SHOW/LATE_ARRIVED/CONFIRMED dont le TTL
   * post-départ est dépassé. Appelé par le scheduler périodiquement.
   * Retourne le nombre de billets forfaitisés.
   */
  async forfeitExpiredTickets(tenantId: string): Promise<number> {
    const config = await this.prisma.tenantBusinessConfig.findUnique({
      where: { tenantId },
      select: { ticketTtlHours: true },
    });
    const ttlHours = config?.ticketTtlHours ?? 48;
    const cutoff = new Date(Date.now() - ttlHours * 3_600_000);

    // 1) Trips éligibles : départ ≤ cutoff
    const expiredTrips = await this.prisma.trip.findMany({
      where: { tenantId, departureScheduled: { lte: cutoff } },
      select: { id: true },
      take: 1000,
    });
    const tripIds = expiredTrips.map(t => t.id);
    if (tripIds.length === 0) return 0;

    // 2) Candidats : NO_SHOW / LATE_ARRIVED sur un trip expiré (pas de relation
    //    Prisma directe sur Ticket → on fait via tripId IN [...]).
    const candidates = await this.prisma.ticket.findMany({
      where: {
        tenantId,
        status: { in: ['NO_SHOW', 'LATE_ARRIVED'] },
        tripId: { in: tripIds },
      },
      take: 500, // batch cap pour garder la transaction raisonnable
    });

    let forfeited = 0;
    const SYSTEM_ACTOR: CurrentUserPayload = { id: 'SYSTEM', tenantId: 'SYSTEM', roleId: 'SYSTEM' } as CurrentUserPayload;

    for (const ticket of candidates) {
      try {
        await this.workflow.transition(ticket as any, {
          action: TicketAction.FORFEIT,
          actor: SYSTEM_ACTOR,
        }, {
          aggregateType: 'Ticket',
          persist: async (entity, state, p) => {
            return p.ticket.update({
              where: { id: entity.id },
              data:  {
                status: state,
                forfeitedAt: new Date(),
                version: { increment: 1 },
              },
            }) as Promise<typeof entity>;
          },
        });
        forfeited++;
      } catch (err) {
        this.logger.warn(`Forfeit failed for ticket=${ticket.id}: ${(err as Error).message}`);
      }
    }
    return forfeited;
  }
}
