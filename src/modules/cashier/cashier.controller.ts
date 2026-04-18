import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { CashierService } from './cashier.service';
import { OpenRegisterDto } from './dto/open-register.dto';
import { RecordTransactionDto } from './dto/record-transaction.dto';
import { CloseRegisterDto } from './dto/close-register.dto';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ScopeCtx, ScopeContext } from '../../common/decorators/scope-context.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('tenants/:tenantId/cashier')
export class CashierController {
  constructor(private readonly cashierService: CashierService) {}

  /** Ouvrir session caisse — scope own */
  @Post('registers')
  @RequirePermission(Permission.CASHIER_OPEN_OWN)
  open(
    @TenantId() tenantId: string,
    @Body() dto: OpenRegisterDto,
    @CurrentUser() actor: CurrentUserPayload,
    @Req() req: Request,
  ) {
    return this.cashierService.openRegister(tenantId, dto, actor, req.ip);
  }

  /** Caisse ouverte de l'acteur (null si aucune) */
  @Get('registers/me/open')
  @RequirePermission(Permission.CASHIER_OPEN_OWN)
  myOpen(
    @TenantId() tenantId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.cashierService.getMyOpenRegister(tenantId, actor.id);
  }

  /** Enregistrer flux cash — scope own */
  @Post('registers/:id/transactions')
  @RequirePermission(Permission.CASHIER_TRANSACTION_OWN)
  transaction(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: RecordTransactionDto,
    @CurrentUser() actor: CurrentUserPayload,
    @ScopeCtx() scope: ScopeContext,
    @Req() req: Request,
  ) {
    return this.cashierService.recordTransaction(tenantId, id, dto, actor, scope, {
      ipAddress: req.ip,
    });
  }

  /** Liste transactions d'une caisse + agrégats */
  @Get('registers/:id/transactions')
  @RequirePermission(Permission.CASHIER_OPEN_OWN)
  listTransactions(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @ScopeCtx() scope: ScopeContext,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.cashierService.listTransactions(tenantId, id, scope, {
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  /**
   * Clôturer caisse — scope agency.
   * PRD §IV.8 : superviseur peut clôturer la caisse d'un agent
   * de SON agence uniquement.
   */
  @Patch('registers/:id/close')
  @RequirePermission(Permission.CASHIER_CLOSE_AGENCY)
  close(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: CloseRegisterDto,
    @CurrentUser() actor: CurrentUserPayload,
    @ScopeCtx() scope: ScopeContext,
    @Req() req: Request,
  ) {
    return this.cashierService.closeRegister(tenantId, id, dto, actor, scope, req.ip);
  }

  @Get('registers/:id')
  @RequirePermission(Permission.CASHIER_OPEN_OWN)
  getRegister(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.cashierService.getRegister(tenantId, id, scope);
  }

  @Get('report/daily')
  @RequirePermission(Permission.CASHIER_CLOSE_AGENCY)
  dailyReport(
    @TenantId() tenantId: string,
    @ScopeCtx() scope: ScopeContext,
    @Query('agencyId') agencyId?: string,
    @Query('date') date?: string,
  ) {
    const agency = scope.scope === 'agency' ? scope.agencyId! : agencyId;
    return this.cashierService.getDailyReport(tenantId, agency!, new Date(date ?? Date.now()));
  }
}
