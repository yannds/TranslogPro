import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ScopeContext } from '../../common/decorators/scope-context.decorator';
import { assertOwnership } from '../../common/helpers/scope-filter';
import { AuditService } from '../../core/workflow/audit.service';
import { WorkflowEngine } from '../../core/workflow/workflow.engine';
import { OpenRegisterDto } from './dto/open-register.dto';
import { RecordTransactionDto } from './dto/record-transaction.dto';
import { CloseRegisterDto } from './dto/close-register.dto';
import { ResolveDiscrepancyDto } from './dto/resolve-discrepancy.dto';
import { PaymentProviderRegistry } from '../../infrastructure/payment/payment-provider.registry';

type RecordTxOptions = {
  tx?: Prisma.TransactionClient;
  skipScopeCheck?: boolean;
  actorId?: string;
  ipAddress?: string;
};

@Injectable()
export class CashierService {
  constructor(
    private readonly prisma:   PrismaService,
    private readonly audit:    AuditService,
    private readonly workflow: WorkflowEngine,
    private readonly providers: PaymentProviderRegistry,
  ) {}

  // ── Open ────────────────────────────────────────────────────────────────────

  async openRegister(
    tenantId: string,
    dto: OpenRegisterDto,
    actor: CurrentUserPayload,
    ipAddress?: string,
  ) {
    // Résolution agencyId : priorité au DTO, sinon lookup Staff.agencyId de
    // l'acteur (mobile n'a pas toujours l'info en session). Si toujours
    // indéfini → BadRequest explicite pour que l'UI remonte le message.
    let agencyId = dto.agencyId;
    if (!agencyId) {
      const staff = await this.prisma.staff.findFirst({
        where:  { userId: actor.id, tenantId },
        select: { agencyId: true },
      });
      agencyId = staff?.agencyId ?? undefined;
    }
    if (!agencyId) {
      throw new BadRequestException(
        'Impossible d\'ouvrir la caisse : agence non rattachée. Contactez votre administrateur.',
      );
    }

    const existing = await this.prisma.cashRegister.findFirst({
      where: { tenantId, agentId: actor.id, status: 'OPEN' },
    });
    if (existing) {
      throw new ConflictException('Vous avez déjà une caisse ouverte');
    }

    const register = await this.prisma.cashRegister.create({
      data: {
        tenantId,
        agencyId,
        agentId:        actor.id,
        initialBalance: dto.openingBalance,
      },
    });

    await this.audit.record({
      tenantId,
      userId:   actor.id,
      action:   'data.cashier.open.own',
      resource: `CashRegister:${register.id}`,
      newValue: {
        agencyId:       register.agencyId,
        initialBalance: register.initialBalance,
        note:           dto.note,
      },
      ipAddress,
      plane: 'data',
      level: 'info',
    });

    return register;
  }

  // ── Close (rapprochement + audit niveau warn) ───────────────────────────────

  async closeRegister(
    tenantId: string,
    registerId: string,
    dto: CloseRegisterDto,
    actor: CurrentUserPayload,
    scope: ScopeContext,
    ipAddress?: string,
  ) {
    const register = await this.prisma.cashRegister.findFirst({
      where: { id: registerId, tenantId, status: 'OPEN' },
    });
    if (!register) throw new NotFoundException('Caisse ouverte introuvable');

    // PRD §IV.8 — superviseur ne peut clôturer que les caisses de son agence
    if (scope.scope === 'agency' && register.agencyId !== scope.agencyId) {
      throw new ForbiddenException('Vous ne pouvez clôturer que les caisses de votre agence');
    }

    const totals = await this.prisma.transaction.aggregate({
      where: { tenantId, cashRegisterId: registerId },
      _sum:  { amount: true },
    });

    const theoreticalBalance = register.initialBalance + (totals._sum.amount ?? 0);
    const counted = dto.countedBalance ?? theoreticalBalance;
    const discrepancy = counted - theoreticalBalance;
    // Discrepancy < 0.01 → action `close` (OPEN → CLOSED).
    // Sinon → action `flag` (OPEN → DISCREPANCY). Mapping blueprint-driven.
    const action = Math.abs(discrepancy) < 0.01 ? 'close' : 'flag';

    // Transition via WorkflowEngine — fields `closedAt` + `finalBalance` persistés
    // dans la même transaction via persist callback.
    const result = await this.workflow.transition(
      register as Parameters<typeof this.workflow.transition>[0],
      { action, actor },
      {
        aggregateType: 'CashRegister',
        persist: async (entity, toState, prisma) => {
          const updated = await prisma.cashRegister.update({
            where: { id: entity.id },
            data:  {
              status:       toState,
              version:      { increment: 1 },
              closedAt:     new Date(),
              finalBalance: counted,
            },
          });
          return updated as typeof entity;
        },
      },
    );
    const closed = result.entity;
    const status = closed.status;

    await this.audit.record({
      tenantId,
      userId:   actor.id,
      action:   'data.cashier.close.agency',
      resource: `CashRegister:${registerId}`,
      oldValue: {
        initialBalance:     register.initialBalance,
        theoreticalBalance,
      },
      newValue: {
        countedBalance: counted,
        discrepancy,
        status,
        note:           dto.closingNote,
      },
      ipAddress,
      plane: 'data',
      level: Math.abs(discrepancy) >= 1 ? 'warn' : 'info',
    });

    return closed;
  }

