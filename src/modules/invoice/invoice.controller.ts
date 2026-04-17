/**
 * InvoiceController — Endpoints facturation.
 *
 * Routes :
 *   GET    /api/v1/tenants/:tid/invoices
 *   GET    /api/v1/tenants/:tid/invoices/:id
 *   POST   /api/v1/tenants/:tid/invoices
 *   PATCH  /api/v1/tenants/:tid/invoices/:id
 *   DELETE /api/v1/tenants/:tid/invoices/:id
 */
import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query,
} from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { CreateInvoiceDto, UpdateInvoiceDto } from './dto/create-invoice.dto';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller({ version: '1', path: 'tenants/:tenantId' })
export class InvoiceController {
  constructor(private readonly invoices: InvoiceService) {}

  @Get('invoices')
  @RequirePermission(Permission.INVOICE_READ_AGENCY)
  findAll(
    @Param('tenantId') tenantId: string,
    @Query('status')   status?:  string,
  ) {
    return this.invoices.findAll(tenantId, status);
  }

  @Get('invoices/:id')
  @RequirePermission(Permission.INVOICE_READ_AGENCY)
  findOne(
    @Param('tenantId') tenantId: string,
    @Param('id')       id:       string,
  ) {
    return this.invoices.findOne(tenantId, id);
  }

  @Post('invoices')
  @RequirePermission(Permission.INVOICE_CREATE_AGENCY)
  create(
    @Param('tenantId') tenantId: string,
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.invoices.create(tenantId, dto);
  }

  @Patch('invoices/:id')
  @RequirePermission(Permission.INVOICE_MANAGE_TENANT)
  update(
    @Param('tenantId') tenantId: string,
    @Param('id')       id:       string,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.invoices.update(tenantId, id, dto);
  }

  @Delete('invoices/:id')
  @RequirePermission(Permission.INVOICE_MANAGE_TENANT)
  remove(
    @Param('tenantId') tenantId: string,
    @Param('id')       id:       string,
  ) {
    return this.invoices.remove(tenantId, id);
  }
}
