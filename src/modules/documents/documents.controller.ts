/**
 * DocumentsController — endpoints de génération de documents imprimables
 *
 * Toutes les routes sont scoped par tenant (/tenants/:tenantId/documents/…).
 * Chaque endpoint :
 *   1. Vérifie la permission via @RequirePermission
 *   2. Passe le ScopeContext (isImpersonating) au service
 *   3. Retourne { storageKey, downloadUrl, expiresAt, fingerprint, generatedAt }
 *
 * Le Frontend affiche l'URL de téléchargement dans un onglet/iframe.
 * L'impression (Ctrl+P) déclenche le CSS @media print embarqué dans le HTML.
 *
 * Traçabilité impersonation :
 *   Le ScopeContext injecté par PermissionGuard porte isImpersonating=true
 *   si l'agent support utilise un token JIT. Le renderer l'embarque dans
 *   le fingerprint et dans une bannière visible sur le document.
 */
import { Controller, Get, Post, Param, Body, Query, DefaultValuePipe, ParseIntPipe, ParseFloatPipe } from '@nestjs/common';
import { DocumentsService }  from './documents.service';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ScopeCtx, ScopeContext } from '../../common/decorators/scope-context.decorator';
import { Permission }         from '../../common/constants/permissions';

@Controller('tenants/:tenantId/documents')
export class DocumentsController {
  constructor(private readonly docs: DocumentsService) {}

  // ─── Billets ────────────────────────────────────────────────────────────────

  /**
   * Imprime un billet avec QR Code HMAC-SHA256.
   * CASHIER, AGENCY_MANAGER, TENANT_ADMIN peuvent imprimer les billets de leur agence.
   * SUPER_ADMIN (via impersonation) peut imprimer pour n'importe quel tenant.
   */
  @Get('tickets/:ticketId/print')
  @RequirePermission(Permission.TICKET_PRINT_AGENCY)
  printTicket(
    @Param('tenantId') tenantId: string,
    @Param('ticketId') ticketId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.docs.printTicket(tenantId, ticketId, actor, scope);
  }

  // ─── Manifeste ──────────────────────────────────────────────────────────────

  /**
   * Manifeste de bord pour un trajet.
   * Régénéré à chaque appel — cohérence garantie avec l'état DB courant.
   * DRIVER et HOSTESS : permission agency.
   * SUPPORT (impersonation) : permission global via MANIFEST_PRINT_GLOBAL.
   */
  @Get('trips/:tripId/manifest/print')
  @RequirePermission(Permission.MANIFEST_PRINT_AGENCY)
  printManifest(
    @Param('tenantId') tenantId: string,
    @Param('tripId')   tripId:   string,
    @CurrentUser() actor: CurrentUserPayload,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.docs.printManifest(tenantId, tripId, actor, scope);
  }

  // ─── Colis ──────────────────────────────────────────────────────────────────

  /** Étiquette d'un colis (format A6 + QR de tracking). */
  @Get('parcels/:parcelId/label')
  @RequirePermission(Permission.PARCEL_PRINT_AGENCY)
  printParcelLabel(
    @Param('tenantId') tenantId: string,
    @Param('parcelId') parcelId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.docs.printParcelLabel(tenantId, parcelId, actor, scope);
  }

  /** Bordereau de colisage d'un shipment complet. */
  @Get('shipments/:shipmentId/packing-list')
  @RequirePermission(Permission.PARCEL_PRINT_AGENCY)
  printPackingList(
    @Param('tenantId')   tenantId:   string,
    @Param('shipmentId') shipmentId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.docs.printPackingList(tenantId, shipmentId, actor, scope);
  }

  // ─── Factures ────────────────────────────────────────────────────────────────

  /** Facture d'un billet voyageur avec calcul TVA. */
  @Get('tickets/:ticketId/invoice')
  @RequirePermission(Permission.INVOICE_PRINT_AGENCY)
  printTicketInvoice(
    @Param('tenantId') tenantId: string,
    @Param('ticketId') ticketId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.docs.printTicketInvoice(tenantId, ticketId, actor, scope);
  }

