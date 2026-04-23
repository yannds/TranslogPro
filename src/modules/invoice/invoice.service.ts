/**
 * InvoiceService — CRUD factures + génération numéro séquentiel.
 *
 * Isolation multi-tenant : tenantId en condition racine.
 * Transitions d'état (DRAFT → ISSUED → PAID / CANCELLED) : blueprint-driven via
 * WorkflowEngine (ADR-15/16, migration 2026-04-19). Un update() qui ne touche
 * pas le status reste un update direct (champs libres : notes, dueDate, etc.).
 */
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { CreateInvoiceDto, UpdateInvoiceDto } from './dto/create-invoice.dto';
import { WorkflowEngine } from '../../core/workflow/workflow.engine';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';

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
  ) {}

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

    // 1) Patch des champs non-status (si présents) — hors workflow.
    if (Object.keys(otherFields).length > 0) {
      const result = await this.prisma.invoice.updateMany({
        where: { id, tenantId },
        data:  otherFields as Record<string, unknown>,
      });
      if (result.count === 0) throw new NotFoundException(`Facture ${id} introuvable`);
    }

    // 2) Transition d'état si demandée et différente de l'état courant.
    if (targetStatus && targetStatus !== invoice.status) {
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
            const data: Record<string, unknown> = { status: state, version: { increment: 1 } };
            if (state === 'ISSUED')    data.issuedAt = new Date();
            if (state === 'PAID')      data.paidAt   = new Date();
            if (state === 'CANCELLED') data.cancelledAt = new Date();
            return p.invoice.update({ where: { id: entity.id }, data }) as Promise<typeof entity>;
          },
        },
      );
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
          return p.invoice.update({
            where: { id: entity.id },
            data:  { status: state, paidAt: new Date(), version: { increment: 1 } },
          }) as Promise<typeof entity>;
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
