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
import { docLabels }         from './renderers/doc-i18n';

// TVA par défaut UEMOA — utilisé uniquement si TenantBusinessConfig n'existe pas
const DEFAULT_TVA_RATE = 0.18;

/** Résolution TVA : route override > tenant config > fallback 18 % */
interface TvaConfig { enabled: boolean; rate: number; }

/** Registre fiscal configurable par pays ({label: "NIU", value: "CG-..."}) */
interface FiscalRegistry { label: string; value: string; }

/** ISO 4217 → nom d'affichage courant sur les documents */
const CURRENCY_DISPLAY: Record<string, string> = {
  XAF: 'FCFA', XOF: 'FCFA', USD: 'USD', EUR: 'EUR', GBP: 'GBP',
  MAD: 'MAD', TND: 'TND', NGN: 'NGN', KES: 'KES', ZAR: 'ZAR',
};
function displayCurrency(iso: string): string {
  return CURRENCY_DISPLAY[iso] ?? iso;
}

/** Champs Tenant nécessaires pour la génération de documents */
const TENANT_DOC_SELECT = {
  id: true, name: true, slug: true,
  country: true, city: true, language: true, currency: true,
  address: true, phoneNumber: true, email: true,
  website: true, taxId: true, rccm: true,
  fiscalRegistries: true,
} as const;

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

  // ─── TVA resolution ─────────────────────────────────────────────────────────

  /** Résout la config TVA : route override > tenant config > fallback 18 % */
  private async resolveTva(tenantId: string, routeTvaOverride?: number | null): Promise<TvaConfig> {
    const bc = await this.prisma.tenantBusinessConfig.findUnique({
      where: { tenantId },
    });
    if (!bc || !(bc as any).tvaEnabled) return { enabled: false, rate: 0 };
    return { enabled: true, rate: routeTvaOverride ?? (bc as any).tvaRate };
  }

  // ─── Billet voyageur ────────────────────────────────────────────────────────

  async printTicket(
    tenantId:  string,
    ticketId:  string,
    actor:     CurrentUserPayload,
    scope:     ScopeContext | undefined,
  ) {
    const ticket = await this.prisma.ticket.findFirst({ where: { id: ticketId, tenantId } });
    if (!ticket) throw new NotFoundException(`Ticket ${ticketId} introuvable`);

    const [tenant, trip, bStation, aStation] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: TENANT_DOC_SELECT }),
      this.prisma.trip.findUnique({
        where:   { id: ticket.tripId },
        include: { route: { include: { origin: true, destination: true } }, bus: true },
      }),
      this.prisma.station.findUnique({ where: { id: (ticket as any).boardingStationId }, select: { name: true, city: true } }),
      this.prisma.station.findUnique({ where: { id: (ticket as any).alightingStationId }, select: { name: true, city: true } }),
    ]);

    const originCity = trip?.route?.origin?.city || trip?.route?.origin?.name || '—';
    const destCity   = trip?.route?.destination?.city || trip?.route?.destination?.name || '—';

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

    const depart   = trip?.departureScheduled ?? new Date();
    const arrival  = trip?.arrivalScheduled   ?? new Date();
    const boarding = new Date(depart.getTime() - 15 * 60_000);
    const cur      = displayCurrency(tenant.currency ?? 'XAF');
    const tenantLogo = await this.fetchTenantLogoDataUri(tenantId);
    const pdfmeData: Record<string, string> = {
      // ── Tenant ──
      tenantLogo,
      tenantName:    tenant.name,
      tenantSlug:    tenant.slug,
      tenantAddress: tenant.address ?? '',
      tenantPhone:   tenant.phoneNumber ?? '',
      tenantEmail:   tenant.email ?? '',
      tenantWebsite: tenant.website ?? '',
      tenantNif:     tenant.taxId ?? '',
      tenantRccm:    tenant.rccm ?? '',
      tenantCountry: tenant.country ?? '',
      tenantCurrency: cur,
      // ── Ticket ──
      ticketRef:     ticket.id,
      ticketStatus:  ticket.status,
      passengerName: ticket.passengerName,
      seatNumber:    ticket.seatNumber ?? '—',
      fareClass:     (ticket as any).fareClass ?? 'STANDARD',
      price:         String(ticket.pricePaid),
      currency:      cur,
      boardingStation:  bStation?.name ?? originCity,
      boardingCity:     bStation?.city ?? '',
      alightingStation: aStation?.name ?? destCity,
      alightingCity:    aStation?.city ?? '',
      ticketCreatedAt:  ticket.createdAt.toLocaleString('fr-FR'),
      ticketExpiresAt:  ticket.expiresAt ? ticket.expiresAt.toLocaleString('fr-FR') : '',
      // ── Trip / Route ──
      origin:        originCity,
      destination:   destCity,
      originStation: trip?.route?.origin?.name ?? '',
      destStation:   trip?.route?.destination?.name ?? '',
      tripDate:      depart.toLocaleString('fr-FR'),
      departureTime: depart.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      arrivalTime:   arrival.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      boardingDate:  depart.toLocaleDateString('fr-FR'),
      boardingTime:  boarding.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      routeName:     (trip as any)?.route?.name ?? '',
      distanceKm:    trip?.route?.distanceKm ? `${trip.route.distanceKm} km` : '',
      // ── Bus ──
      busPlate:      (trip as any)?.bus?.plateNumber ?? '',
      busModel:      (trip as any)?.bus?.model ?? '',
      busType:       (trip as any)?.bus?.type ?? '',
      busCapacity:   (trip as any)?.bus?.capacity ? String((trip as any).bus.capacity) : '',
      // ── System ──
      qrCodeValue:   ticket.qrCode ?? ticket.id,
      generatedAt:   new Date().toLocaleString('fr-FR'),
    };
    const ticketSlug = await this.templates.resolveDefaultSlug(tenantId, 'TICKET', 'ticket-a5');
    return this.storeWithPdfmeFallback(
      tenantId, ticketSlug, pdfmeData,
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
        route:     { include: { origin: true, destination: true } },
        bus:       true,
        travelers: true,
        shipments: { include: { parcels: true, destination: true } },
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

    // Résoudre les noms des gares de descente des voyageurs
    const dropOffIds = [...new Set((trip.travelers as any[]).map(t => t.dropOffStationId).filter(Boolean))];
    const dropOffStations = dropOffIds.length > 0
      ? await this.prisma.station.findMany({ where: { id: { in: dropOffIds } }, select: { id: true, name: true, city: true } })
      : [];
    const dropOffMap = new Map(dropOffStations.map(s => [s.id, s]));

    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: TENANT_DOC_SELECT });

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

    const originStation = (trip as any).route?.origin;
    const destStation   = (trip as any).route?.destination;
    const originCity    = originStation?.city || originStation?.name || '';
    const destCity      = destStation?.city   || destStation?.name   || '';
    const cur           = displayCurrency(tenant.currency ?? 'XAF');

    const tenantLogo = await this.fetchTenantLogoDataUri(tenantId);
    const pdfmeData: Record<string, string> = {
      // ── Tenant ──
      tenantLogo,
      tenantName:     tenant.name,
      tenantSlug:     tenant.slug,
      tenantAddress:  tenant.address ?? '',
      tenantPhone:    tenant.phoneNumber ?? '',
      tenantEmail:    tenant.email ?? '',
      tenantWebsite:  tenant.website ?? '',
      tenantNif:      tenant.taxId ?? '',
      tenantRccm:     tenant.rccm ?? '',
      tenantCountry:  tenant.country ?? '',
      tenantCurrency: cur,
      // ── Trip ──
      tripId:         trip.id.slice(0, 12).toUpperCase(),
      tripIdFull:     trip.id,
      tripStatus:     trip.status,
      routeName:      (trip as any).route?.name ?? '',
      distanceKm:     (trip as any).route?.distanceKm ? `${(trip as any).route.distanceKm} km` : '',
      origin:         originCity,
      destination:    destCity,
      originStation:  originStation?.name ?? '',
      destStation:    destStation?.name ?? '',
      tripDate:       trip.departureScheduled.toLocaleString('fr-FR'),
      departureTime:  trip.departureScheduled.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      arrivalDate:    trip.arrivalScheduled.toLocaleString('fr-FR'),
      arrivalTime:    trip.arrivalScheduled.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      // ── Bus ──
      busPlate:       (trip as any).bus?.plateNumber ?? '—',
      busModel:       (trip as any).bus?.model ?? '',
      busType:        (trip as any).bus?.type ?? '',
      busCapacity:    (trip as any).bus?.capacity ? String((trip as any).bus.capacity) : '',
      // ── Driver ──
      driverName:     driver?.name ?? driver?.email ?? '—',
      driverEmail:    driver?.email ?? '',
      // ── Passengers ──
      passengerCount: String(travelers.length),
      passengerRows:  JSON.stringify(passengerRows.length ? passengerRows : [['—','Aucun passager','—','—','']]),
      // ── Shipments / Parcels ──
      parcelCount:    String(totalParcels),
      totalWeight:    String(totalWeight),
      parcelRows:     JSON.stringify(parcelRows.length    ? parcelRows    : [['—','Aucun colis','—','—']]),
      // ── System ──
      qrCodeValue:    `${process.env.PUBLIC_TRACKING_URL ?? 'https://track.translogpro.io'}/manifest/${trip.id}`,
      generatedAt:    new Date().toLocaleString('fr-FR'),
    };

    const manifestSlug = await this.templates.resolveDefaultSlug(tenantId, 'MANIFEST', 'manifest-a4');
    return this.storeWithPdfmeFallback(
      tenantId, manifestSlug, pdfmeData,
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

    const sender = parcel.senderId
      ? await this.prisma.user.findUnique({ where: { id: parcel.senderId } })
      : null;
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: TENANT_DOC_SELECT });
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
    const cur   = displayCurrency(tenant.currency ?? 'XAF');
    const tenantLogo = await this.fetchTenantLogoDataUri(tenantId);
    const pdfmeData: Record<string, string> = {
      // ── Tenant ──
      tenantLogo,
      tenantName:       tenant.name,
      tenantAddress:    tenant.address ?? '',
      tenantPhone:      tenant.phoneNumber ?? '',
      tenantEmail:      tenant.email ?? '',
      tenantNif:        tenant.taxId ?? '',
      tenantRccm:       tenant.rccm ?? '',
      tenantCountry:    tenant.country ?? '',
      tenantCurrency:   cur,
      // ── Parcel ──
      parcelRef:        parcel.id,
      trackingCode:     parcel.trackingCode,
      parcelStatus:     parcel.status,
      weight:           String(parcel.weight),
      price:            String(parcel.price),
      priceFmt:         `${parcel.price} ${cur}`,
      dimensions:       (parcel as any).dimensions ?? '',
      parcelCreatedAt:  parcel.createdAt.toLocaleString('fr-FR'),
      // ── Sender ──
      senderName:       sender?.name ?? '',
      senderEmail:      sender?.email ?? '',
      senderAddress:    '',
      senderPhone:      sender?.email ?? '',
      // ── Recipient ──
      recipientName:    (recip.name    as string) ?? '',
      recipientAddress: (recip.address as string) ?? '',
      recipientPhone:   (recip.phone   as string) ?? '',
      // ── Destination ──
      destination:      (parcel as any).destination?.name ?? '',
      destinationCity:  (parcel as any).destination?.city ?? '',
      // ── System ──
      qrCodeValue:      `${trackingBase}/${parcel.trackingCode}`,
      generatedAt:      new Date().toLocaleString('fr-FR'),
    };
    const labelSlug = await this.templates.resolveDefaultSlug(tenantId, 'LABEL', 'parcel-label');
    return this.storeWithPdfmeFallback(
      tenantId, labelSlug, pdfmeData,
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
        parcels:     true,
        destination: true,
        trip:        { include: { route: { include: { origin: true, destination: true } }, bus: true } },
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

    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: TENANT_DOC_SELECT });
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

    const shipDest    = (shipment as any).destination;
    const routeOrigin = (trip as any)?.route?.origin;
    const routeDest   = (trip as any)?.route?.destination;
    const cur         = displayCurrency(tenant.currency ?? 'XAF');

    const tenantLogo = await this.fetchTenantLogoDataUri(tenantId);
    const pdfmeData: Record<string, string> = {
      // ── Tenant ──
      tenantLogo,
      tenantName:       tenant.name,
      tenantSlug:       tenant.slug,
      tenantAddress:    tenant.address ?? '',
      tenantPhone:      tenant.phoneNumber ?? '',
      tenantEmail:      tenant.email ?? '',
      tenantNif:        tenant.taxId ?? '',
      tenantRccm:       tenant.rccm ?? '',
      tenantCountry:    tenant.country ?? '',
      tenantCurrency:   cur,
      // ── Shipment ──
      shipmentId:       shipment.id.slice(0, 12).toUpperCase(),
      shipmentIdFull:   shipment.id,
      shipmentDate:     shipment.createdAt.toLocaleDateString('fr-FR'),
      shipmentStatus:   shipment.status,
      totalWeight:      String(shipment.totalWeight),
      parcelCount:      String((shipment.parcels as any[]).length),
      // ── Destination ──
      destination:      shipDest?.name ?? shipment.destinationId,
      destinationCity:  shipDest?.city ?? '',
      // ── Route / Trip ──
      origin:           routeOrigin?.city || routeOrigin?.name || '—',
      originStation:    routeOrigin?.name ?? '',
      destStation:      routeDest?.name ?? '',
      routeName:        (trip as any)?.route?.name ?? '',
      tripDate:         trip?.departureScheduled ? trip.departureScheduled.toLocaleString('fr-FR') : '',
      busPlate:         (trip as any)?.bus?.plateNumber ?? '',
      busModel:         (trip as any)?.bus?.model ?? '',
      // ── First sender / recipient ──
      senderName:       firstSender?.name ?? '—',
      senderEmail:      firstSender?.email ?? '',
      senderAddress:    '',
      senderPhone:      firstSender?.email ?? '',
      recipientName:    (firstRecip.name    as string) ?? '—',
      recipientAddress: (firstRecip.address as string) ?? '',
      recipientPhone:   (firstRecip.phone   as string) ?? '',
      // ── Parcel rows ──
      parcelRows:       JSON.stringify(parcelRows.length ? parcelRows : [['—','Aucun colis','—','—']]),
      // ── System ──
      qrCodeValue:      `${process.env.PUBLIC_TRACKING_URL ?? 'https://track.translogpro.io'}/shipment/${shipment.id}`,
      generatedAt:      new Date().toLocaleString('fr-FR'),
    };

    const packingSlug = await this.templates.resolveDefaultSlug(tenantId, 'PACKING_LIST', 'packing-list-a4');
    return this.storeWithPdfmeFallback(
      tenantId, packingSlug, pdfmeData,
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

    const sender      = parcel.senderId
      ? await this.prisma.user.findUnique({ where: { id: parcel.senderId } })
      : null;
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

    const [tenant, trip, tva] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: TENANT_DOC_SELECT }),
      this.prisma.trip.findUnique({
        where: { id: ticket.tripId },
        include: { route: { include: { origin: true, destination: true } } },
      }),
      this.resolveTva(tenantId),
    ]);

    const routeTvaOverride = (trip?.route as any)?.tvaOverrideRate ?? null;
    const effectiveTva: TvaConfig = routeTvaOverride != null
      ? { enabled: tva.enabled, rate: routeTvaOverride }
      : tva;

    // Si TVA activée : pricePaid = TTC → extraire HT. Sinon : prix net = montant affiché.
    const tvaRate   = effectiveTva.enabled ? effectiveTva.rate : 0;
    const ht        = effectiveTva.enabled ? Math.round(ticket.pricePaid / (1 + tvaRate)) : ticket.pricePaid;
    const dueAt     = new Date(Date.now() + 30 * 86400_000);

    const originCity = trip?.route?.origin?.city || trip?.route?.origin?.name || '—';
    const destCity   = trip?.route?.destination?.city || trip?.route?.destination?.name || '—';
    const registries = (tenant.fiscalRegistries ?? []) as unknown as FiscalRegistry[];
    const lang       = tenant.language ?? 'fr';
    const cur        = displayCurrency(tenant.currency ?? 'XAF');
    const i          = docLabels(lang);

    const html = await renderInvoicePro({
      invoiceNumber: buildInvoiceNumber(ticketId),
      issuedAt:      ticket.createdAt,
      dueAt,
      tvaEnabled:    effectiveTva.enabled,
      lang,
      client: {
        name:    ticket.passengerName,
        phone:   null,
        address: null,
        email:   null,
      },
      seller: {
        name:           tenant.name,
        address:        tenant.address     ?? null,
        phone:          tenant.phoneNumber ?? null,
        email:          tenant.email       ?? null,
        fiscalRegistries: registries,
        bank:           null,
        iban:           null,
      },
      lines: [{
        description: `Transport voyageur — ${trip?.route?.name ?? 'Trajet'} — ${ticket.passengerName}`,
        quantity:    1,
        unitPriceHt: ht,
        tvaRate,
      }],
      currency: cur,
      notes:    null,
      actorId:  actor.id,
      scope,
    });

    const tvaAmt = effectiveTva.enabled ? Math.round(ticket.pricePaid - ht) : 0;
    const tenantLogo = await this.fetchTenantLogoDataUri(tenantId);
    const registriesStr = registries.map(r => `${r.label} : ${r.value}`).join('\n');

    const localeFmt = lang === 'en' ? 'en-GB' : 'fr-FR';
    const pdfmeData: Record<string, string> = {
      // ── Tenant ──
      tenantLogo,
      tenantName:    tenant.name,
      tenantSlug:    tenant.slug,
      tenantAddress: tenant.address     ?? '',
      tenantPhone:   tenant.phoneNumber ?? '',
      tenantEmail:   tenant.email       ?? '',
      tenantWebsite: tenant.website     ?? '',
      tenantNif:     registriesStr,
      tenantRccm:    tenant.rccm ?? '',
      tenantCountry: tenant.country ?? '',
      tenantCurrency: cur,
      tenantContact: [tenant.address, tenant.phoneNumber ? `${i.bank === 'Bank' ? 'Tel' : 'Tél'} : ${tenant.phoneNumber}` : '', tenant.email].filter(Boolean).join('\n'),
      // ── Invoice ──
      invoiceNumber: `INV-${ticket.id.slice(-8).toUpperCase()}`,
      invoiceDate:   new Date().toLocaleDateString(localeFmt),
      // ── Client / Passenger ──
      clientName:    ticket.passengerName,
      clientAddress: '',
      clientPhone:   '',
      passengerName: ticket.passengerName,
      ticketRef:     ticket.id,
      ticketStatus:  ticket.status,
      seatNumber:    ticket.seatNumber ?? '—',
      fareClass:     (ticket as any).fareClass ?? 'STANDARD',
      // ── Trip / Route ──
      origin:        originCity,
      destination:   destCity,
      originStation: trip?.route?.origin?.name ?? '',
      destStation:   trip?.route?.destination?.name ?? '',
      routeName:     trip?.route?.name ?? '',
      distanceKm:    trip?.route?.distanceKm ? `${trip.route.distanceKm} km` : '',
      tripDate:      (trip?.departureScheduled ?? new Date()).toLocaleDateString(localeFmt),
      departureTime: (trip?.departureScheduled ?? new Date()).toLocaleTimeString(localeFmt, { hour: '2-digit', minute: '2-digit' }),
      arrivalTime:   (trip?.arrivalScheduled ?? new Date()).toLocaleTimeString(localeFmt, { hour: '2-digit', minute: '2-digit' }),
      // ── Montants ──
      price:         String(ticket.pricePaid),
      priceHt:       String(ht),
      tvaRate:       effectiveTva.enabled ? String(Math.round(tvaRate * 100)) : '0',
      tvaAmount:     String(tvaAmt),
      totalTtc:      `${ticket.pricePaid} ${cur}`,
      totalHtValue:  effectiveTva.enabled ? `${ht} ${cur}` : '',
      tvaValue:      effectiveTva.enabled ? `${tvaAmt} ${cur}` : '',
      currency:      cur,
      paymentMethod: 'Espèces',
      tvaEnabled:    effectiveTva.enabled ? 'true' : 'false',
      invoiceLines:  JSON.stringify([[
        `Transport — ${trip?.route?.name ?? 'Trajet'} — ${ticket.passengerName}`,
        '1',
        `${ht} ${cur}`,
        `${ticket.pricePaid} ${cur}`,
      ]]),
      // ── System ──
      qrCodeValue:   ticket.qrCode ?? ticket.id,
      qrCode:        ticket.qrCode ?? ticket.id,
      generatedAt:   new Date().toLocaleString('fr-FR'),
    };
    const invoiceSlug = await this.templates.resolveDefaultSlug(tenantId, 'INVOICE', 'invoice-a4');
    return this.storeWithPdfmeFallback(
      tenantId, invoiceSlug, pdfmeData,
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

    const [tenant, trip, brand, bStation, aStation] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: TENANT_DOC_SELECT }),
      this.prisma.trip.findUnique({
        where:   { id: ticket.tripId },
        include: { route: { include: { origin: true, destination: true } }, bus: true },
      }),
      this.prisma.tenantBrand.findUnique({
        where:  { tenantId },
        select: { brandName: true, primaryColor: true, secondaryColor: true },
      }),
      this.prisma.station.findUnique({ where: { id: (ticket as any).boardingStationId }, select: { name: true } }),
      this.prisma.station.findUnique({ where: { id: (ticket as any).alightingStationId }, select: { name: true } }),
    ]);

    const originCity = trip?.route?.origin?.city || trip?.route?.origin?.name || '—';
    const destCity   = trip?.route?.destination?.city || trip?.route?.destination?.name || '—';

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
        class:         (ticket as any).fareClass ?? null,
        boardingStationName:  bStation?.name ?? null,
        alightingStationName: aStation?.name ?? null,
      },
      trip: {
        id:                 trip?.id ?? ticket.tripId,
        departureScheduled: trip?.departureScheduled ?? new Date(),
        arrivalScheduled:   trip?.arrivalScheduled   ?? new Date(),
        route: trip?.route ? {
          name:          trip.route.name,
          originCity,
          destinationCity: destCity,
        } : null,
        bus:                (trip as any)?.bus   ?? null,
      },
      tenantName:     brand?.brandName ?? tenant.name,
      tenantSlug:     tenant.slug,
      primaryColor:   brand?.primaryColor   ?? '#0d9488',
      secondaryColor: brand?.secondaryColor ?? '#0f766e',
      actorId:    actor.id,
      scope,
    });

    const depart   = trip?.departureScheduled ?? new Date();
    const arrival  = trip?.arrivalScheduled   ?? new Date();
    const boarding = new Date(depart.getTime() - 15 * 60_000);
    const cur      = displayCurrency(tenant.currency ?? 'XAF');
    const tenantLogo = await this.fetchTenantLogoDataUri(tenantId);
    const pdfmeData: Record<string, string> = {
      // ── Tenant ──
      tenantLogo,
      tenantName:    brand?.brandName ?? tenant.name,
      tenantSlug:    tenant.slug,
      tenantAddress: tenant.address ?? '',
      tenantPhone:   tenant.phoneNumber ?? '',
      tenantEmail:   tenant.email ?? '',
      tenantNif:     tenant.taxId ?? '',
      tenantRccm:    tenant.rccm ?? '',
      tenantCountry: tenant.country ?? '',
      tenantCurrency: cur,
      // ── Ticket ──
      ticketRef:     ticket.id,
      ticketStatus:  ticket.status,
      bookingRef:    ticket.id.slice(-8).toUpperCase(),
      passengerName: ticket.passengerName,
      seatNumber:    (ticket as any).seatNumber ?? '—',
      fareClass:     (ticket as any).fareClass || 'STANDARD',
      class:         (ticket as any).fareClass || '—',
      price:         String(ticket.pricePaid),
      currency:      cur,
      ticketCreatedAt: ticket.createdAt.toLocaleString('fr-FR'),
      ticketExpiresAt: (ticket as any).expiresAt ? new Date((ticket as any).expiresAt).toLocaleString('fr-FR') : '',
      // ── Stations ──
      boardingStation:  bStation?.name ?? originCity,
      alightingStation: aStation?.name ?? destCity,
      // ── Trip / Route ──
      flightCode:    (trip as any)?.route?.code ?? (trip?.id ?? ticketId).slice(0, 8).toUpperCase(),
      origin:        originCity,
      destination:   destCity,
      routeOrigin:   originCity,
      routeDest:     destCity,
      originStation: trip?.route?.origin?.name ?? '',
      destStation:   trip?.route?.destination?.name ?? '',
      routeName:     trip?.route?.name ?? '',
      distanceKm:    trip?.route?.distanceKm ? `${trip.route.distanceKm} km` : '',
      boardingDate:  depart.toLocaleDateString('fr-FR'),
      departureTime: depart.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      arrivalTime:   arrival.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      boardingTime:  boarding.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      tripDate:      depart.toLocaleString('fr-FR'),
      // ── Bus ──
      busPlate:      (trip as any)?.bus?.plateNumber ?? '',
      busModel:      (trip as any)?.bus?.model ?? '',
      busType:       (trip as any)?.bus?.type ?? '',
      busCapacity:   (trip as any)?.bus?.capacity ? String((trip as any).bus.capacity) : '',
      // ── Boarding pass fields ──
      gate:          '—',
      zone:          '—',
      // ── System ──
      qrCodeValue:   ticket.qrCode ?? ticket.id,
      qrCode:        ticket.qrCode ?? ticket.id,
      barcodeValue:  ticket.id,
      barcodeText:   ticket.id,
      generatedAt:   new Date().toLocaleString('fr-FR'),
    };
    // Utilise directement le renderer HTML (pas le template pdfme boarding-pass-a6)
    const stubSlug = await this.templates.resolveDefaultSlug(tenantId, 'TICKET', 'ticket-stub-html');
    return this.storeWithPdfmeFallback(
      tenantId, stubSlug, pdfmeData,
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

    const senderIds = [...new Set(parcels.map(p => p.senderId).filter((s): s is string => !!s))];
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
      sender:        p.senderId ? (senderMap.get(p.senderId) ?? null) : null,
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

    const multiLabelSlug = await this.templates.resolveDefaultSlug(tenantId, 'LABEL', 'parcel-label-multi');
    return this.storeWithPdfmeFallback(
      tenantId, multiLabelSlug, pdfmeData,
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

    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: TENANT_DOC_SELECT });

    // La destination du shipment sert de destinataire
    const station = await this.prisma.station.findFirst({
      where: { id: shipment.destinationId },
    }).catch(() => null);

    const html = await renderEnvelope({
      recipient: {
        name:    station?.name ?? shipment.destinationId,
        address: 'Adresse à compléter',
        city:    station?.city ?? '—',
      },
      sender: {
        name:    tenant.name,
        address: tenant.address ?? '',
        city:    tenant.city ?? '',
      },
      reference:  shipment.id.slice(0, 12).toUpperCase(),
      format,
      tenantName: tenant.name,
      actorId:    actor.id,
      scope,
    });

    const printFmt = format === 'C5' ? 'ENVELOPE_C5' as PrintFormat : 'ENVELOPE_C5' as PrintFormat;
    const slug = await this.templates.resolveDefaultSlug(
      tenantId, 'ENVELOPE', format === 'DL' ? 'envelope-dl' : 'envelope-c5',
    );
    const pdfmeData: Record<string, string> = {
      // ── Tenant ──
      tenantName:       tenant.name,
      tenantSlug:       tenant.slug,
      tenantAddress:    tenant.address ?? '',
      tenantPhone:      tenant.phoneNumber ?? '',
      tenantEmail:      tenant.email ?? '',
      tenantCountry:    tenant.country ?? '',
      // ── Envelope ──
      reference:        shipment.id.slice(0, 12).toUpperCase(),
      shipmentId:       shipment.id,
      shipmentStatus:   shipment.status,
      // ── Sender ──
      senderName:       tenant.name,
      senderAddress:    tenant.address ?? '',
      senderCity:       tenant.city ?? '',
      // ── Recipient ──
      recipientName:    station?.name ?? shipment.destinationId,
      recipientCity:    station?.city ?? '',
      destination:      station?.name ?? '',
      destinationCity:  station?.city ?? '',
      // ── System ──
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

    const trip = await this.prisma.trip.findFirst({
      where:   { id: ticket.tripId },
      include: {
        route: { include: { origin: true, destination: true } },
        bus:   true,
      },
    }).catch(() => null);

    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: TENANT_DOC_SELECT });

    const trackingCode = `${tenantId.slice(0, 4).toUpperCase()}-BAG-${ticketId.slice(-6).toUpperCase()}-${bagIndex}`;

    const originStation = (trip?.route as any)?.origin;
    const destStation   = (trip?.route as any)?.destination;
    const originName    = originStation?.city || originStation?.name || 'Origine';
    const destName      = destStation?.city   || destStation?.name   || 'Destination';

    const html = await renderBaggageTag({
      tag: {
        trackingCode,
        weight:      weightKg,
        bagNumber:   bagIndex,
        totalBags,
        description,
      },
      passenger: {
        name:     ticket.passengerName,
        phone:    null,
        ticketId: ticket.id,
      },
      trip: {
        id:                  trip?.id ?? 'N/A',
        departureScheduled:  trip?.departureScheduled ?? new Date(),
        origin:              originName,
        destination:         destName,
        routeName:           (trip?.route as any)?.name ?? null,
        busPlate:            (trip?.bus  as any)?.plateNumber  ?? null,
      },
      tenantName: tenant.name,
      actorId:    actor.id,
      scope,
    });

    const depart = trip?.departureScheduled ?? new Date();
    const cur    = displayCurrency(tenant.currency ?? 'XAF');
    const tenantLogo = await this.fetchTenantLogoDataUri(tenantId);
    const pdfmeData: Record<string, string> = {
      // ── Tenant ──
      tenantLogo,
      tenantName:    tenant.name,
      tenantSlug:    tenant.slug,
      tenantAddress: tenant.address ?? '',
      tenantPhone:   tenant.phoneNumber ?? '',
      tenantEmail:   tenant.email ?? '',
      tenantCountry: tenant.country ?? '',
      tenantCurrency: cur,
      // ── Baggage ──
      trackingCode,
      weight:         String(weightKg),
      bagNumber:      String(bagIndex),
      totalBags:      String(totalBags),
      bagDescription: description ?? '',
      // ── Passenger / Ticket ──
      passengerName:  ticket.passengerName,
      passengerPhone: '',
      ticketRef:      ticket.id,
      ticketStatus:   ticket.status,
      seatNumber:     ticket.seatNumber ?? '—',
      fareClass:      (ticket as any).fareClass ?? 'STANDARD',
      price:          String(ticket.pricePaid),
      currency:       cur,
      // ── Trip / Route ──
      origin:         originName,
      destination:    destName,
      originStation:  originStation?.name ?? '',
      destStation:    destStation?.name ?? '',
      routeName:      (trip?.route as any)?.name ?? '',
      distanceKm:     (trip?.route as any)?.distanceKm ? `${(trip?.route as any).distanceKm} km` : '',
      tripDate:       depart.toLocaleString('fr-FR'),
      departureTime:  depart.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      boardingDate:   depart.toLocaleDateString('fr-FR'),
      // ── Bus ──
      busPlate:       (trip?.bus as any)?.plateNumber ?? '',
      busModel:       (trip?.bus as any)?.model ?? '',
      busType:        (trip?.bus as any)?.type ?? '',
      // ── System ──
      qrCodeValue:    trackingCode,
      generatedAt:    new Date().toLocaleString('fr-FR'),
    };
    const baggageSlug = await this.templates.resolveDefaultSlug(tenantId, 'LABEL', 'baggage-tag');
    return this.storeWithPdfmeFallback(
      tenantId, baggageSlug, pdfmeData,
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

function buildSellerFromTenant(tenant: {
  name: string;
  address?: string | null;
  phoneNumber?: string | null;
  email?: string | null;
  taxId?: string | null;
  rccm?: string | null;
  settings?: unknown;
}) {
  return {
    name:    tenant.name,
    address: tenant.address ?? null,
    phone:   tenant.phoneNumber ?? null,
    email:   tenant.email ?? null,
    nif:     tenant.taxId ?? null,
    rccm:    tenant.rccm ?? null,
  };
}
