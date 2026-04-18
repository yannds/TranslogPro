/**
 * PlatformBillingService — souscriptions et factures plateforme → tenants.
 *
 * Source de vérité :
 *   - PlatformSubscription : 1 par tenant (unique). Reflet du plan courant,
 *     son statut (TRIAL | ACTIVE | PAST_DUE | SUSPENDED | CANCELLED) et la
 *     période facturée en cours.
 *   - PlatformInvoice : historique immuable une fois émise (status ISSUED→PAID).
 *
 * Règles métier :
 *   - createSubscription est idempotent par tenantId (upsert).
 *   - changePlan met à jour `planId` + période en cours. La facturation
 *     proratisée est un sujet métier à part ; ici on logge le changement et
 *     le prochain cycle facturera le nouveau plan.
 *   - markPaid : transition DRAFT/ISSUED → PAID (trace paidAt).
 *   - Cron mensuel : génère une facture par subscription ACTIVE dont
 *     currentPeriodEnd ≤ now (ou nulle) pour le cycle suivant.
 *
 * Aucun prix/plan hardcodé : tout vient de la table Plan.
 */

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { PLATFORM_TENANT_ID } from '../../../prisma/seeds/iam.seed';
import {
  ChangeSubscriptionPlanDto,
  CreateInvoiceDto,
  CreateSubscriptionDto,
  MarkInvoicePaidDto,
  UpdateSubscriptionStatusDto,
} from './dto/billing.dto';

@Injectable()
export class PlatformBillingService {
  private readonly logger = new Logger(PlatformBillingService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Subscriptions ──────────────────────────────────────────────────────

  async listSubscriptions() {
    return this.prisma.platformSubscription.findMany({
      include: {
        tenant: { select: { id: true, name: true, slug: true, country: true, isActive: true, provisionStatus: true } },
        plan:   true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getSubscriptionByTenant(tenantId: string) {
    return this.prisma.platformSubscription.findUnique({
      where:   { tenantId },
      include: { plan: { include: { modules: true } }, invoices: { orderBy: { createdAt: 'desc' } } },
    });
  }

  async createSubscription(dto: CreateSubscriptionDto) {
    if (dto.tenantId === PLATFORM_TENANT_ID) {
      throw new BadRequestException('Le tenant plateforme ne peut pas avoir de souscription');
    }
    const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } });
    if (!plan) throw new NotFoundException(`Plan ${dto.planId} introuvable`);
    if (!plan.isActive) throw new BadRequestException(`Plan ${plan.slug} inactif`);

    const now = new Date();
    const trialEndsAt = dto.trialEndsAt
      ? new Date(dto.trialEndsAt)
      : plan.trialDays > 0
        ? new Date(now.getTime() + plan.trialDays * 86_400_000)
        : null;
    const status = dto.status ?? (trialEndsAt && trialEndsAt > now ? 'TRIAL' : 'ACTIVE');
    const periodStart = dto.currentPeriodStart ? new Date(dto.currentPeriodStart) : now;
    const periodEnd   = dto.currentPeriodEnd
      ? new Date(dto.currentPeriodEnd)
      : this.computePeriodEnd(periodStart, plan.billingCycle);

    const sub = await this.prisma.platformSubscription.upsert({
      where: { tenantId: dto.tenantId },
      update: {
        planId:             plan.id,
        status,
        trialEndsAt,
        currentPeriodStart: periodStart,
        currentPeriodEnd:   periodEnd,
        renewsAt:           periodEnd,
        cancelledAt:        null,
        cancelReason:       null,
      },
      create: {
        tenantId:           dto.tenantId,
        planId:             plan.id,
        status,
        trialEndsAt,
        currentPeriodStart: periodStart,
        currentPeriodEnd:   periodEnd,
        renewsAt:           periodEnd,
      },
    });

    // Reflète planId sur le tenant (pour lookup UI côté frontend)
    await this.prisma.tenant.update({
      where: { id: dto.tenantId },
      data:  { planId: plan.id, activatedAt: status === 'ACTIVE' ? now : undefined },
    });

    this.logger.log(`Subscription upsert tenant=${dto.tenantId} plan=${plan.slug} status=${status}`);
    return sub;
  }

  async changePlan(subscriptionId: string, dto: ChangeSubscriptionPlanDto) {
    const sub = await this.prisma.platformSubscription.findUnique({ where: { id: subscriptionId } });
    if (!sub) throw new NotFoundException(`Subscription ${subscriptionId} introuvable`);

    const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } });
    if (!plan) throw new NotFoundException(`Plan ${dto.planId} introuvable`);
    if (!plan.isActive) throw new BadRequestException(`Plan ${plan.slug} inactif`);

