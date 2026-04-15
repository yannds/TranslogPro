import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ScopeContext } from '../../common/decorators/scope-context.decorator';
import { assertOwnership } from '../../common/helpers/scope-filter';
import { OpenRegisterDto } from './dto/open-register.dto';

@Injectable()
export class CashierService {
  constructor(private readonly prisma: PrismaService) {}

  async openRegister(tenantId: string, dto: OpenRegisterDto, actor: CurrentUserPayload) {
    const existing = await this.prisma.cashRegister.findFirst({
      where: { tenantId, agentId: actor.id, auditStatus: 'OPEN' },
    });
    if (existing) throw new ConflictException('You already have an open cash register');

    return this.prisma.cashRegister.create({
      data: {
        tenantId,
        agencyId:       dto.agencyId,
        agentId:        actor.id,
        initialBalance: dto.openingBalance,
      },
    });
  }

  async closeRegister(tenantId: string, registerId: string, actor: CurrentUserPayload, scope: ScopeContext) {
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

    const finalBalance = register.initialBalance + (totals._sum.amount ?? 0);

    return this.prisma.cashRegister.update({
      where: { id: registerId },
      data:  { auditStatus: 'CLOSED', closedAt: new Date(), finalBalance },
    });
  }

  async getRegister(tenantId: string, registerId: string, scope?: ScopeContext) {
    const r = await this.prisma.cashRegister.findFirst({
      where:   { id: registerId, tenantId },
      include: { transactions: { orderBy: { createdAt: 'desc' }, take: 50 } },
    });
    if (!r) throw new NotFoundException(`Register ${registerId} not found`);
    if (scope) assertOwnership(scope, r, 'agentId');
    return r;
  }

  async recordTransaction(
    tenantId:      string,
    registerId:    string,
    type:          string,
    amount:        number,
    paymentMethod: string,
    externalRef?:  string,
    scope?:        ScopeContext,
  ) {
    if (scope?.scope === 'own') {
      const reg = await this.prisma.cashRegister.findFirst({
        where: { id: registerId, tenantId },
        select: { agentId: true },
      });
      if (!reg) throw new NotFoundException(`Register ${registerId} not found`);
      if (reg.agentId !== scope.userId) {
        throw new ForbiddenException(`Scope 'own' violation — register not owned by actor`);
      }
    }
    return this.prisma.transaction.create({
      data: {
        tenantId,
        cashRegisterId: registerId,
        type,
        amount,
        paymentMethod,
        externalRef,
      },
    });
  }

  async getDailyReport(tenantId: string, agencyId: string, date: Date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    return this.prisma.cashRegister.findMany({
      where: {
        tenantId,
        agencyId,
        openedAt: { gte: start, lte: end },
      },
      include: {
        _count:       { select: { transactions: true } },
        transactions: { select: { type: true, amount: true } },
      },
    });
  }
}
