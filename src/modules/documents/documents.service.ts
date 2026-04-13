/**
 * DocumentsService — moteur de génération de documents imprimables
 *
 * Architecture Backend-Driven :
 *   1. Fetch des données depuis la DB (état courant — cohérence garantie)
 *   2. Rendu HTML certifié (fingerprint SHA-256 + mention impersonation)
 *   3. Puppeteer → PDF buffer (WYSIWYG — format configurable par docType)
 *   4. Upload direct vers MinIO via IStorageService.putObject()
 *   5. Retour d'une URL présignée à durée de vie limitée
 *
 * Cohérence temps réel :
 *   Le document est régénéré à chaque appel — toujours en phase avec la DB.
 *
 * Traçabilité impersonation :
 *   Le ScopeContext porte isImpersonating=true si un agent support génère via JIT.
 *   Le renderer l'embarque dans le fingerprint + bannière visible.
 */
import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  IStorageService,
  STORAGE_SERVICE,
  DocumentType,
} from '../../infrastructure/storage/interfaces/storage.interface';
import { PrismaService }       from '../../infrastructure/database/prisma.service';
import { CurrentUserPayload }  from '../../common/decorators/current-user.decorator';
import { ScopeContext }        from '../../common/decorators/scope-context.decorator';
import { PuppeteerService, PrintFormat } from '../../infrastructure/renderer/puppeteer.service';
import { ExcelService }        from '../../infrastructure/renderer/excel.service';

import { renderTicket }                            from './renderers/ticket.renderer';
import { renderManifest }                          from './renderers/manifest.renderer';
import { renderParcelLabel, renderPackingList }    from './renderers/parcel-label.renderer';
import {
  renderInvoice,
  ticketToInvoiceLines,
  parcelToInvoiceLines,
} from './renderers/invoice.renderer';

// TVA par défaut UEMOA — surchargeable via TenantConfig dans une future itération
const DEFAULT_TVA_RATE = 0.18;

