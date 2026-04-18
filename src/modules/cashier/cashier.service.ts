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
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Open ────────────────────────────────────────────────────────────────────

  async openRegister(
    tenantId: string,
    dto: OpenRegisterDto,
    actor: CurrentUserPayload,
    ipAddress?: string,
  ) {
    const existing = await this.prisma.cashRegister.findFirst({
      where: { tenantId, agentId: actor.id, auditStatus: 'OPEN' },
    });
    if (existing) {
      throw new ConflictException('Vous avez déjà une caisse ouverte');
    }

    const register = await this.prisma.cashRegister.create({
      data: {
        tenantId,
        agencyId:       dto.agencyId,
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
      where: { id: registerId, tenantId, auditStatus: 'OPEN' },
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
    const status = Math.abs(discrepancy) < 0.01 ? 'CLOSED' : 'DISCREPANCY';

    const closed = await this.prisma.cashRegister.update({
      where: { id: registerId },
      data:  {
        auditStatus:  status,
        closedAt:     new Date(),
        finalBalance: counted,
      },
    });

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
      where: { tenantId, agentId: actorId, auditStatus: 'OPEN' },
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

    if (!opts.skipScopeCheck && scope?.scope === 'own') {
      const reg = await client.cashRegister.findFirst({
        where: { id: registerId, tenantId },
        select: { agentId: true, auditStatus: true },
      });
      if (!reg) throw new NotFoundException(`Register ${registerId} not found`);
      if (reg.agentId !== scope.userId) {
        throw new ForbiddenException("Scope 'own' violation — register not owned by actor");
      }
      if (reg.auditStatus !== 'OPEN') {
        throw new BadRequestException(`Caisse non ouverte (status=${reg.auditStatus})`);
      }
    } else if (opts.skipScopeCheck) {
      const reg = await client.cashRegister.findFirst({
        where: { id: registerId, tenantId },
        select: { auditStatus: true },
      });
      if (!reg) throw new NotFoundException(`Register ${registerId} not found`);
      if (reg.auditStatus !== 'OPEN') {
        throw new BadRequestException(`Caisse non ouverte (status=${reg.auditStatus})`);
      }
    }

    // Idempotence via externalRef unique (dedup webhook / double-clic)
    if (dto.externalRef) {
      const dup = await client.transaction.findFirst({
        where: { tenantId, externalRef: dto.externalRef },
      });
      if (dup) return dup;
    }

    const created = await client.transaction.create({
      data: {
        tenantId,
        cashRegisterId: registerId,
        type:           dto.type,
        amount:         dto.amount,
        paymentMethod:  dto.paymentMethod,
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