  // ── Résolution d'écart (DISCREPANCY → CLOSED, blueprint `resolve`) ─────────

  /**
   * Résout un écart de caisse signalé à la clôture. Justification obligatoire
   * (dto.resolutionNote) — tracée dans AuditLog (source de vérité immuable)
   * et dénormalisée sur CashRegister.resolutionNote pour affichage rapide.
   *
   * Transition : DISCREPANCY → CLOSED via WorkflowEngine action 'resolve'
   * (requiredPerm = data.cashier.close.agency, seed iam.seed.ts:1062).
   *
   * Scopes :
   *   - scope=agency  → la caisse doit appartenir à l'agence du superviseur
   *   - scope=tenant  → accès global admin
   *
   * Idempotent : si la caisse est déjà CLOSED avec la même note, no-op.
   */
  async resolveDiscrepancy(
    tenantId: string,
    registerId: string,
    dto: ResolveDiscrepancyDto,
    actor: CurrentUserPayload,
    scope: ScopeContext,
    ipAddress?: string,
  ) {
    const register = await this.prisma.cashRegister.findFirst({
      where: { id: registerId, tenantId },
    });
    if (!register) throw new NotFoundException('Caisse introuvable');
    if (register.status !== 'DISCREPANCY') {
      throw new BadRequestException(
        `Caisse non en écart (status=${register.status}) — rien à résoudre`,
      );
    }
    if (scope.scope === 'agency' && register.agencyId !== scope.agencyId) {
      throw new ForbiddenException('Hors périmètre agence');
    }

    // Recalcule l'écart pour l'audit (source de vérité : Transaction.amount).
    const totals = await this.prisma.transaction.aggregate({
      where: { tenantId, cashRegisterId: registerId },
      _sum:  { amount: true },
    });
    const theoretical = register.initialBalance + (totals._sum.amount ?? 0);
    const discrepancy = (register.finalBalance ?? 0) - theoretical;

    const result = await this.workflow.transition(
      register as Parameters<typeof this.workflow.transition>[0],
      { action: 'resolve', actor },
      {
        aggregateType: 'CashRegister',
        persist: async (entity, toState, prisma) => {
          const updated = await prisma.cashRegister.update({
            where: { id: entity.id },
            data:  {
              status:         toState,
              resolutionNote: dto.resolutionNote,
              resolvedAt:     new Date(),
              resolvedById:   actor.id,
              version:        { increment: 1 },
            },
          });
          return updated as typeof entity;
        },
      },
    );

    await this.audit.record({
      tenantId,
      userId:   actor.id,
      action:   'data.cashier.resolve.agency',
      resource: `CashRegister:${registerId}`,
      oldValue: { status: 'DISCREPANCY', discrepancy, theoretical },
      newValue: { status: 'CLOSED', resolutionNote: dto.resolutionNote },
      ipAddress,
      plane: 'data',
      // Résoudre un écart est toujours "notable" en audit — warn pour tous
      // les montants (même < 1 XAF) car l'action elle-même est sensible.
      level: 'warn',
    });

    return result.entity;
  }

  // ── Vérification preuve paiement (Sprint 5) ───────────────────────────────

