/**
 * VoucherService — émission / utilisation / annulation des bons de réduction.
 *
 * Un voucher représente une somme monétaire (devise tenant) offerte à un
 * bénéficiaire (Customer connu ou contact libre), utilisable sur un ticket
 * futur. One-shot : une fois redeemed, il ne peut plus être réutilisé.
 *
 * Transitions (blueprint Voucher) :
 *   ISSUED → REDEEMED    (action REDEEM, au guichet)
 *   ISSUED → EXPIRED     (action EXPIRE, scheduler)
 *   ISSUED → CANCELLED   (action CANCEL, admin — avant usage)
 *
 * Sources d'émission (champ `origin`) :
 *   INCIDENT      — auto-émis par IncidentCompensationService
 *   MAJOR_DELAY   — auto-émis après DECLARE_MAJOR_DELAY
 *   PROMO         — campagne marketing
 *   MANUAL        — geste commercial ponctuel (staff)
 *   GESTURE       — compensation amiable (SAV)
 *
 * Le code est généré côté service avec préfixe tenant-slug pour lisibilité.
 * Le workflow ISSUE n'a pas de fromState (c'est la création) — on crée
 * directement en ISSUED puis on transitionne via engine pour REDEEM/EXPIRE/CANCEL.
 */
import { Injectable, NotFoundException, BadRequestException, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { WorkflowEngine } from '../../core/workflow/workflow.engine';
import { CashierService } from '../cashier/cashier.service';
import {
  VoucherState,
  VoucherAction,
  VoucherUsageScope,
} from '../../common/constants/workflow-states';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { randomBytes } from 'crypto';
import { IEventBus, EVENT_BUS, DomainEvent } from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { EventTypes } from '../../common/types/domain-event.type';
import { v4 as uuidv4 } from 'uuid';

const SYSTEM_ACTOR: CurrentUserPayload = {
  id:       'SYSTEM',
  tenantId: 'SYSTEM',
  roleId:   'SYSTEM',
} as CurrentUserPayload;

export interface IssueVoucherParams {
  tenantId:       string;
  customerId?:    string | null;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  amount:         number;        // devise tenant
  currency:       string;
  validityDays:   number;         // durée de validité à partir de maintenant
  usageScope?:    string;         // VoucherUsageScope, défaut SAME_COMPANY
  routeId?:       string | null;  // si scope SAME_ROUTE
  origin:         'INCIDENT' | 'MAJOR_DELAY' | 'PROMO' | 'MANUAL' | 'GESTURE';
  sourceTripId?:  string | null;
  sourceTicketId?: string | null;
  issuedBy?:      string;
  metadata?:      Record<string, unknown>;
}

@Injectable()
export class VoucherService {
  private readonly logger = new Logger(VoucherService.name);

  constructor(
    private readonly prisma:   PrismaService,
    private readonly workflow: WorkflowEngine,
    private readonly cashier:  CashierService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  /**
   * Émet un nouveau voucher. Le code est unique, généré cryptographiquement.
   * La validité se calcule à partir de maintenant + validityDays.
   */
  async issue(params: IssueVoucherParams) {
    if (params.amount <= 0) {
      throw new BadRequestException('Le montant du voucher doit être strictement positif');
    }
    if (params.validityDays < 1) {
      throw new BadRequestException('La validité doit être d\'au moins 1 jour');
    }

    const code = await this.generateUniqueCode(params.tenantId);
    const now = new Date();
    const validityEnd = new Date(now.getTime() + params.validityDays * 86_400_000);

    // Création + émission VOUCHER_ISSUED dans la MÊME tx Prisma (Outbox atomique).
    // Évite les events orphelins si le create échoue après l'émission, ou un voucher
    // créé sans event si la publication échoue.
    const voucher = await this.prisma.transact(async (tx) => {
      const created = await tx.voucher.create({
        data: {
          tenantId:       params.tenantId,
          code,
          customerId:     params.customerId ?? null,
          recipientEmail: params.recipientEmail ?? null,
          recipientPhone: params.recipientPhone ?? null,
          amount:         params.amount,
          currency:       params.currency,
          usageScope:     params.usageScope ?? VoucherUsageScope.SAME_COMPANY,
          routeId:        params.routeId ?? null,
          validityStart:  now,
          validityEnd,
          status:         VoucherState.ISSUED,
          origin:         params.origin,
          sourceTripId:   params.sourceTripId ?? null,
          sourceTicketId: params.sourceTicketId ?? null,
          issuedBy:       params.issuedBy ?? 'SYSTEM',
          metadata:       (params.metadata ?? {}) as object,
          version:        1,
        },
      });

      const event: DomainEvent = {
        id:            uuidv4(),
        type:          EventTypes.VOUCHER_ISSUED,
        tenantId:      params.tenantId,
        aggregateId:   created.id,
        aggregateType: 'Voucher',
        payload: {
          voucherId:      created.id,
          code:           created.code,
          amount:         created.amount,
          currency:       created.currency,
          validityEnd:    created.validityEnd.toISOString(),
          origin:         created.origin,
          usageScope:     created.usageScope,
          sourceTripId:   created.sourceTripId,
          sourceTicketId: created.sourceTicketId,
        },
        occurredAt: new Date(),
      };
      await this.eventBus.publish(event, tx);
      return created;
    });

    this.logger.log(
      `[Voucher] issued code=${code} amount=${params.amount}${params.currency} ` +
      `origin=${params.origin} tenant=${params.tenantId}`,
    );
    return voucher;
  }

  /**
   * Applique un voucher à un ticket (au moment du paiement / rebook).
   * Validations :
   *   - voucher ISSUED (pas déjà consommé/expiré/annulé)
   *   - current time ≤ validityEnd
   *   - scope (SAME_ROUTE, SAME_COMPANY, ANY_TRIP)
   *   - customerId match ou recipientPhone match (anti-transfert)
   *
   * Transition ISSUED → REDEEMED via engine. Stamp redeemedOnTicketId, redeemedAt, redeemedById.
   */
  async redeem(
    tenantId: string,
    code: string,
    targetTicketId: string,
    actor: CurrentUserPayload,
  ) {
    const voucher = await this.prisma.voucher.findFirst({
      where: { tenantId, code },
    });
    if (!voucher) throw new NotFoundException(`Voucher ${code} introuvable`);

    if (voucher.status !== VoucherState.ISSUED) {
      throw new BadRequestException(
        `Voucher ${code} n'est plus utilisable (status: ${voucher.status})`,
      );
    }
    if (voucher.validityEnd.getTime() < Date.now()) {
      throw new BadRequestException(
        `Voucher ${code} expiré depuis le ${voucher.validityEnd.toISOString()}`,
      );
    }

    // Vérif scope : si SAME_ROUTE, le ticket doit être sur la même route que source.
    const ticket = await this.prisma.ticket.findFirst({
      where:  { id: targetTicketId, tenantId },
      select: { id: true, tripId: true, customerId: true, passengerPhone: true, agencyId: true },
    });
    if (!ticket) throw new NotFoundException(`Ticket ${targetTicketId} introuvable`);

    if (voucher.usageScope === VoucherUsageScope.SAME_ROUTE && voucher.routeId) {
      const trip = await this.prisma.trip.findFirst({
        where: { id: ticket.tripId, tenantId },
        select: { routeId: true },
      });
      if (trip?.routeId !== voucher.routeId) {
        throw new BadRequestException(
          'Ce voucher est restreint à une route spécifique — ticket hors scope.',
        );
      }
    }

    // Anti-transfert : si voucher lié à un customer, le ticket doit être sur le même customer
    // OU le phone doit matcher. On reste permissif côté staff guichet (qui redeem au nom
    // du voyageur) : si recipientPhone du voucher match le passengerPhone du ticket, OK.
    if (voucher.customerId && ticket.customerId && voucher.customerId !== ticket.customerId) {
      if (!voucher.recipientPhone || voucher.recipientPhone !== ticket.passengerPhone) {
        throw new BadRequestException(
          'Ce voucher est nominatif — bénéficiaire ne correspond pas au voyageur.',
        );
      }
    }

    // Pré-résolution caisse VIRTUELLE de l'agence du ticket.
    // Si le ticket n'a pas d'agencyId (ticket de portail public), on tombe
    // sur la première agence du tenant — la caisse virtuelle existe toujours.
    let agencyId = ticket.agencyId ?? null;
    if (!agencyId) {
      const anyAgency = await this.prisma.agency.findFirst({
        where:  { tenantId },
        select: { id: true },
      });
      agencyId = anyAgency?.id ?? null;
    }

    await this.workflow.transition(
      voucher as unknown as Parameters<WorkflowEngine['transition']>[0],
      { action: VoucherAction.REDEEM, actor },
      {
        aggregateType: 'Voucher',
        persist: async (entity, state, p) => {
          const updated = await p.voucher.update({
            where: { id: entity.id },
            data: {
              status:              state,
              redeemedOnTicketId:  targetTicketId,
              redeemedAt:          new Date(),
              redeemedById:        actor.id,
              version:             { increment: 1 },
            },
          });

          // Side-effect caisse atomique — Transaction{type:VOUCHER, amount:-voucher.amount}
          // sur la caisse VIRTUELLE de l'agence. ADR-15 : la trace comptable
          // du voucher est inscrite dans la même TX que le marquage REDEEMED.
          // Échec → rollback entier (voucher reste ISSUED).
          if (agencyId) {
            const vreg = await this.cashier.getOrCreateVirtualRegister(tenantId, agencyId, p as any);
            await this.cashier.recordTransaction(
              tenantId,
              vreg.id,
              {
                type:          'VOUCHER',
                amount:        -Math.abs((entity as any).amount),
                paymentMethod: 'VOUCHER',
                externalRef:   `voucher:${entity.id}:ticket:${targetTicketId}`,
                referenceType: 'TICKET',
                referenceId:   targetTicketId,
                note:          `Redeem voucher ${(entity as any).code} sur ticket ${targetTicketId}`,
              },
              actor,
              undefined,
              { tx: p as any, skipScopeCheck: true, actorId: actor.id },
            );
          } else {
            this.logger.warn(
              `Voucher ${(entity as any).code} redeemed sans caisse virtuelle (tenant ${tenantId} sans agence) — trace comptable manquante`,
            );
          }

          return updated as typeof entity;
        },
      },
    );

    return { voucherId: voucher.id, amount: voucher.amount, currency: voucher.currency };
  }

  /**
   * Annule un voucher avant utilisation (admin).
   */
  async cancel(
    tenantId: string,
    voucherId: string,
    reason: string,
    actor: CurrentUserPayload,
  ) {
    const voucher = await this.prisma.voucher.findFirst({ where: { id: voucherId, tenantId } });
    if (!voucher) throw new NotFoundException(`Voucher ${voucherId} introuvable`);

    await this.workflow.transition(
      voucher as unknown as Parameters<WorkflowEngine['transition']>[0],
      { action: VoucherAction.CANCEL, actor },
      {
        aggregateType: 'Voucher',
        persist: async (entity, state, p) => {
          return p.voucher.update({
            where: { id: entity.id },
            data: {
              status:          state,
              cancelledAt:     new Date(),
              cancelledById:   actor.id,
              cancelledReason: reason,
              version:         { increment: 1 },
            },
          }) as Promise<typeof entity>;
        },
      },
    );
  }

  /**
   * Marque comme expirés tous les vouchers ISSUED dont validityEnd est dépassée.
   * Appelé par le scheduler périodiquement.
   */
  async expireOldVouchers(tenantId: string): Promise<number> {
    const now = new Date();
    const candidates = await this.prisma.voucher.findMany({
      where: {
        tenantId,
        status: VoucherState.ISSUED,
        validityEnd: { lt: now },
      },
      take: 500,
    });
    let expired = 0;
    for (const voucher of candidates) {
      try {
        await this.workflow.transition(
          voucher as unknown as Parameters<WorkflowEngine['transition']>[0],
          { action: VoucherAction.EXPIRE, actor: SYSTEM_ACTOR },
          {
            aggregateType: 'Voucher',
            persist: async (entity, state, p) => {
              return p.voucher.update({
                where: { id: entity.id },
                data:  { status: state, version: { increment: 1 } },
              }) as Promise<typeof entity>;
            },
          },
        );
        expired++;
      } catch (err) {
        this.logger.warn(`Expire failed for voucher=${voucher.id}: ${(err as Error).message}`);
      }
    }
    return expired;
  }

  /** Liste les vouchers d'un customer (page "Mes bons" portail voyageur). */
  async findByCustomer(tenantId: string, customerId: string) {
    return this.prisma.voucher.findMany({
      where:   { tenantId, customerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Liste vouchers tenant (admin). */
  async findAll(tenantId: string, status?: string) {
    return this.prisma.voucher.findMany({
      where:   { tenantId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take:    200,
    });
  }

  /**
   * Génère un code unique format `<TNT>-XXXX-YYYY` (8 chars hex divisés en groupes
   * de 4). Retry jusqu'à 5 fois en cas de collision (extrêmement improbable).
   */
  private async generateUniqueCode(tenantId: string): Promise<string> {
    const tenantSlug = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { slug: true },
    });
    const prefix = (tenantSlug?.slug ?? 'TNT').toUpperCase().slice(0, 4).replace(/[^A-Z]/g, '');
    for (let attempt = 0; attempt < 5; attempt++) {
      const hex  = randomBytes(4).toString('hex').toUpperCase();
      const code = `${prefix}-${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
      const exists = await this.prisma.voucher.findUnique({ where: { code } });
      if (!exists) return code;
    }
    throw new Error('Impossible de générer un code voucher unique après 5 tentatives');
  }
}