// Correspondance docType → format papier par défaut
const DEFAULT_FORMAT: Partial<Record<DocumentType, PrintFormat>> = {
  [DocumentType.TICKET_PDF]:   'A5',
  [DocumentType.MANIFEST_HTML]: 'A4',
  [DocumentType.INVOICE_HTML]:  'A4',
  [DocumentType.PARCEL_LABEL]:  'LABEL_62MM',
};

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma:     PrismaService,
    private readonly puppeteer:  PuppeteerService,
    private readonly excel:      ExcelService,
    @Inject(STORAGE_SERVICE) private readonly storage: IStorageService,
  ) {}

  // ─── Billet voyageur ────────────────────────────────────────────────────────

  async printTicket(
    tenantId:  string,
    ticketId:  string,
    actor:     CurrentUserPayload,
    scope:     ScopeContext | undefined,
  ) {
    const ticket = await this.prisma.ticket.findFirst({ where: { id: ticketId, tenantId } });
    if (!ticket) throw new NotFoundException(`Ticket ${ticketId} introuvable`);

    const [tenant, trip] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
      this.prisma.trip.findUnique({
        where:   { id: ticket.tripId },
        include: { route: true, bus: true },
      }),
    ]);

    const html = await renderTicket({
      ticket: {
        id:            ticket.id,
        tenantId:      ticket.tenantId,
        passengerName: ticket.passengerName,
        seatNumber:    (ticket as any).seatNumber ?? null,
        pricePaid:     ticket.pricePaid,
        status:        ticket.status,
        qrToken:       ticket.qrCode,
        createdAt:     ticket.createdAt,
        expiresAt:     (ticket as any).expiresAt ?? null,
      },
      trip: {
        id:                 trip?.id ?? ticket.tripId,
        departureScheduled: trip?.departureScheduled ?? new Date(),
        arrivalScheduled:   trip?.arrivalScheduled   ?? new Date(),
        route:              (trip as any)?.route ?? null,
        bus:                (trip as any)?.bus   ?? null,
      },
      tenantName: tenant.name,
      actorId:    actor.id,
      scope,
    });

    return this.storeAsPdf(tenantId, html, `tickets/${ticketId}`, DocumentType.TICKET_PDF, actor, 'A5');
  }

  // ─── Manifeste de bord ──────────────────────────────────────────────────────

  async printManifest(
    tenantId: string,
    tripId:   string,
    actor:    CurrentUserPayload,
    scope:    ScopeContext | undefined,
  ) {
    const trip = await this.prisma.trip.findFirst({
      where:   { id: tripId, tenantId },
      include: {
        route:     true,
        bus:       true,
        travelers: true,
        shipments: { include: { parcels: true } },
      },
    });
    if (!trip) throw new NotFoundException(`Trip ${tripId} introuvable`);

    const driver = await this.prisma.user.findUnique({ where: { id: trip.driverId } });

    const ticketIds = (trip.travelers as any[]).map(t => t.ticketId);
    const tickets   = ticketIds.length > 0
      ? await this.prisma.ticket.findMany({
          where:  { id: { in: ticketIds } },
          select: { id: true, passengerName: true, seatNumber: true },
        })
      : [];
    const ticketMap = new Map(tickets.map(t => [t.id, t]));

    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

    const travelers = (trip.travelers as any[]).map(t => ({
      id:               t.id,
      passengerName:    ticketMap.get(t.ticketId)?.passengerName ?? '—',
      seatNumber:       (ticketMap.get(t.ticketId) as any)?.seatNumber ?? null,
      status:           t.status,
      dropOffStationId: t.dropOffStationId ?? null,
    }));

    const shipments = (trip.shipments as any[]).map(s => ({
      id:            s.id,
      destinationId: s.destinationId,
      totalWeight:   s.totalWeight,
      status:        s.status,
      parcels:       (s.parcels as any[]).map((p: any) => ({
        id:            p.id,
        trackingCode:  p.trackingCode,
        weight:        p.weight,
        status:        p.status,
        destinationId: p.destinationId,
      })),
    }));

    const html = renderManifest({
      trip: {
        id:                 trip.id,
        status:             trip.status,
        departureScheduled: trip.departureScheduled,
        arrivalScheduled:   trip.arrivalScheduled,
        route:              (trip as any).route,
        bus:                (trip as any).bus,
        driver:             driver ? { name: driver.name ?? null, email: driver.email } : null,
      },
      travelers,
      shipments,
      tenantName: tenant.name,
      actorId:    actor.id,
      scope,
    });

    return this.storeAsPdf(tenantId, html, `manifests/${tripId}`, DocumentType.MANIFEST_HTML, actor, 'A4');
  }

  // ─── Étiquette colis ────────────────────────────────────────────────────────

  async printParcelLabel(
    tenantId: string,
    parcelId: string,
    actor:    CurrentUserPayload,
    scope:    ScopeContext | undefined,
  ) {
    const parcel = await this.prisma.parcel.findFirst({
      where:   { id: parcelId, tenantId },
      include: { destination: true },
    });
    if (!parcel) throw new NotFoundException(`Colis ${parcelId} introuvable`);

    const sender = await this.prisma.user.findUnique({ where: { id: parcel.senderId } });
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const trackingBase = process.env.PUBLIC_TRACKING_URL ?? 'https://track.translogpro.io';

    const html = await renderParcelLabel({
      parcel: {
        id:            parcel.id,
        trackingCode:  parcel.trackingCode,
        weight:        parcel.weight,
        price:         parcel.price,
        status:        parcel.status,
        createdAt:     parcel.createdAt,
        recipientInfo: parcel.recipientInfo as Record<string, unknown>,
        sender:        sender ? { name: sender.name ?? null, email: sender.email } : null,
        destination:   (parcel as any).destination ?? null,
      },
      tenantName:   tenant.name,
      trackingBase,
      actorId:      actor.id,
      scope,
    });

    return this.storeAsPdf(tenantId, html, `labels/${parcelId}`, DocumentType.PARCEL_LABEL, actor, 'LABEL_62MM');
  }

  // ─── Bordereau de colisage ───────────────────────────────────────────────────

  async printPackingList(
    tenantId:   string,
    shipmentId: string,
    actor:      CurrentUserPayload,
    scope:      ScopeContext | undefined,
  ) {
    const shipment = await this.prisma.shipment.findFirst({
      where:   { id: shipmentId, tenantId },
      include: {
        parcels: true,
        trip:    { include: { route: true } },
      },
    });
    if (!shipment) throw new NotFoundException(`Shipment ${shipmentId} introuvable`);

    const senderIds = [...new Set((shipment.parcels as any[]).map(p => p.senderId))];
    const senders   = senderIds.length > 0
      ? await this.prisma.user.findMany({
          where:  { id: { in: senderIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const senderMap = new Map(senders.map(s => [s.id, s]));

    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const trip   = (shipment as any).trip;

    const html = renderPackingList({
      shipment: {
        id:            shipment.id,
        destinationId: shipment.destinationId,
        totalWeight:   shipment.totalWeight,
        status:        shipment.status,
        createdAt:     shipment.createdAt,
        parcels:       (shipment.parcels as any[]).map(p => ({
          id:            p.id,
          trackingCode:  p.trackingCode,
          weight:        p.weight,
          price:         p.price,
          status:        p.status,
          recipientInfo: p.recipientInfo,
          sender:        senderMap.get(p.senderId) ?? null,
        })),
      },
      trip: trip ? {
        id:                 trip.id,
        departureScheduled: trip.departureScheduled,
        route:              trip.route,
      } : null,
      tenantName: tenant.name,
      actorId:    actor.id,
      scope,
    });

    return this.storeAsPdf(tenantId, html, `packing-lists/${shipmentId}`, DocumentType.PARCEL_LABEL, actor, 'A4');
  }

  // ─── Facture ticket voyageur ─────────────────────────────────────────────────

  async printTicketInvoice(
    tenantId: string,
    ticketId: string,
    actor:    CurrentUserPayload,
    scope:    ScopeContext | undefined,
  ) {
    const ticket = await this.prisma.ticket.findFirst({ where: { id: ticketId, tenantId } });
    if (!ticket) throw new NotFoundException(`Ticket ${ticketId} introuvable`);

    const [tenant, trip] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
      this.prisma.trip.findUnique({
        where:   { id: ticket.tripId },
        include: { route: true },
      }),
    ]);
    const invoiceNumber = buildInvoiceNumber(ticketId);

    const lines = ticketToInvoiceLines(
      ticket.passengerName,
      ticket.pricePaid,
      DEFAULT_TVA_RATE,
      trip?.route?.name ?? 'Trajet',
      (ticket as any).seatNumber ?? null,
    );

    const html = renderInvoice({
      invoiceNumber,
      issuedAt: ticket.createdAt,
      client: { name: ticket.passengerName, phone: null, address: null, email: null },
      seller: buildSellerFromTenant(tenant),
      lines,
      currency: 'FCFA',
      notes:    null,
      actorId:  actor.id,
      scope,
    });

    return this.storeAsPdf(tenantId, html, `invoices/ticket-${ticketId}`, DocumentType.INVOICE_HTML, actor, 'A4');
  }

  // ─── Facture colis ───────────────────────────────────────────────────────────

  async printParcelInvoice(
    tenantId: string,
    parcelId: string,
    actor:    CurrentUserPayload,
    scope:    ScopeContext | undefined,
  ) {
    const parcel = await this.prisma.parcel.findFirst({
      where:   { id: parcelId, tenantId },
      include: { destination: true },
    });
    if (!parcel) throw new NotFoundException(`Colis ${parcelId} introuvable`);

    const sender      = await this.prisma.user.findUnique({ where: { id: parcel.senderId } });
    const tenant      = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const destination = (parcel as any).destination;
    const recipient   = parcel.recipientInfo as { name?: string; phone?: string; address?: string };
    const invoiceNumber = buildInvoiceNumber(parcelId);

    const lines = parcelToInvoiceLines(
      parcel.trackingCode,
      parcel.weight,
      parcel.price,
      DEFAULT_TVA_RATE,
      destination?.name ?? parcel.destinationId,
    );

    const html = renderInvoice({
      invoiceNumber,
      issuedAt: parcel.createdAt,
      client: {
        name:    recipient.name ?? sender?.name ?? '—',
        phone:   recipient.phone ?? null,
        address: recipient.address ?? null,
        email:   sender?.email ?? null,
      },
      seller: buildSellerFromTenant(tenant),
      lines,
      currency: 'FCFA',
      notes:    null,
      actorId:  actor.id,
      scope,
    });

    return this.storeAsPdf(tenantId, html, `invoices/parcel-${parcelId}`, DocumentType.INVOICE_HTML, actor, 'A4');
  }

  // ─── Export Excel voyageurs d'un trip ────────────────────────────────────────

  async exportTripPassengersExcel(
    tenantId: string,
    tripId:   string,
    actor:    CurrentUserPayload,
  ) {
    const trip = await this.prisma.trip.findFirst({
      where:   { id: tripId, tenantId },
      include: { route: true, travelers: true },
    });
    if (!trip) throw new NotFoundException(`Trip ${tripId} introuvable`);

    const ticketIds = (trip.travelers as any[]).map(t => t.ticketId);
    const tickets   = ticketIds.length > 0
      ? await this.prisma.ticket.findMany({
          where:  { id: { in: ticketIds } },
          select: { id: true, passengerName: true, seatNumber: true, status: true, pricePaid: true },
        })
      : [];

    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

    const rows = tickets.map(t => ({
      passengerName: t.passengerName,
      seatNumber:    (t as any).seatNumber ?? '—',
      status:        t.status,
      pricePaid:     t.pricePaid,
      ticketId:      t.id,
    }));

    const buf = await this.excel.toBuffer({
      sheetName: 'Passagers',
      title:     `Passagers — ${(trip as any).route?.name ?? tripId}`,
      columns: [
        { header: 'Nom passager',  key: 'passengerName', width: 30 },
        { header: 'Siège',         key: 'seatNumber',    width: 10 },
        { header: 'Statut',        key: 'status',        width: 18 },
        { header: 'Prix payé (F)', key: 'pricePaid',     width: 16 },
        { header: 'N° Billet',     key: 'ticketId',      width: 28 },
      ],
      rows,
      metadata: {
        'Tenant':     tenant.name,
        'Trip':       tripId,
        'Généré le':  new Date().toLocaleString('fr-FR'),
        'Acteur':     actor.id,
      },
    });

    return this.storeBuffer(
      tenantId,
      buf,
      `exports/trips/${tripId}/passengers`,
      DocumentType.EXCEL_EXPORT,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      actor,
    );
  }

  // ─── Helpers privés ──────────────────────────────────────────────────────────

  private async storeAsPdf(
    tenantId: string,
    html:     string,
    subPath:  string,
    docType:  DocumentType,
    actor:    CurrentUserPayload,
    format:   PrintFormat = 'A4',
  ) {
    const ts          = Date.now();
    const key         = `${tenantId}/documents/${subPath}/${ts}.pdf`;
    const fingerprint = createHash('sha256').update(html).digest('hex');

    // Puppeteer → PDF buffer → upload direct
    const pdfBuffer   = await this.puppeteer.htmlToPdf(html, format);
    await this.storage.putObject(tenantId, key, pdfBuffer, 'application/pdf');

    const downloadInfo = await this.storage.getDownloadUrl(tenantId, key, docType);

    this.logger.log(
      `[Documents] ${docType} PDF généré key=${key} actor=${actor.id} fp=${fingerprint.slice(0, 16)}… size=${pdfBuffer.length}B`,
    );

    return {
      storageKey:  key,
      downloadUrl: downloadInfo.url,
      expiresAt:   downloadInfo.expiresAt,
      fingerprint,
      generatedAt: new Date(ts),
      actorId:     actor.id,
      format,
      sizeBytes:   pdfBuffer.length,
    };
  }

  private async storeBuffer(
    tenantId:    string,
    buffer:      Buffer,
    subPath:     string,
    docType:     DocumentType,
    contentType: string,
    actor:       CurrentUserPayload,
  ) {
    const ts  = Date.now();
    const ext = contentType.includes('spreadsheet') ? 'xlsx' : contentType.includes('word') ? 'docx' : 'bin';
    const key = `${tenantId}/documents/${subPath}/${ts}.${ext}`;

    await this.storage.putObject(tenantId, key, buffer, contentType);
    const downloadInfo = await this.storage.getDownloadUrl(tenantId, key, docType);

    this.logger.log(`[Documents] ${docType} généré key=${key} actor=${actor.id} size=${buffer.length}B`);

    return {
      storageKey:  key,
      downloadUrl: downloadInfo.url,
      expiresAt:   downloadInfo.expiresAt,
      generatedAt: new Date(ts),
      actorId:     actor.id,
      sizeBytes:   buffer.length,
    };
  }
}

// ─── Fonctions utilitaires ────────────────────────────────────────────────────

function buildInvoiceNumber(entityId: string): string {
  const yyyymm = new Date().toISOString().slice(0, 7).replace('-', '');
  return `${yyyymm}-${entityId.slice(0, 8).toUpperCase()}`;
}

function buildSellerFromTenant(tenant: { name: string; settings?: unknown }) {
  const s = (tenant.settings ?? {}) as Record<string, unknown>;
  return {
    name:    tenant.name,
    address: (s.address as string) ?? null,
    phone:   (s.phone   as string) ?? null,
    email:   (s.email   as string) ?? null,
    nif:     (s.nif     as string) ?? null,
    rccm:    (s.rccm    as string) ?? null,
  };
}
