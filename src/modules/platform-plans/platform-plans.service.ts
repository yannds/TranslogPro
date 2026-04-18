/**
 * PlatformPlansService — catalogue des plans SaaS.
 *
 * Source de vérité : table `Plan` + `PlanModule` (Prisma). Les plans et leur
 * contenu (modules, prix, cycle, limites, SLA) sont entièrement DB-driven :
 * aucun plan n'est hardcodé dans le code. L'interface de la plateforme permet
 * aux SUPER_ADMIN d'en créer / éditer / retirer à volonté.
 *
 * Opérations publiques (catalogue tenant) :
 *   listCatalog() → plans visibles et actifs, triés
 *
 * Opérations plateforme (CRUD) :
 *   list()
 *   findById(id)
 *   create(dto)
 *   update(id, dto)
 *   remove(id)       → soft : désactive si déjà référencé, delete sinon
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { CreatePlanDto, UpdatePlanDto } from './dto/plan.dto';

@Injectable()
export class PlatformPlansService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Catalogue public (tenants) ────────────────────────────────────────────

  async listCatalog() {
    return this.prisma.plan.findMany({
      where:   { isActive: true, isPublic: true },
      orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }],
      include: { modules: true },
    });
  }

  // ─── CRUD plateforme ───────────────────────────────────────────────────────

  async list() {
    return this.prisma.plan.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        modules: true,
        _count:  { select: { tenants: true, subscriptions: true } },
      },
    });
  }

  async findById(id: string) {
    const plan = await this.prisma.plan.findUnique({
      where:   { id },
      include: { modules: true },
    });
    if (!plan) throw new NotFoundException(`Plan ${id} introuvable`);
    return plan;
  }

  async create(dto: CreatePlanDto) {
    const exists = await this.prisma.plan.findUnique({ where: { slug: dto.slug } });
    if (exists) throw new ConflictException(`Plan slug "${dto.slug}" déjà utilisé`);

    return this.prisma.plan.create({
      data: {
        slug:         dto.slug,
        name:         dto.name,
        description:  dto.description ?? null,
        price:        dto.price,
        currency:     dto.currency,
        billingCycle: dto.billingCycle,
        trialDays:    dto.trialDays ?? 0,
        limits:       (dto.limits ?? {}) as object,
        sla:          (dto.sla ?? {}) as object,
        sortOrder:    dto.sortOrder ?? 0,
        isPublic:     dto.isPublic ?? true,
        isActive:     dto.isActive ?? true,
        modules: dto.moduleKeys?.length
          ? { create: dto.moduleKeys.map(m => ({ moduleKey: m })) }
          : undefined,
      },
      include: { modules: true },
    });
  }

  async update(id: string, dto: UpdatePlanDto) {
    const existing = await this.prisma.plan.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Plan ${id} introuvable`);

    // Si moduleKeys fourni : on remplace l'ensemble des modules du plan.
    const moduleUpdate = dto.moduleKeys !== undefined
      ? {
          deleteMany: {},
          create:     dto.moduleKeys.map(m => ({ moduleKey: m })),
        }
      : undefined;

    return this.prisma.plan.update({
      where: { id },
      data: {
        ...(dto.name         !== undefined && { name: dto.name }),
        ...(dto.description  !== undefined && { description: dto.description }),
        ...(dto.price        !== undefined && { price: dto.price }),
        ...(dto.currency     !== undefined && { currency: dto.currency }),
        ...(dto.billingCycle !== undefined && { billingCycle: dto.billingCycle }),
        ...(dto.trialDays    !== undefined && { trialDays: dto.trialDays }),
        ...(dto.limits       !== undefined && { limits: dto.limits as object }),
        ...(dto.sla          !== undefined && { sla: dto.sla as object }),
        ...(dto.sortOrder    !== undefined && { sortOrder: dto.sortOrder }),
        ...(dto.isPublic     !== undefined && { isPublic: dto.isPublic }),
        ...(dto.isActive     !== undefined && { isActive: dto.isActive }),
        ...(moduleUpdate     !== undefined && { modules: moduleUpdate }),
      },
      include: { modules: true },
    });
  }

  /**
   * Suppression "sécurisée" d'un plan :
   * - Si aucune souscription (active ou passée) ni tenant n'y fait référence → DELETE.
   * - Sinon → désactivation (isActive=false, isPublic=false) pour préserver
   *   l'historique de facturation et l'intégrité des souscriptions existantes.
   */
  async remove(id: string) {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      include: { _count: { select: { tenants: true, subscriptions: true } } },
    });
    if (!plan) throw new NotFoundException(`Plan ${id} introuvable`);

    if (plan._count.tenants > 0 || plan._count.subscriptions > 0) {
      // Soft : on désactive
      return this.prisma.plan.update({
        where: { id },
        data:  { isActive: false, isPublic: false },
      });
    }

    // Hard delete (cascade sur PlanModule via onDelete: Cascade)
    await this.prisma.plan.delete({ where: { id } });
    return { id, deleted: true };
  }

  // ─── Modules associés (ajout/retrait unitaire) ─────────────────────────────

  async attachModule(planId: string, moduleKey: string) {
    await this.findById(planId);
    if (!moduleKey || !/^[A-Z0-9_]+$/.test(moduleKey)) {
      throw new BadRequestException('moduleKey doit être en UPPER_SNAKE_CASE');
    }
    try {
      await this.prisma.planModule.create({ data: { planId, moduleKey } });
    } catch {
      // unique (planId, moduleKey) — idempotent
    }
    return this.findById(planId);
  }

  async detachModule(planId: string, moduleKey: string) {
    await this.findById(planId);
    await this.prisma.planModule.deleteMany({ where: { planId, moduleKey } });
    return this.findById(planId);
  }
}