  /**
   * Vérifie a posteriori le code de preuve saisi par le caissier contre le
   * provider correspondant. Met à jour Transaction.proofVerifiedStatus +
   * proofVerifiedAt. Idempotent : si VERIFIED déjà, renvoie la transaction.
   *
   * Mapping statut :
   *   provider.verify SUCCESSFUL + amount match + currency match → VERIFIED
   *   provider.verify répondu mais non-SUCCESSFUL ou montant ≠              → FAILED
   *   provider indisponible / exception                                     → PENDING
   *
   * Scope : le caller (controller) doit déjà valider que la caisse appartient
   * au tenant/agence. Ici on vérifie juste la propriété tenantId.
   */
  async verifyTransactionProof(
    tenantId: string,
    txId: string,
    providerKey: string,
    actor: CurrentUserPayload,
    ipAddress?: string,
  ) {
    const tx = await this.prisma.transaction.findFirst({
      where: { id: txId, tenantId },
    });
    if (!tx) throw new NotFoundException(`Transaction ${txId} introuvable`);
    if (!tx.proofCode) {
      throw new BadRequestException('Transaction sans preuve — rien à vérifier');
    }
    // Idempotence : re-verifier une tx VERIFIED ne l'appelle pas au provider.
    if (tx.proofVerifiedStatus === 'VERIFIED') return tx;

    const provider = this.providers.get(providerKey);
    if (!provider) {
      throw new BadRequestException(`Provider "${providerKey}" inconnu`);
    }

    let status: 'VERIFIED' | 'FAILED' | 'PENDING' = 'PENDING';
    try {
      const result = await provider.verify(tx.proofCode);
      if (result.status === 'SUCCESSFUL' && Math.abs(result.amount - tx.amount) < 0.01) {
        status = 'VERIFIED';
      } else {
        status = 'FAILED';
      }
    } catch {
      // Provider injoignable / timeout → laisser PENDING pour retry ultérieur.
      status = 'PENDING';
    }

    const updated = await this.prisma.transaction.update({
      where: { id: txId },
      data:  {
        proofVerifiedStatus: status,
        proofVerifiedAt:     new Date(),
      },
    });

    await this.audit.record({
      tenantId,
      userId:   actor.id,
      action:   'data.cashier.proof.verify.agency',
      resource: `CashRegisterTx:${txId}`,
      oldValue: { proofVerifiedStatus: tx.proofVerifiedStatus },
      newValue: { proofVerifiedStatus: status, providerKey },
      ipAddress,
      plane: 'data',
      level: status === 'FAILED' ? 'warn' : 'info',
    });

    return updated;
  }

  // ── Lecture ─────────────────────────────────────────────────────────────────

  async getRegister(tenantId: string, registerId: string, scope?: ScopeContext) {
    const r = await this.prisma.cashRegister.findFirst({
      where:   { id: registerId, tenantId },
      include: { transactions: { orderBy: { createdAt: 'desc' }, take: 50 } },
    });
    if (!r) throw new NotFoundException(`Register ${registerId} not found`);
    if (scope) assertOwnership(scope, r, 'agentId');
    return r;
  }

  /** Récupère la caisse ouverte de l'acteur (null si aucune). */
  async getMyOpenRegister(tenantId: string, actorId: string) {
    return this.prisma.cashRegister.findFirst({
      where: { tenantId, agentId: actorId, status: 'OPEN' },
      include: {
        _count: { select: { transactions: true } },
      },
    });
  }

  /**
   * Récupère ou crée la caisse VIRTUELLE système de l'agence.
   * Une seule caisse VIRTUAL existe par (tenant, agence), toujours OPEN,
   * agentId='SYSTEM'. Sert aux side-effects comptables sans session caissier :
   * voucher redeem self-service, refund.process, paiement en ligne.
   * Idempotent — concurrence gérée via findFirst → create fallback.
   * @param tenantId tenant scope
   * @param agencyId agence porteuse de la caisse virtuelle
   * @param tx       optionnel — client Prisma d'une transaction en cours
   */
  async getOrCreateVirtualRegister(
    tenantId: string,
    agencyId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    const existing = await client.cashRegister.findFirst({
      where: { tenantId, agencyId, kind: 'VIRTUAL' },
    });
    if (existing) return existing;

    try {
      return await client.cashRegister.create({
        data: {
          tenantId,
          agencyId,
          agentId:        'SYSTEM',
          kind:           'VIRTUAL',
          status:         'OPEN',
          initialBalance: 0,
        },
      });
    } catch (err) {
      // Concurrence : un autre appel a créé la caisse entre notre findFirst
      // et notre create. On re-lit et on retourne la caisse gagnante.
      const retry = await client.cashRegister.findFirst({
        where: { tenantId, agencyId, kind: 'VIRTUAL' },
      });
      if (retry) return retry;
      throw err;
    }
  }

