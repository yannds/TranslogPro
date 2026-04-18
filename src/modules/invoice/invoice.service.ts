/**
 * InvoiceService — CRUD factures + génération numéro séquentiel.
 *
 * Isolation multi-tenant : tenantId en condition racine.
 */
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { CreateInvoiceDto, UpdateInvoiceDto } from './dto/create-invoice.dto';

@Injectable()
export class InvoiceService {
  constructor(private readonly prisma: PrismaService) {}

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

  async update(tenantId: string, id: string, dto: UpdateInvoiceDto) {
    const invoice = await this.findOne(tenantId, id);

    const data: Record<string, unknown> = { ...dto };

    if (dto.status === 'ISSUED' && invoice.status === 'DRAFT') {
      data.issuedAt = new Date();
    }
    if (dto.status === 'PAID' && (invoice.status === 'ISSUED' || invoice.status === 'DRAFT')) {
      data.paidAt = new Date();
    }
    if (dto.status === 'CANCELLED' && invoice.status === 'PAID') {
      throw new BadRequestException('Impossible d\'annuler une facture déjà payée');
    }

    // Défense en profondeur : tenantId dans le where final pour éliminer
    // le TOCTOU entre findOne() et update() (un id existant dans tenantA
    // pourrait théoriquement passer un race interleaving cross-tenant).
    const result = await this.prisma.invoice.updateMany({ where: { id, tenantId }, data });
    if (result.count === 0) throw new NotFoundException(`Facture ${id} introuvable`);
    return this.findOne(tenantId, id);
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
