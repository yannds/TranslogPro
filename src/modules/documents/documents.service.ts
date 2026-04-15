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
import { PdfmeService, PdfmeInputRecord } from '../../infrastructure/renderer/pdfme.service';
import { TemplatesService }    from '../templates/templates.service';

import { renderTicket }                            from './renderers/ticket.renderer';
import { renderManifest }                          from './renderers/manifest.renderer';
import { renderParcelLabel, renderPackingList }    from './renderers/parcel-label.renderer';
import {
  renderInvoice,
  ticketToInvoiceLines,
  parcelToInvoiceLines,
} from './renderers/invoice.renderer';

// ── POC haute-fidélité ───────────────────────────────────────────────────────
import { renderInvoicePro }   from './renderers/invoice-pro.renderer';
import { renderTicketStub }   from './renderers/ticket-stub.renderer';
import { renderMultiLabel }   from './renderers/multi-label.renderer';
import { renderEnvelope }     from './renderers/envelope.renderer';
import { renderBaggageTag }   from './renderers/baggage-tag.renderer';

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
    private readonly pdfme:      PdfmeService,
    private readonly templates:  TemplatesService,
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

    const s = (tenant.settings ?? {}) as Record<string, unknown>;
    const tenantLogo = await this.fetchTenantLogoDataUri(tenantId);
    const pdfmeData: Record<string, string> = {
      tenantLogo,
      tenantName:    tenant.name,
      tenantAddress: (s.address as string) ?? '',
      tenantPhone:   (s.phone   as string) ?? '',
      ticketRef:     ticket.id,
      passengerName: ticket.passengerName,
      passengerPhone:(s.phone   as string) ?? '',
      seatNumber:    (ticket as any).seatNumber ?? '—',
      price:         String(ticket.pricePaid),
      currency:      'FCFA',
      origin:        (trip as any)?.route?.originId      ?? '',
      destination:   (trip as any)?.route?.destinationId ?? '',
      tripDate:      (trip?.departureScheduled ?? new Date()).toLocaleString('fr-FR'),
      routeName:     (trip as any)?.route?.name     ?? '',
      busPlate:      (trip as any)?.bus?.plateNumber ?? '',
      qrCodeValue:   ticket.qrCode ?? ticket.id,
      generatedAt:   new Date().toLocaleString('fr-FR'),
    };
    return this.storeWithPdfmeFallback(
      tenantId, 'ticket-a5', pdfmeData,
      async () => html,
      `tickets/${ticketId}`, DocumentType.TICKET_PDF, actor, 'A5',
    );
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

    const totalParcels = shipments.reduce((s, sh) => s + sh.parcels.length, 0);
    const totalWeight  = shipments.reduce((s, sh) => s + sh.totalWeight,    0);

    const passengerRows = travelers.map((t, i) => [
      String(i + 1),
      t.passengerName,
      t.seatNumber ?? '—',
      t.status,
      '',
    ]);
    const parcelRows = shipments.flatMap(sh =>
      sh.parcels.map(p => [p.trackingCode, p.destinationId, `${p.weight} kg`, p.status]),
    );

    const tenantLogo = await this.fetchTenantLogoDataUri(tenantId);
    const pdfmeData: Record<string, string> = {
      tenantLogo,
      tenantName:     tenant.name,
      tenantAddress:  '',
      tenantPhone:    '',
      tripId:         trip.id.slice(0, 12).toUpperCase(),
      routeName:      (trip as any).route?.name ?? '',
      origin:         (trip as any).route?.originId      ?? '',
      destination:    (trip as any).route?.destinationId ?? '',
      tripDate:       trip.departureScheduled.toLocaleString('fr-FR'),
      busPlate:       (trip as any).bus?.plateNumber ?? '—',
      driverName:     driver?.name ?? driver?.email ?? '—',
      passengerCount: String(travelers.length),
      parcelCount:    String(totalParcels),
      totalWeight:    String(totalWeight),
      passengerRows:  JSON.stringify(passengerRows.length ? passengerRows : [['—','Aucun passager','—','—','']]),
      parcelRows:     JSON.stringify(parcelRows.length    ? parcelRows    : [['—','Aucun colis','—','—']]),
      qrCodeValue:    `${process.env.PUBLIC_TRACKING_URL ?? 'https://track.translogpro.io'}/manifest/${trip.id}`,
      generatedAt:    new Date().toLocaleString('fr-FR'),
    };

    return this.storeWithPdfmeFallback(
      tenantId, 'manifest-a4', pdfmeData,
      async () => html,
      `manifests/${tripId}`, DocumentType.MANIFEST_HTML, actor, 'A4',
    );
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

    const recip = (parcel.recipientInfo ?? {}) as Record<string, unknown>;
    const tenantLogo = await this.fetchTenantLogoDataUri(tenantId);
    const pdfmeData: Record<string, string> = {
      tenantLogo,
      tenantName:       tenant.name,
      parcelRef:        parcel.id,
      trackingCode:     parcel.trackingCode,
      weight:           String(parcel.weight),
      dimensions:       (parcel as any).dimensions ?? '',
      senderName:       sender?.name ?? '',
      senderAddress:    '',
      senderPhone:      sender?.email ?? '',
      recipientName:    (recip.name    as string) ?? '',
      recipientAddress: (recip.address as string) ?? '',
      recipientPhone:   (recip.phone   as string) ?? '',
      origin:           '',
      destination:      (parcel as any).destination?.name ?? '',
      qrCodeValue:      `${process.env.PUBLIC_TRACKING_URL ?? 'https://track.translogpro.io'}/${parcel.trackingCode}`,
      generatedAt:      new Date().toLocaleString('fr-FR'),
    };
    return this.storeWithPdfmeFallback(
      tenantId, 'parcel-label', pdfmeData,
      async () => html,
      `labels/${parcelId}`, DocumentType.PARCEL_LABEL, actor, 'LABEL_62MM',
    );
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

    const firstParcel = (shipment.parcels as any[])[0] ?? {};
    const firstSender = senderMap.get(firstParcel.senderId) ?? null;
    const firstRecip  = (firstParcel.recipientInfo ?? {}) as Record<string, unknown>;
    const parcelRows  = (shipment.parcels as any[]).map(p => {
      const recip = (p.recipientInfo ?? {}) as Record<string, unknown>;
      return [
        p.trackingCode,
        (recip.description as string) ?? (recip.name as string) ?? '—',
        `${p.weight} kg`,
        p.status,
      ];
    });

    const tenantSettings = (tenant.settings ?? {}) as Record<string, unknown>;
    const tenantLogo = await this.fetchTenantLogoDataUri(tenantId);
    const pdfmeData: Record<string, string> = {
      tenantLogo,
      tenantName:       tenant.name,
      tenantAddress:    (tenantSettings.address as string) ?? '',
      tenantPhone:      (tenantSettings.phone   as string) ?? '',
      tenantNif:        (tenantSettings.nif     as string) ?? '',
      tenantRccm:       (tenantSettings.rccm    as string) ?? '',
      shipmentId:       shipment.id.slice(0, 12).toUpperCase(),
      shipmentDate:     shipment.createdAt.toLocaleDateString('fr-FR'),
      senderName:       firstSender?.name ?? '—',
      senderAddress:    '',
      senderPhone:      firstSender?.email ?? '',
      recipientName:    (firstRecip.name    as string) ?? '—',
      recipientAddress: (firstRecip.address as string) ?? '',
      recipientPhone:   (firstRecip.phone   as string) ?? '',
      origin:           (trip as any)?.route?.originId      ?? '—',
      destination:      (trip as any)?.route?.destinationId ?? shipment.destinationId,
      parcelCount:      String((shipment.parcels as any[]).length),
      totalWeight:      String(shipment.totalWeight),
      parcelRows:       JSON.stringify(parcelRows.length ? parcelRows : [['—','Aucun colis','—','—']]),
      qrCodeValue:      `${process.env.PUBLIC_TRACKING_URL ?? 'https://track.translogpro.io'}/shipment/${shipment.id}`,
      generatedAt:      new Date().toLocaleString('fr-FR'),
    };

    return this.storeWithPdfmeFallback(
      tenantId, 'packing-list-a4', pdfmeData,
      async () => html,
      `packing-lists/${shipmentId}`, DocumentType.PARCEL_LABEL, actor, 'A4',
    );
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

  // ─── POC Haute-Fidélité ──────────────────────────────────────────────────────

  /** Facture professionnelle avec talon détachable (format A4 Puppeteer) */
  async printInvoicePro(
    tenantId: string,
    ticketId: string,
    actor:    CurrentUserPayload,
    scope:    ScopeContext | undefined,
  ) {
    const ticket = await this.prisma.ticket.findFirst({ where: { id: ticketId, tenantId } });
    if (!ticket) throw new NotFoundException(`Ticket ${ticketId} introuvable`);

    const [tenant, trip] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
      this.prisma.trip.findUnique({ where: { id: ticket.tripId }, include: { route: true } }),
    ]);

    const ht        = Math.round(ticket.pricePaid / (1 + DEFAULT_TVA_RATE));
    const tvaRate   = DEFAULT_TVA_RATE;
    const s         = (tenant.settings ?? {}) as Record<string, unknown>;
    const dueAt     = new Date(Date.now() + 30 * 86400_000); // +30 jours

    const html = await renderInvoicePro({
      invoiceNumber: buildInvoiceNumber(ticketId),
      issuedAt:      ticket.createdAt,
      dueAt,
      client: {
        name:    ticket.passengerName,
        phone:   null,
        address: null,
        email:   null,
      },
      seller: {
        name:    tenant.name,
        address: (s.address as string) ?? null,
        phone:   (s.phone   as string) ?? null,
        email:   (s.email   as string) ?? null,
        nif:     (s.nif     as string) ?? null,
        rccm:    (s.rccm    as string) ?? null,
        bank:    (s.bank    as string) ?? null,
        iban:    (s.iban    as string) ?? null,
      },
      lines: [{
        description: `Transport voyageur — ${trip?.route?.name ?? 'Trajet'} — ${ticket.passengerName}`,
        quantity:    1,
        unitPriceHt: ht,
        tvaRate,
      }],
      currency: 'FCFA',
      notes:    null,
      actorId:  actor.id,
      scope,
    });

    const tvaAmt = Math.round(ticket.pricePaid - ht);
    const tenantLogo = await this.fetchTenantLogoDataUri(tenantId);
    const pdfmeData: Record<string, string> = {
      tenantLogo,
      tenantName:    tenant.name,
      tenantAddress: (s.address as string) ?? '',
      tenantPhone:   (s.phone   as string) ?? '',
      tenantNif:     (s.nif     as string) ?? '',
      tenantRccm:    (s.rccm    as string) ?? '',
      invoiceNumber: `INV-${ticket.id.slice(-8).toUpperCase()}`,
      invoiceDate:   new Date().toLocaleDateString('fr-FR'),
      clientName:    ticket.passengerName,
      clientAddress: '',
      clientPhone:   '',
      origin:        (trip as any)?.route?.originId      ?? '',
      destination:   (trip as any)?.route?.destinationId ?? '',
      tripDate:      (trip?.departureScheduled ?? new Date()).toLocaleDateString('fr-FR'),
      seatNumber:    (ticket as any).seatNumber ?? '—',
      priceHt:       String(ht),
      tvaRate:       String(Math.round(tvaRate * 100)),
      tvaAmount:     String(tvaAmt),
      totalTtc:      String(ticket.pricePaid),
      currency:      'FCFA',
      paymentMethod: 'Espèces',
      invoiceLines:  JSON.stringify([[
        `Transport — ${trip?.route?.name ?? 'Trajet'} — ${ticket.passengerName}`,
        '1',
        `${ht} FCFA`,
        `${ht} FCFA`,
      ]]),
      qrCodeValue:   ticket.qrCode ?? ticket.id,
      generatedAt:   new Date().toLocaleString('fr-FR'),
    };
    return this.storeWithPdfmeFallback(
      tenantId, 'invoice-a4', pdfmeData,
      async () => html,
      `poc/invoice-pro/${ticketId}`, DocumentType.INVOICE_HTML, actor, 'A4',
    );
  }

  /** Billet avec talon détachable boarding-pass style (format A5) */
  async printTicketStub(
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
        include: { route: true, bus: true },
      }),
    ]);

    const html = await renderTicketStub({
      ticket: {
        id:            ticket.id,
        passengerName: ticket.passengerName,
        seatNumber:    (ticket as any).seatNumber ?? null,
        pricePaid:     ticket.pricePaid,
        status:        ticket.status,
        qrToken:       ticket.qrCode,
        createdAt:     ticket.createdAt,
        expiresAt:     (ticket as any).expiresAt ?? null,
        class:         null,
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

    const depart  = trip?.departureScheduled ?? new Date();
    const boarding = new Date(depart.getTime() - 15 * 60_000);
    const tenantLogo = await this.fetchTenantLogoDataUri(tenantId);
    const pdfmeData: Record<string, string> = {
      tenantLogo,
      tenantName:   tenant.name,
      flightCode:   (trip as any)?.route?.code ?? (trip?.id ?? ticketId).slice(0, 8).toUpperCase(),
      passengerName: ticket.passengerName,
      origin:        (trip as any)?.route?.originId      ?? '',
      destination:   (trip as any)?.route?.destinationId ?? '',
      boardingDate:  depart.toLocaleDateString('fr-FR'),
      departureTime: depart.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      boardingTime:  boarding.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      class:         '—',
      gate:          '—',
      seatNumber:    (ticket as any).seatNumber ?? '—',
      zone:          '—',
      bookingRef:    ticket.id.slice(-8).toUpperCase(),
      qrCodeValue:   ticket.qrCode ?? ticket.id,
      barcodeValue:  ticket.id,
    };
    return this.storeWithPdfmeFallback(
      tenantId, 'boarding-pass-a6', pdfmeData,
      async () => html,
      `poc/ticket-stub/${ticketId}`, DocumentType.TICKET_PDF, actor, 'A5',
    );
  }

  /** Feuille multi-impression d'étiquettes (2×4 sur A4) */
  async printMultiLabel(
    tenantId:  string,
    parcelIds: string[],
    layout:    '2x4' | '2x2' = '2x4',
    actor:     CurrentUserPayload,
    scope:     ScopeContext | undefined,
  ) {
    const parcels = await this.prisma.parcel.findMany({
      where:   { id: { in: parcelIds }, tenantId },
      include: { destination: true },
    });

    const senderIds = [...new Set(parcels.map(p => p.senderId))];
    const senders   = senderIds.length > 0
      ? await this.prisma.user.findMany({
          where:  { id: { in: senderIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const senderMap = new Map(senders.map(s => [s.id, s]));

    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

    const items = parcels.map(p => ({
      trackingCode:  p.trackingCode,
      weight:        p.weight,
      price:         p.price,
      status:        p.status,
      createdAt:     p.createdAt,
      recipientInfo: p.recipientInfo as { name?: string; phone?: string; address?: string },
      sender:        senderMap.get(p.senderId) ?? null,
      destination:   (p as any).destination ?? null,
    }));

    const html = await renderMultiLabel({
      items,
      tenantName: tenant.name,
      layout,
      actorId:    actor.id,
      scope,
    });

    const trackingBase = process.env.PUBLIC_TRACKING_URL ?? 'https://track.translogpro.io';
    const pdfmeData: Record<string, string> = {
      tenantName:  tenant.name,
      shipmentId:  parcelIds[0]?.slice(0, 12).toUpperCase() ?? '—',
      generatedAt: new Date().toLocaleString('fr-FR'),
    };
    for (let i = 0; i < 8; i++) {
      const idx = i + 1;
      const it  = items[i];
      const recip = (it?.recipientInfo ?? {}) as Record<string, string | undefined>;
      pdfmeData[`label_${idx}_tracking`]    = it?.trackingCode ?? '';
      pdfmeData[`label_${idx}_weight`]      = it ? `${it.weight} kg` : '';
      pdfmeData[`label_${idx}_sender`]      = it?.sender?.name ?? '';
      pdfmeData[`label_${idx}_recipient`]   = recip.name ?? '';
      pdfmeData[`label_${idx}_address`]     = recip.address ?? '';
      pdfmeData[`label_${idx}_destination`] = (it as any)?.destination?.name ?? '';
      pdfmeData[`label_${idx}_qr`]          = it ? `${trackingBase}/${it.trackingCode}` : '';
    }

    return this.storeWithPdfmeFallback(
      tenantId, 'parcel-label-multi', pdfmeData,
      async () => html,
      `poc/multi-label/${Date.now()}`,
      DocumentType.PARCEL_LABEL, actor, 'A4',
    );
  }

  /** Enveloppe C5 ou DL avec fenêtre destinataire */
  async printEnvelope(
    tenantId:  string,
    shipmentId: string,
    format:    'C5' | 'DL' = 'C5',
    actor:     CurrentUserPayload,
    scope:     ScopeContext | undefined,
  ) {
    const shipment = await this.prisma.shipment.findFirst({
      where: { id: shipmentId, tenantId },
    });
    if (!shipment) throw new NotFoundException(`Shipment ${shipmentId} introuvable`);

    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const s      = (tenant.settings ?? {}) as Record<string, unknown>;

    // La destination du shipment sert de destinataire
    const station = await this.prisma.station.findFirst({
      where: { id: shipment.destinationId },
    }).catch(() => null);

    const html = await renderEnvelope({
      recipient: {
        name:    station?.name ?? shipment.destinationId,
        address: (station as any)?.address ?? 'Adresse à compléter',
        city:    (station as any)?.city ?? '—',
      },
      sender: {
        name:    tenant.name,
        address: (s.address as string) ?? '',
        city:    (s.city    as string) ?? '',
      },
      reference:  shipment.id.slice(0, 12).toUpperCase(),
      format,
      tenantName: tenant.name,
      actorId:    actor.id,
      scope,
    });

    const printFmt = format === 'C5' ? 'ENVELOPE_C5' as PrintFormat : 'ENVELOPE_C5' as PrintFormat;
    const slug = format === 'DL' ? 'envelope-dl' : 'envelope-c5';
    const pdfmeData: Record<string, string> = {
      tenantName:       tenant.name,
      reference:        shipment.id.slice(0, 12).toUpperCase(),
      senderName:       tenant.name,
      senderAddress:    (s.address as string) ?? '',
      senderCity:       (s.city    as string) ?? '',
      senderZip:        (s.zip     as string) ?? '',
      recipientName:    station?.name ?? shipment.destinationId,
      recipientAddress: (station as any)?.address ?? 'Adresse à compléter',
      recipientCity:    (station as any)?.city ?? '',
      recipientZip:     (station as any)?.zip  ?? '',
      recipientCountry: (station as any)?.country ?? '',
      qrCodeValue:      `${process.env.PUBLIC_TRACKING_URL ?? 'https://track.translogpro.io'}/shipment/${shipment.id}`,
      generatedAt:      new Date().toLocaleString('fr-FR'),
    };
    return this.storeWithPdfmeFallback(
      tenantId, slug, pdfmeData,
      async () => html,
      `poc/envelope/${shipmentId}`,
      DocumentType.PARCEL_LABEL, actor, printFmt,
    );
  }

  // ─── Talon bagage QR ────────────────────────────────────────────────────────

  /**
   * Génère le talon bagage physique (format 99×210mm, bande verticale).
   * ticketId = billet du passager auquel appartient ce bagage.
   * bagIndex / totalBags : "1 / 2", "2 / 2"…
   */
  async printBaggageTag(
    tenantId:   string,
    ticketId:   string,
    bagIndex:   number,
    totalBags:  number,
    weightKg:   number,
    description: string | null,
    actor:      CurrentUserPayload,
    scope:      ScopeContext | undefined,
  ) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: ticketId, tenantId },
    });
    if (!ticket) throw new NotFoundException(`Ticket ${ticketId} introuvable`);

    // Récupérer passager et trajet
    const traveler = await this.prisma.traveler.findFirst({
      where: { id: (ticket as any).travelerId },
    }).catch(() => null);

    const trip = await this.prisma.trip.findFirst({
      where:   { id: (ticket as any).tripId },
      include: {
        route: true,
        bus:   { select: { plateNumber: true, model: true } },
      },
    }).catch(() => null);

    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

    const trackingCode = `${tenantId.slice(0, 4).toUpperCase()}-BAG-${ticketId.slice(-6).toUpperCase()}-${bagIndex}`;

    const html = await renderBaggageTag({
      tag: {
        trackingCode,
        weight:      weightKg,
        bagNumber:   bagIndex,
        totalBags,
        description,
      },
      passenger: {
        name:     traveler
          ? `${(traveler as any).firstName ?? ''} ${(traveler as any).lastName ?? ''}`.trim()
          : 'Passager inconnu',
        phone:    (traveler as any)?.phone ?? null,
        ticketId: ticket.id,
      },
      trip: {
        id:                  trip?.id ?? 'N/A',
        departureScheduled:  (trip as any)?.departureScheduled ?? new Date(),
        origin:              (trip?.route as any)?.originId    ?? 'Origine',
        destination:         (trip?.route as any)?.destinationId ?? 'Destination',
        routeName:           (trip?.route as any)?.name        ?? null,
        busPlate:            (trip?.bus  as any)?.plateNumber  ?? null,
      },
      tenantName: tenant.name,
      actorId:    actor.id,
      scope,
    });

    const tenantLogo = await this.fetchTenantLogoDataUri(tenantId);
    const pdfmeData: Record<string, string> = {
      tenantLogo,
      tenantName:    tenant.name,
      trackingCode,
      weight:        String(weightKg),
      bagNumber:     String(bagIndex),
      totalBags:     String(totalBags),
      bagDescription:description ?? '',
      passengerName: html.includes('Passager inconnu') ? 'Passager inconnu' : ticket.passengerName,
      passengerPhone:'',
      ticketRef:     ticket.id,
      origin:        (trip?.route as any)?.originId      ?? '',
      destination:   (trip?.route as any)?.destinationId ?? '',
      tripDate:      (trip as any)?.departureScheduled
                       ? new Date((trip as any).departureScheduled).toLocaleString('fr-FR')
                       : '',
      busPlate:      (trip?.bus as any)?.plateNumber ?? '',
      qrCodeValue:   trackingCode,
      generatedAt:   new Date().toLocaleString('fr-FR'),
    };
    return this.storeWithPdfmeFallback(
      tenantId, 'baggage-tag', pdfmeData,
      async () => html,
      `poc/baggage-tag/${ticketId}-${bagIndex}`,
      DocumentType.TICKET_PDF, actor, 'BAGGAGE_TAG',
    );
  }

  /**
   * Récupère le logo tenant (tenant_brands.logoUrl) en tant que data URI base64.
   * Retourne '' si absent ou inaccessible — jamais d'exception (regression-free).
   */
  private async fetchTenantLogoDataUri(tenantId: string): Promise<string> {
    try {
      const brand = await this.prisma.tenantBrand.findUnique({
        where:  { tenantId },
        select: { logoUrl: true },
      });
      const url = brand?.logoUrl;
      if (!url) return '';
      // Déjà en data URI ?
      if (url.startsWith('data:')) return url;
      // URL HTTP(S) → fetch avec timeout
      if (url.startsWith('http://') || url.startsWith('https://')) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 3000);
        try {
          const res = await fetch(url, { signal: ctrl.signal });
          if (!res.ok) return '';
          const mime = res.headers.get('content-type') ?? 'image/png';
          const buf  = Buffer.from(await res.arrayBuffer());
          return `data:${mime};base64,${buf.toString('base64')}`;
        } finally {
          clearTimeout(timer);
        }
      }
      // Clé MinIO relative
      const buf = await this.storage.getObject(tenantId, url);
      const mime = url.endsWith('.svg') ? 'image/svg+xml'
                 : url.endsWith('.jpg') || url.endsWith('.jpeg') ? 'image/jpeg'
                 : 'image/png';
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch (e) {
      this.logger.warn(`Logo tenant indisponible (${tenantId}): ${(e as Error).message}`);
      return '';
    }
  }

  // ─── Helper pdfme : template personnalisé → PDF ─────────────────────────────

  /**
   * Cherche si le tenant a un template pdfme (engine=PDFME) pour ce slug.
   * Si oui : génère le PDF via @pdfme/generator.
   * Si non : retourne null (l'appelant doit fallback vers Puppeteer).
   *
   * @param tenantId  ID du tenant
   * @param slug      Identifiant du template : "invoice-a4", "ticket-a5", "baggage-tag"…
   * @param data      Toutes les variables disponibles (tenant + document)
   */
  private async tryPdfmeRender(
    tenantId: string,
    slug:     string,
    data:     PdfmeInputRecord,
  ): Promise<Buffer | null> {
    const resolved = await this.templates.resolvePdfmeSchema(tenantId, slug);
    if (!resolved) return null;

    const inputs = this.pdfme.buildInputs(resolved.schemaJson, data);
    return this.pdfme.render(resolved.schemaJson, inputs);
  }

  /**
   * Génère le PDF via pdfme (si template disponible) ou Puppeteer (fallback HTML).
   * Stocke dans MinIO et retourne la URL de téléchargement.
   */
  private async storeWithPdfmeFallback(
    tenantId:     string,
    slug:         string,
    data:         PdfmeInputRecord,
    htmlFallback: () => Promise<string>,
    subPath:      string,
    docType:      DocumentType,
    actor:        CurrentUserPayload,
    format:       PrintFormat = 'A4',
  ) {
    // 1. Essayer le template pdfme personnalisé
    const pdfBuffer = await this.tryPdfmeRender(tenantId, slug, data);
    if (pdfBuffer) {
      return this.storeBufferAsPdf(tenantId, pdfBuffer, subPath, docType, actor);
    }

    // 2. Fallback Puppeteer
    const html = await htmlFallback();
    return this.storeAsPdf(tenantId, html, subPath, docType, actor, format);
  }

  /**
   * Stocke un buffer PDF déjà généré (par pdfme).
   */
  private async storeBufferAsPdf(
    tenantId: string,
    buffer:   Buffer,
    subPath:  string,
    docType:  DocumentType,
    actor:    CurrentUserPayload,
  ) {
    const ts          = Date.now();
    const key         = `${tenantId}/documents/${subPath}/${ts}.pdf`;
    const fingerprint = createHash('sha256').update(buffer).digest('hex');

    await this.storage.putObject(tenantId, key, buffer, 'application/pdf');
    const downloadInfo = await this.storage.getDownloadUrl(tenantId, key, docType);

    this.logger.log(
      `[Documents/pdfme] ${docType} key=${key} actor=${actor.id} fp=${fingerprint.slice(0, 16)}… size=${buffer.length}B`,
    );

    return {
      storageKey:  key,
      downloadUrl: downloadInfo.url,
      expiresAt:   downloadInfo.expiresAt,
      fingerprint,
      generatedAt: new Date(ts),
      actorId:     actor.id,
      engine:      'PDFME',
      sizeBytes:   buffer.length,
    };
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
