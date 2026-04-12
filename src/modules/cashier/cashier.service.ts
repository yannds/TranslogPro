import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ScopeContext } from '../../common/decorators/scope-context.decorator';
import { OpenRegisterDto } from './dto/open-register.dto';

@Injectable()
export class CashierService {
  constructor(private readonly prisma: PrismaService) {}

  async openRegister(tenantId: string, dto: OpenRegisterDto, actor: CurrentUserPayload) {
    const existing = await this.prisma.cashRegister.findFirst({
      where: { tenantId, cashierId: actor.id, status: 'OPEN' },
    });
    if (existing) throw new ConflictException('You already have an open cash register');

    return this.prisma.cashRegister.create({
      data: {
        tenantId,
        agencyId:       dto.agencyId,
        cashierId:      actor.id,
        openingBalance: dto.openingBalance,
        status:         'OPEN',
        openedAt:       new Date(),
      },
    });
  }

  async closeRegister(tenantId: string, registerId: string, actor: CurrentUserPayload, scope: ScopeContext) {
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

    const closingBalance = (register.openingBalance as number) + (totals._sum.amount ?? 0);

    return this.prisma.cashRegister.update({
      where: { id: registerId },
      data:  { status: 'CLOSED', closedAt: new Date(), closingBalance },
    });
  }

  async getRegister(tenantId: string, registerId: string) {
    const r = await this.prisma.cashRegister.findFirst({
      where:   { id: registerId, tenantId },
      include: { transactions: { orderBy: { createdAt: 'desc' }, take: 50 } },
    });
    if (!r) throw new NotFoundException(`Register ${registerId} not found`);
    return r;
  }

  async recordTransaction(
    tenantId:    string,
    registerId:  string,
    type:        string,
    amount:      number,
    referenceId: string,
    referenceType: string,
  ) {
    return this.prisma.transaction.create({
      data: {
        tenantId,
        cashRegisterId: registerId,
        type,
        amount,
        referenceId,
        referenceType,
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