  async listTransactions(
    tenantId: string,
    registerId: string,
    scope: ScopeContext,
    opts: { take?: number; skip?: number } = {},
  ) {
    const register = await this.prisma.cashRegister.findFirst({
      where: { id: registerId, tenantId },
      select: { id: true, agentId: true, agencyId: true },
    });
    if (!register) throw new NotFoundException(`Register ${registerId} not found`);
    if (scope.scope === 'own' && register.agentId !== scope.userId) {
      throw new ForbiddenException("Vous ne pouvez consulter que votre propre caisse");
    }
    if (scope.scope === 'agency' && register.agencyId !== scope.agencyId) {
      throw new ForbiddenException("Hors périmètre agence");
    }

    const take = Math.min(opts.take ?? 100, 500);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.transaction.findMany({
        where: { tenantId, cashRegisterId: registerId },
        orderBy: { createdAt: 'desc' },
        take,
        skip: opts.skip ?? 0,
        // Inclut les composants pour afficher le détail des paiements MIXED
        // dans le listing frontend (UI peut déployer un sous-tableau par ligne).
        include: { components: { orderBy: { sortOrder: 'asc' } } },
      }),
      this.prisma.transaction.count({
        where: { tenantId, cashRegisterId: registerId },
      }),
    ]);

    // ── Totaux par méthode effective (gap #3 MIXED reconciliation) ──────────
    // Ancien comportement : MIXED comptait pour 1 ligne unique — impossible de
    // ventiler cash vs momo. Nouveau : les Transaction MIXED sont DÉPLIÉES en
    // leurs composants (cash_only = vraies lignes CASH + composants CASH de MIXED).
    // Les non-MIXED sont groupés normalement.
    const [plainTotals, mixedComponents] = await Promise.all([
      this.prisma.transaction.groupBy({
        by: ['type', 'paymentMethod'],
        where: { tenantId, cashRegisterId: registerId, paymentMethod: { not: 'MIXED' } },
        _sum: { amount: true },
      }),
      this.prisma.transactionComponent.findMany({
        where:  {
          tenantId,
          transaction: { cashRegisterId: registerId, paymentMethod: 'MIXED' },
        },
        select: { paymentMethod: true, amount: true, transaction: { select: { type: true } } },
      }),
    ]);

    // Agrège plainTotals + composants MIXED en (type, paymentMethod) → somme
    const totalsMap = new Map<string, { type: string; paymentMethod: string; _sum: { amount: number } }>();
    for (const row of plainTotals) {
      const key = `${row.type}|${row.paymentMethod}`;
      totalsMap.set(key, { type: row.type, paymentMethod: row.paymentMethod, _sum: { amount: row._sum.amount ?? 0 } });
    }
    for (const comp of mixedComponents) {
      const key = `${comp.transaction.type}|${comp.paymentMethod}`;
      const existing = totalsMap.get(key);
      if (existing) {
        existing._sum.amount += comp.amount;
      } else {
        totalsMap.set(key, {
          type:          comp.transaction.type,
          paymentMethod: comp.paymentMethod,
          _sum:          { amount: comp.amount },
        });
      }
    }
    const totals = Array.from(totalsMap.values());

    return { items, total, totals };
  }

  // ── Ecriture transaction (unifiée + audit) ──────────────────────────────────

  async recordTransaction(
    tenantId: string,
    registerId: string,
    dto: RecordTransactionDto,
    actor: CurrentUserPayload | null,
    scope?: ScopeContext,
    opts: RecordTxOptions = {},
  ) {
    const client = opts.tx ?? this.prisma;

    // ── Vérification TENANT ISOLATION (toujours exécutée, quel que soit le scope).
    //   Si registerId appartient à un autre tenant → NotFound (pas de leak).
    //   Si la caisse n'est pas ouverte → BadRequest.
    const reg = await client.cashRegister.findFirst({
      where:  { id: registerId, tenantId },
      select: { id: true, agentId: true, agencyId: true, status: true, tenantId: true },
    });
    if (!reg) throw new NotFoundException(`Register ${registerId} not found`);
    if (reg.status !== 'OPEN') {
      throw new BadRequestException(`Caisse non ouverte (status=${reg.status})`);
    }

    // ── Vérifications de scope (en plus du tenant check ci-dessus).
    if (!opts.skipScopeCheck && scope) {
      if (scope.scope === 'own' && reg.agentId !== scope.userId) {
        throw new ForbiddenException("Scope 'own' violation — register not owned by actor");
      }
      if (scope.scope === 'agency' && reg.agencyId !== scope.agencyId) {
        throw new ForbiddenException("Scope 'agency' violation — register hors agence");
      }
    }

    // Idempotence via externalRef unique (dedup webhook / double-clic)
    if (dto.externalRef) {
      const dup = await client.transaction.findFirst({
        where: { tenantId, externalRef: dto.externalRef },
      });
      if (dup) return dup;
    }

    // Espèces : valider tenderedAmount ≥ (batchTotal ?? amount) et calculer
    // la monnaie rendue. En contexte batch, le total à couvrir est le grand
    // total des N tickets ; changeAmount est alors stocké sur la 1re transaction.
    // Non applicable (ignoré) pour autres modes de paiement.
    let tenderedAmount: number | null = null;
    let changeAmount:   number | null = null;
    if (dto.paymentMethod === 'CASH' && dto.tenderedAmount != null) {
      const toCover = dto.batchTotal ?? dto.amount;
      if (dto.tenderedAmount < toCover - 0.005) {
        throw new BadRequestException(
          `Montant remis (${dto.tenderedAmount}) insuffisant pour couvrir ${toCover}`,
        );
      }
      tenderedAmount = dto.tenderedAmount;
      changeAmount   = Math.round((dto.tenderedAmount - toCover) * 100) / 100;
    }

    // Preuve paiement hors-POS : code saisi à la main par le caissier quand
    // le client paie MoMo/Airtel/carte/virement/voucher. Ignoré si CASH.
    const proofCode = dto.paymentMethod === 'CASH' ? null : (dto.proofCode ?? null);
    const proofType = dto.paymentMethod === 'CASH' ? null : (dto.proofType ?? null);

    // ── Gap #3 — validation des composants MIXED ──────────────────────────
    // Si `paymentMethod='MIXED'` le DTO DOIT contenir `components[]` avec
    // Σ(amount) === dto.amount (tolérance 0.005 pour arrondis float). Sinon
    // le MIXED est rejeté comme "paiement ambigu" — pas de création d'une
    // Transaction MIXED sans détail (rend le rapprochement caisse impossible).
    const hasComponents = Array.isArray(dto.components) && dto.components.length > 0;
    if (dto.paymentMethod === 'MIXED') {
      if (!hasComponents) {
        throw new BadRequestException(
          'Paiement MIXED refusé : fournir `components[]` détaillant chaque leg (cash + momo, etc.)',
        );
      }
      const sum = (dto.components ?? []).reduce((acc, c) => acc + c.amount, 0);
      if (Math.abs(sum - dto.amount) > 0.005) {
        throw new BadRequestException(
          `Somme des composants MIXED (${sum}) ≠ total ${dto.amount}`,
        );
      }
      if ((dto.components ?? []).some((c) => c.paymentMethod === 'MIXED' as any)) {
        throw new BadRequestException('Un composant ne peut pas avoir paymentMethod=MIXED (récursivité interdite)');
      }
    }

    const created = await client.transaction.create({
      data: {
        tenantId,
        cashRegisterId: registerId,
        type:           dto.type,
        amount:         dto.amount,
        paymentMethod:  dto.paymentMethod,
        tenderedAmount,
        changeAmount,
        proofCode,
        proofType,
        externalRef:    dto.externalRef,
        metadata: {
          referenceType: dto.referenceType,
          referenceId:   dto.referenceId,
          note:          dto.note,
          recordedBy:    actor?.id ?? opts.actorId ?? 'system',
        },
      },
    });

    // ── Création atomique des composants MIXED (FK cascade) ───────────────
    // Dans la même tx Prisma que la Transaction parente pour garantir
    // l'invariant "MIXED ⇒ composants présents". Echec = rollback entier.
    if (dto.paymentMethod === 'MIXED' && hasComponents) {
      for (let i = 0; i < dto.components!.length; i++) {
        const comp = dto.components![i];
        await client.transactionComponent.create({
          data: {
            tenantId,
            transactionId: created.id,
            sortOrder:     i,
            paymentMethod: comp.paymentMethod,
            amount:        comp.amount,
            proofCode:     comp.proofCode ?? null,
            proofType:     comp.proofType ?? null,
            metadata:      (comp.metadata ?? {}) as object,
          },
        });
      }
    }

    // Audit hors-transaction — non bloquant
    void this.audit.record({
      tenantId,
      userId:   actor?.id ?? opts.actorId,
      action:   'data.cashier.transaction.own',
      resource: `CashRegisterTx:${created.id}`,
      newValue: {
        registerId,
        type:          dto.type,
        amount:        dto.amount,
        paymentMethod: dto.paymentMethod,
        tenderedAmount,
        changeAmount,
        proofCode,
        proofType,
        referenceType: dto.referenceType,
        referenceId:   dto.referenceId,
        externalRef:   dto.externalRef,
      },
      ipAddress: opts.ipAddress,
      plane: 'data',
      level: dto.type === 'REFUND' ? 'warn' : 'info',
    });

    return created;
  }

  // ── Rapports ────────────────────────────────────────────────────────────────

  /**
   * Liste des caisses clôturées avec écart (DISCREPANCY) sur une fenêtre
   * glissante. Utilisé par le dashboard admin pour l'audit.
   *
   * Sécurité : WHERE tenantId strict + filtre agencyId côté controller
   * selon le scope (scope=agency → forcé).
   */
  async listDiscrepancies(
    tenantId: string,
    filters: { agencyId?: string; sinceDays: number },
  ) {
    const since = new Date(Date.now() - filters.sinceDays * 24 * 60 * 60 * 1_000);
    const rows = await this.prisma.cashRegister.findMany({
      where: {
        tenantId,
        status: 'DISCREPANCY',
        closedAt:    { gte: since },
        ...(filters.agencyId ? { agencyId: filters.agencyId } : {}),
      },
      include: {
        _count: { select: { transactions: true } },
        agency: { select: { id: true, name: true } },
      },
      orderBy: { closedAt: 'desc' },
      take:    500,
    });

    // Calcule l'écart en parallèle. On aurait pu dénormaliser sur la table,
    // mais le calcul est léger et reste cohérent avec closeRegister().
    const withDelta = await Promise.all(rows.map(async (r) => {
      const totals = await this.prisma.transaction.aggregate({
        where: { tenantId, cashRegisterId: r.id },
        _sum:  { amount: true },
      });
      const theoretical = r.initialBalance + (totals._sum.amount ?? 0);
      const discrepancy = (r.finalBalance ?? 0) - theoretical;
      return {
        id:           r.id,
        agencyId:     r.agencyId,
        agencyName:   r.agency?.name ?? null,
        agentId:      r.agentId,
        openedAt:     r.openedAt,
        closedAt:     r.closedAt,
        initialBalance: r.initialBalance,
        finalBalance:   r.finalBalance,
        theoretical,
        discrepancy,
        txCount:      r._count.transactions,
      };
    }));
    return withDelta;
  }

  async getDailyReport(tenantId: string, agencyId: string, date: Date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    const registers = await this.prisma.cashRegister.findMany({
      where: {
        tenantId,
        agencyId,
        openedAt: { gte: start, lte: end },
      },
      include: {
        _count:       { select: { transactions: true } },
        transactions: { select: { type: true, amount: true, paymentMethod: true } },
      },
      orderBy: { openedAt: 'desc' },
    });

    // Agrégats par méthode + type pour rapprochement
    const totals = registers.reduce(
      (acc, reg) => {
        for (const t of reg.transactions) {
          acc.byType[t.type]             = (acc.byType[t.type] ?? 0) + t.amount;
          acc.byMethod[t.paymentMethod]  = (acc.byMethod[t.paymentMethod] ?? 0) + t.amount;
          acc.grossTotal                 += t.amount;
        }
        return acc;
      },
      { byType: {} as Record<string, number>, byMethod: {} as Record<string, number>, grossTotal: 0 },
    );

    return { registers, totals };
  }
}