  /** Facture d'un colis avec calcul TVA. */
  @Get('parcels/:parcelId/invoice')
  @RequirePermission(Permission.INVOICE_PRINT_AGENCY)
  printParcelInvoice(
    @Param('tenantId') tenantId: string,
    @Param('parcelId') parcelId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.docs.printParcelInvoice(tenantId, parcelId, actor, scope);
  }

  // ─── Exports Excel ───────────────────────────────────────────────────────────

  /** Export Excel de la liste des passagers d'un trajet. */
  @Get('trips/:tripId/passengers/excel')
  @RequirePermission(Permission.MANIFEST_PRINT_AGENCY)
  exportTripPassengersExcel(
    @Param('tenantId') tenantId: string,
    @Param('tripId')   tripId:   string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.docs.exportTripPassengersExcel(tenantId, tripId, actor);
  }

  // ─── POC Haute-Fidélité (Renderers Pro) ─────────────────────────────────────

  /**
   * POC — Facture professionnelle avec talon détachable (A4, Puppeteer).
   * Rendu haute-fidélité : taxes, coordonnées bancaires, QR coupon.
   */
  @Get('tickets/:ticketId/invoice-pro')
  @RequirePermission(Permission.INVOICE_PRINT_AGENCY)
  printInvoicePro(
    @Param('tenantId') tenantId: string,
    @Param('ticketId') ticketId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.docs.printInvoicePro(tenantId, ticketId, actor, scope);
  }

  /**
   * POC — Billet avec talon détachable boarding-pass (A5, Puppeteer).
   * Format double partie : billet principal + coupon embarquement.
   */
  @Get('tickets/:ticketId/stub')
  @RequirePermission(Permission.TICKET_PRINT_AGENCY)
  printTicketStub(
    @Param('tenantId') tenantId: string,
    @Param('ticketId') ticketId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.docs.printTicketStub(tenantId, ticketId, actor, scope);
  }

  /**
   * POC — Feuille multi-impression d'étiquettes (A4, layout 2x4 ou 2x2).
   * POST body : { parcelIds: string[], layout?: '2x4' | '2x2' }
   */
  @Post('parcels/multi-label')
  @RequirePermission(Permission.PARCEL_PRINT_AGENCY)
  printMultiLabel(
    @Param('tenantId') tenantId: string,
    @Body() body: { parcelIds: string[]; layout?: '2x4' | '2x2' },
    @CurrentUser() actor: CurrentUserPayload,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.docs.printMultiLabel(tenantId, body.parcelIds, body.layout, actor, scope);
  }

  /**
   * POC — Talon bagage physique (bande 99×210mm) avec QR de tracking.
   * ?bagIndex=1&totalBags=2&weight=22.5&description=Valise%20bordeaux
   */
  @Get('tickets/:ticketId/baggage-tag')
  @RequirePermission(Permission.TICKET_PRINT_AGENCY)
  printBaggageTag(
    @Param('tenantId') tenantId:  string,
    @Param('ticketId') ticketId:  string,
    @Query('bagIndex',  new DefaultValuePipe(1),    ParseIntPipe)   bagIndex:    number,
    @Query('totalBags', new DefaultValuePipe(1),    ParseIntPipe)   totalBags:   number,
    @Query('weight',    new DefaultValuePipe(0),    ParseFloatPipe) weightKg:    number,
    @Query('description') description: string | undefined,
    @CurrentUser() actor: CurrentUserPayload,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.docs.printBaggageTag(
      tenantId, ticketId,
      bagIndex, totalBags, weightKg,
      description ?? null,
      actor, scope,
    );
  }

  /**
   * POC — Enveloppe C5 ou DL avec fenêtre destinataire (Puppeteer landscape).
   * ?format=C5|DL
   */
  @Get('shipments/:shipmentId/envelope')
  @RequirePermission(Permission.PARCEL_PRINT_AGENCY)
  printEnvelope(
    @Param('tenantId')   tenantId:   string,
    @Param('shipmentId') shipmentId: string,
    @Query('format')     format:     'C5' | 'DL' = 'C5',
    @CurrentUser() actor: CurrentUserPayload,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.docs.printEnvelope(tenantId, shipmentId, format, actor, scope);
  }
}
