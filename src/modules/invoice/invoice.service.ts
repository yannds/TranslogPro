/**
 * InvoiceService — CRUD factures + génération numéro séquentiel.
 *
 * Isolation multi-tenant : tenantId en condition racine.
 * Transitions d'état (DRAFT → ISSUED → PAID / CANCELLED) : blueprint-driven via
 * WorkflowEngine (ADR-15/16, migration 2026-04-19). Un update() qui ne touche
 * pas le status reste un update direct (champs libres : notes, dueDate, etc.).
 */
import { Injectable, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { CreateInvoiceDto, UpdateInvoiceDto } from './dto/create-invoice.dto';
import { WorkflowEngine } from '../../core/workflow/workflow.engine';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { IEventBus, EVENT_BUS, DomainEvent } from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { EventTypes } from '../../common/types/domain-event.type';
import { v4 as uuidv4 } from 'uuid';

/** Acteur système synthétique (transitions déclenchées par webhook paiement, cron, etc.) */
const SYSTEM_ACTOR: CurrentUserPayload = {
  id:       'SYSTEM',
  tenantId: 'SYSTEM',
  roleId:   'SYSTEM',
} as CurrentUserPayload;

@Injectable()
export class InvoiceService {
  constructor(
    private readonly prisma:   PrismaService,
    private readonly workflow: WorkflowEngine,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  /**
   * Construit le DomainEvent à émettre selon l'état cible d'une transition.
   * - DRAFT  → ISSUED    : invoice.issued      (le client peut maintenant payer)
   * - ISSUED → PAID      : invoice.paid        (paiement reçu)
   * - DRAFT  → PAID      : invoice.paid uniquement (fast-track caisse — on ne
   *                        notifie pas "issued" pour éviter 2 mails au client)
   * - ISSUED → CANCELLED : invoice.cancelled   (annulation après émission)
   * - DRAFT  → CANCELLED : null (le client n'a jamais vu cette facture)
   */
  private invoiceEventTypeFor(fromState: string, toState: string): string | null {
    if (toState === 'ISSUED'    && fromState === 'DRAFT')                              return EventTypes.INVOICE_ISSUED;
    if (toState === 'PAID')                                                            return EventTypes.INVOICE_PAID;
    if (toState === 'CANCELLED' && fromState === 'ISSUED')                             return EventTypes.INVOICE_CANCELLED;
    return null;
  }

  async findAll(tenantId: string, status?: string) {
    return this.prisma.invoice.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const invoice = await this.prisma.invoice.findFirst({ where: { id, tenantId } });
    if (!invoice) throw new NotFoundException(`Facture ${id} introuvable`);
    return invoice;
  }

  async create(tenantId: string, dto: CreateInvoiceDto) {
    const invoiceNumber = await this.generateInvoiceNumber(tenantId);
    const taxRate   = dto.taxRate ?? 0;
    const taxAmount = dto.subtotal * taxRate;
    const totalAmount = dto.subtotal + taxAmount;

    return this.prisma.invoice.create({
      data: {
        tenantId,
        invoiceNumber,
        customerName:  dto.customerName,
        customerEmail: dto.customerEmail,
        customerPhone: dto.customerPhone,
        customerId:    dto.customerId,
        subtotal:      dto.subtotal,
        taxRate,
        taxAmount,
        totalAmount,
        entityType:    dto.entityType,
        entityId:      dto.entityId,
        dueDate:       dto.dueDate ? new Date(dto.dueDate) : undefined,
        paymentMethod: dto.paymentMethod,
        lineItems:     dto.lineItems ?? [],
        notes:         dto.notes,
        status:        'DRAFT',
      },
    });
  }

  /**
   * Mise à jour d'une facture.
   * - Si `dto.status` est fourni ET diffère de l'état courant → transition via
   *   WorkflowEngine (DRAFT→ISSUED→PAID / CANCELLED). L'engine applique le
   *   blueprint du tenant + audit.
   * - Les autres champs (notes, dueDate, lineItems…) sont patchés directement.
   */
  async update(tenantId: string, id: string, dto: UpdateInvoiceDto, actor?: CurrentUserPayload) {
    const invoice = await this.findOne(tenantId, id);

    const { status: targetStatus, ...otherFields } = dto;
    const hasOtherFields   = Object.keys(otherFields).length > 0;
    const hasTransition    = targetStatus && targetStatus !== invoice.status;

    // Cas 1 : transition demandée → champs non-status fusionnés ATOMIQUEMENT
    // dans le persist callback. Si la transition échoue (permission, guard),
    // les champs ne sont pas écrits non plus → tout ou rien.
    if (hasTransition) {
      const action = this.resolveInvoiceAction(invoice.status, targetStatus);
      if (!action) {
        throw new BadRequestException(
          `Transition interdite : ${invoice.status} → ${targetStatus}`,
        );
      }
      await this.workflow.transition(
        invoice as Parameters<typeof this.workflow.transition>[0],
        { action, actor: actor ?? SYSTEM_ACTOR },
        {
          aggregateType: 'Invoice',
          persist: async (entity, state, p) => {
            const data: Record<string, unknown> = {
              ...(otherFields as Record<string, unknown>),
              status:  state,
              version: { increment: 1 },
            };
            if (state === 'ISSUED')    data.issuedAt = new Date();
            if (state === 'PAID')      data.paidAt   = new Date();
            if (state === 'CANCELLED') data.cancelledAt = new Date();
            const updated = (await p.invoice.update({ where: { id: entity.id }, data })) as typeof entity;

            // Émission Outbox dans la même tx que la transition d'état (atomicité).
            const eventType = this.invoiceEventTypeFor(invoice.status, state);
            if (eventType) {
              const event: DomainEvent = {
                id:            uuidv4(),
                type:          eventType,
                tenantId,
                aggregateId:   updated.id,
                aggregateType: 'Invoice',
                payload: {
                  invoiceId:     updated.id,
                  invoiceNumber: invoice.invoiceNumber,
                  totalAmount:   invoice.totalAmount,
                  currency:      invoice.currency,
                  dueDate:       invoice.dueDate?.toISOString() ?? null,
                  paidAt:        state === 'PAID' ? new Date().toISOString() : null,
                  paymentMethod: invoice.paymentMethod ?? null,
                },
                occurredAt: new Date(),
              };
              await this.eventBus.publish(event, p);
            }
            return updated;
          },
        },
      );
      return this.findOne(tenantId, id);
    }

    // Cas 2 : pas de transition → update simple des champs non-status.
    if (hasOtherFields) {
      const result = await this.prisma.invoice.updateMany({
        where: { id, tenantId },
        data:  otherFields as Record<string, unknown>,
      });
      if (result.count === 0) throw new NotFoundException(`Facture ${id} introuvable`);
    }

    return this.findOne(tenantId, id);
  }

  /**
   * Mappe (fromState, targetState) → action blueprint (snake_case, aligné
   * DEFAULT_WORKFLOW_CONFIGS Invoice). null si la cible n'est pas atteignable.
   */
  private resolveInvoiceAction(from: string, target: string): string | null {
    if (from === 'DRAFT'  && target === 'ISSUED')    return 'issue';
    if (from === 'ISSUED' && target === 'PAID')      return 'mark_paid';
    if (from === 'DRAFT'  && target === 'PAID')      return 'mark_paid'; // fast-track facture payée à l'émission
    if (from === 'DRAFT'  && target === 'CANCELLED') return 'cancel';
    if (from === 'ISSUED' && target === 'CANCELLED') return 'cancel';
    return null;
  }

  /**
   * Reçu de caisse — crée une Invoice directement en PAID pour un batch de
   * tickets confirmé présentiel (caisse ouverte). Path "fast-track" :
   *   1. insert status=DRAFT
   *   2. transition DRAFT → PAID via WorkflowEngine (action `mark_paid`)
   * Ceci garantit l'audit trail workflow tout en produisant un document
   * unique par vente. Appelé depuis ticketing.confirmBatch après enregistrement
   * des Transaction caisse.
   *
   * Idempotence : entityId=batchKey unique par tenant → si l'appel rejoue
   * (retry, double-clic caissier), on renvoie l'Invoice existante sans créer.
   */
  async createPaidReceiptFromTickets(
    tenantId: string,
    params: {
      batchKey:      string;       // clé idempotente (ex: `batch:<sorted-ticket-ids>`)
      customerName:  string;
      customerPhone?: string;
      customerEmail?: string;
      customerId?:    string;
      tickets: Array<{
        id:            string;
        passengerName: string;
        pricePaid:     number;
        seatNumber?:   string | null;
        routeName?:    string | null;
      }>;
      paymentMethod: string;       // CASH | MOBILE_MONEY | CARD | …
      paymentRef?:   string;       // proofCode ou externalRef
      currency:      string;
    },
    actor: CurrentUserPayload,
  ) {
    // Idempotence : si on rejoue, renvoyer le reçu existant.
    const existing = await this.prisma.invoice.findFirst({
      where:  { tenantId, entityType: 'TICKET_BATCH', entityId: params.batchKey },
    });
    if (existing) return existing;

    const subtotal    = params.tickets.reduce((s, t) => s + (t.pricePaid ?? 0), 0);
    const invoiceNumber = await this.generateInvoiceNumber(tenantId);

    const draft = await this.prisma.invoice.create({
      data: {
        tenantId,
        invoiceNumber,
        customerName:  params.customerName,
        customerPhone: params.customerPhone,
        customerEmail: params.customerEmail,
        customerId:    params.customerId,
        subtotal,
        taxRate:       0,       // taxes déjà incluses côté ticket.pricePaid
        taxAmount:     0,
        totalAmount:   subtotal,
        currency:      params.currency,
        entityType:    'TICKET_BATCH',
        entityId:      params.batchKey,
        paymentMethod: params.paymentMethod,
        paymentRef:    params.paymentRef,
        lineItems: params.tickets.map((t) => ({
          description: [t.passengerName, t.routeName, t.seatNumber ? `Siège ${t.seatNumber}` : null]
            .filter(Boolean).join(' — '),
          quantity:  1,
          unitPrice: t.pricePaid,
          total:     t.pricePaid,
          ticketId:  t.id,
        })),
        status: 'DRAFT',
      },
    });

    // Transition DRAFT → PAID (fast-track) via WorkflowEngine → paidAt + audit.
    await this.workflow.transition(
      draft as Parameters<typeof this.workflow.transition>[0],
      { action: 'mark_paid', actor },
      {
        aggregateType: 'Invoice',
        persist: async (entity, state, p) => {
          const updated = (await p.invoice.update({
            where: { id: entity.id },
            data:  { status: state, paidAt: new Date(), version: { increment: 1 } },
          })) as typeof entity;

          // Fast-track caisse → uniquement invoice.paid (pas issued — le client
          // a réglé immédiatement, un seul mail de reçu suffit).
          const event: DomainEvent = {
            id:            uuidv4(),
            type:          EventTypes.INVOICE_PAID,
            tenantId,
            aggregateId:   updated.id,
            aggregateType: 'Invoice',
            payload: {
              invoiceId:     updated.id,
              invoiceNumber: draft.invoiceNumber,
              totalAmount:   draft.totalAmount,
              currency:      draft.currency,
              dueDate:       null,
              paidAt:        new Date().toISOString(),
              paymentMethod: params.paymentMethod,
            },
            occurredAt: new Date(),
          };
          await this.eventBus.publish(event, p);
          return updated;
        },
      },
    );

    return this.findOne(tenantId, draft.id);
  }

  async remove(tenantId: string, id: string) {
    const invoice = await this.findOne(tenantId, id);
    if (invoice.status !== 'DRAFT') {
      throw new BadRequestException('Seules les factures en brouillon peuvent être supprimées');
    }
    const result = await this.prisma.invoice.deleteMany({ where: { id, tenantId } });
    if (result.count === 0) throw new NotFoundException(`Facture ${id} introuvable`);
    return { id, deleted: true };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private async generateInvoiceNumber(tenantId: string): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.invoice.count({
      where: {
        tenantId,
        createdAt: {
          gte: new Date(`${year}-01-01`),
          lt:  new Date(`${year + 1}-01-01`),
        },
      },
    });
    return `INV-${year}-${String(count + 1).padStart(5, '0')}`;
  }
}