    const now = new Date();
    const periodEnd = this.computePeriodEnd(now, plan.billingCycle);

    const updated = await this.prisma.platformSubscription.update({
      where: { id: subscriptionId },
      data: {
        planId:             plan.id,
        currentPeriodStart: now,
        currentPeriodEnd:   periodEnd,
        renewsAt:           periodEnd,
      },
      include: { plan: true },
    });
    await this.prisma.tenant.update({ where: { id: sub.tenantId }, data: { planId: plan.id } });
    this.logger.log(`Plan change tenant=${sub.tenantId} → ${plan.slug}`);
    return updated;
  }

  async updateStatus(subscriptionId: string, dto: UpdateSubscriptionStatusDto) {
    const sub = await this.prisma.platformSubscription.findUnique({ where: { id: subscriptionId } });
    if (!sub) throw new NotFoundException(`Subscription ${subscriptionId} introuvable`);

    const data: Record<string, unknown> = { status: dto.status };
    if (dto.status === 'CANCELLED') {
      data.cancelledAt  = new Date();
      data.cancelReason = dto.cancelReason ?? null;
    }
    if (dto.status === 'SUSPENDED') {
      await this.prisma.tenant.update({
        where: { id: sub.tenantId },
        data:  { suspendedAt: new Date() },
      });
    }
    return this.prisma.platformSubscription.update({ where: { id: subscriptionId }, data });
  }

  // ─── Invoices ──────────────────────────────────────────────────────────

  async listInvoices(tenantId?: string, status?: string) {
    return this.prisma.platformInvoice.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        ...(status   ? { status }   : {}),
      },
      include: { tenant: { select: { id: true, name: true, slug: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findInvoice(id: string) {
    const inv = await this.prisma.platformInvoice.findUnique({
      where:   { id },
      include: {
        tenant:       { select: { id: true, name: true, slug: true, email: true, taxId: true } },
        subscription: { include: { plan: true } },
      },
    });
    if (!inv) throw new NotFoundException(`Facture ${id} introuvable`);
    return inv;
  }

  async createInvoice(dto: CreateInvoiceDto) {
    const sub = await this.prisma.platformSubscription.findUnique({
      where:   { id: dto.subscriptionId },
      include: { plan: true },
    });
    if (!sub) throw new NotFoundException(`Subscription ${dto.subscriptionId} introuvable`);

    const taxRate   = dto.taxRate ?? 0;
    const taxAmount = dto.subtotal * taxRate;
    const total     = dto.subtotal + taxAmount;

    const invoiceNumber = await this.nextInvoiceNumber();

    return this.prisma.platformInvoice.create({
      data: {
        subscriptionId: sub.id,
        tenantId:       sub.tenantId,
        invoiceNumber,
        periodStart:    new Date(dto.periodStart),
        periodEnd:      new Date(dto.periodEnd),
        subtotal:       dto.subtotal,
        taxRate,
        taxAmount,
        totalAmount:    total,
        currency:       sub.plan.currency,
        status:         'DRAFT',
        dueAt:          dto.dueAt ? new Date(dto.dueAt) : null,
        lineItems:      (dto.lineItems ?? []) as object,
        notes:          dto.notes ?? null,
      },
    });
  }

  async issue(id: string) {
    const inv = await this.findInvoice(id);
    if (inv.status !== 'DRAFT') {
      throw new BadRequestException(`Facture déjà ${inv.status}, ne peut plus être émise`);
    }
    return this.prisma.platformInvoice.update({
      where: { id },
      data:  { status: 'ISSUED', issuedAt: new Date() },
    });
  }

  async markPaid(id: string, dto: MarkInvoicePaidDto) {
    const inv = await this.findInvoice(id);
    if (inv.status === 'PAID') return inv;
    if (inv.status === 'VOID') {
      throw new BadRequestException('Facture annulée, ne peut plus être marquée payée');
    }
    return this.prisma.platformInvoice.update({
      where: { id },
      data: {
        status:        'PAID',
        paidAt:        new Date(),
        paymentMethod: dto.paymentMethod ?? null,
        paymentRef:    dto.paymentRef ?? null,
      },
    });
  }

  async voidInvoice(id: string) {
    const inv = await this.findInvoice(id);
    if (inv.status === 'PAID') {
      throw new BadRequestException('Facture payée, ne peut plus être annulée');
    }
    return this.prisma.platformInvoice.update({ where: { id }, data: { status: 'VOID' } });
  }

  // ─── Cron : émet les factures du cycle à échéance ───────────────────────
  // Tous les jours à 03:00 UTC : pour chaque subscription ACTIVE ou TRIAL dont
  // currentPeriodEnd est atteinte, on produit une facture DRAFT pour le
  // cycle suivant et on avance la période.
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runRenewalBatch(): Promise<void> {
    const now  = new Date();
    const subs = await this.prisma.platformSubscription.findMany({
      where: {
        status: { in: ['ACTIVE', 'TRIAL'] },
        currentPeriodEnd: { lte: now },
      },
      include: { plan: true },
    });
    if (subs.length === 0) return;
    this.logger.log(`[Billing cron] ${subs.length} subscription(s) à renouveler`);

    for (const sub of subs) {
      try {
        const periodStart = sub.currentPeriodEnd ?? now;
        const periodEnd   = this.computePeriodEnd(periodStart, sub.plan.billingCycle);
        const invoiceNumber = await this.nextInvoiceNumber();

        await this.prisma.$transaction([
          this.prisma.platformInvoice.create({
            data: {
              subscriptionId: sub.id,
              tenantId:       sub.tenantId,
              invoiceNumber,
              periodStart,
              periodEnd,
              subtotal:       sub.plan.price,
              taxRate:        0,
              taxAmount:      0,
              totalAmount:    sub.plan.price,
              currency:       sub.plan.currency,
              status:         'DRAFT',
              dueAt:          new Date(periodEnd.getTime() + 7 * 86_400_000),
              lineItems:      [{ description: `${sub.plan.name} — ${sub.plan.billingCycle}`, quantity: 1, unitPrice: sub.plan.price, total: sub.plan.price }] as object,
            },
          }),
          this.prisma.platformSubscription.update({
            where: { id: sub.id },
            data: {
              currentPeriodStart: periodStart,
              currentPeriodEnd:   periodEnd,
              renewsAt:           periodEnd,
              status:             sub.status === 'TRIAL' ? 'ACTIVE' : sub.status,
            },
          }),
        ]);
      } catch (e) {
        this.logger.error(`[Billing cron] échec renouvellement subscription=${sub.id}`, e as Error);
      }
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private computePeriodEnd(start: Date, cycle: string): Date {
    const d = new Date(start);
    switch (cycle) {
      case 'MONTHLY':  d.setMonth(d.getMonth() + 1); return d;
      case 'YEARLY':   d.setFullYear(d.getFullYear() + 1); return d;
      case 'ONE_SHOT': return d;
      case 'CUSTOM':
      default: {
        // Par défaut +30j. Les cycles CUSTOM devraient être gérés par config
        // spécifique côté plan ; on ne hardcode pas de règle métier ici.
        d.setDate(d.getDate() + 30);
        return d;
      }
    }
  }

  /**
   * Numéro séquentiel de facture plateforme.
   * Format : PF-YYYY-NNNNNN (année + 6 chiffres). Séquence calculée par
   * comptage — acceptable tant que le volume reste < 1M/an. En production
   * à grande échelle, remplacer par une séquence Postgres.
   */
  private async nextInvoiceNumber(): Promise<string> {
    const year  = new Date().getFullYear();
    const count = await this.prisma.platformInvoice.count({
      where: { invoiceNumber: { startsWith: `PF-${year}-` } },
    });
    return `PF-${year}-${String(count + 1).padStart(6, '0')}`;
  }
}
