import { Controller, Get, Post, Patch, Param, Body, Query } from '@nestjs/common';
import { CashierService } from './cashier.service';
import { OpenRegisterDto } from './dto/open-register.dto';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ScopeCtx, ScopeContext } from '../../common/decorators/scope-context.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('tenants/:tenantId/cashier')
export class CashierController {
  constructor(private readonly cashierService: CashierService) {}

  /** Ouvrir session caisse — scope own (chaque agent ouvre la sienne) */
  @Post('registers')
  @RequirePermission(Permission.CASHIER_OPEN_OWN)
  open(
    @TenantId() tenantId: string,
    @Body() dto: OpenRegisterDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.cashierService.openRegister(tenantId, dto, actor);
  }

  /** Enregistrer flux cash — scope own */
  @Post('registers/:id/transactions')
  @RequirePermission(Permission.CASHIER_TRANSACTION_OWN)
  transaction(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body('type') type: string,
    @Body('amount') amount: number,
    @Body('referenceId') referenceId: string,
    @Body('referenceType') referenceType: string,
    @CurrentUser() actor: CurrentUserPayload,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.cashierService.recordTransaction(tenantId, id, type, amount, referenceId, referenceType, scope);
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
    @CurrentUser() actor: CurrentUserPayload,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.cashierService.closeRegister(tenantId, id, actor, scope);
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
    // scope agency : rapport limité à l'agence de l'acteur
    const agency = scope.scope === 'agency' ? scope.agencyId! : agencyId;
    return this.cashierService.getDailyReport(tenantId, agency!, new Date(date ?? Date.now()));
  }
}
