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
      }),
      this.prisma.transaction.count({
        where: { tenantId, cashRegisterId: registerId },
      }),
    ]);

    const totals = await this.prisma.transaction.groupBy({
      by: ['type', 'paymentMethod'],
      where: { tenantId, cashRegisterId: registerId },
      _sum: { amount: true },
    });

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

    const created = await client.transaction.create({
      data: {
        tenantId,
        cashRegisterId: registerId,
        type:           dto.type,
        amount:         dto.amount,
        paymentMethod:  dto.paymentMethod,
        tenderedAmount,
        changeAmount,
        externalRef:    dto.externalRef,
        metadata: {
          referenceType: dto.referenceType,
          referenceId:   dto.referenceId,
          note:          dto.note,
          recordedBy:    actor?.id ?? opts.actorId ?? 'system',
        },
      },
    });

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
