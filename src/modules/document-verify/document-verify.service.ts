import {
  Injectable, Logger, NotFoundException, UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { QrService } from '../../core/security/qr/qr.service';
import { renderTicket } from '../documents/renderers/ticket.renderer';
import { renderParcelLabel } from '../documents/renderers/parcel-label.renderer';
import { AppConfigService } from '../../common/config/app-config.service';

/**
 * DocumentVerifyService — vue publique des documents officiels.
 *
 * Usage : un voyageur ou un destinataire scanne le QR imprimé sur son
 * billet/talon → le navigateur ouvre /verify/ticket/:id?q=TOKEN ou
 * /verify/parcel/:code → ce service vérifie l'authenticité et rend le
 * HTML officiel (avec fingerprint + certification intégrés par les
 * renderers existants).
 *
 * Sécurité :
 *   - Ticket : HMAC obligatoire en query string. Le QrService vérifie la
 *     signature contre la clé tenant (Vault) — un lien falsifié échoue.
 *   - Parcel : le trackingCode est déjà un secret opaque imprimé sur le
 *     talon physique ; la lecture publique du statut est acceptable
 *     (même logique que l'endpoint /track existant).
 *   - Aucun secret interne n'est exposé : le HTML rendu est le même
 *     document officiel que celui généré via le module Documents en back-office.
 */
@Injectable()
export class DocumentVerifyService {
  private readonly log = new Logger(DocumentVerifyService.name);

  constructor(
    private readonly prisma:    PrismaService,
    private readonly qr:        QrService,
    private readonly appConfig: AppConfigService,
  ) {}

  // ─── Ticket ────────────────────────────────────────────────────────────────

  async verifyAndRenderTicket(ticketId: string, qrToken: string): Promise<string> {
    if (!qrToken || typeof qrToken !== 'string') {
      throw new UnauthorizedException('Token de vérification manquant');
    }

    // 1. Chercher le ticket (sans scope tenant — on vérifie via HMAC ensuite)
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) {
      throw new NotFoundException('Billet introuvable');
    }

    // 2. Vérifier le HMAC contre la clé tenant du ticket. Si le token ne
    //    matche pas ce ticket (ou pas ce tenant), QrService jette 401.
    let payload;
    try {
      payload = await this.qr.verify(qrToken, ticket.tenantId);
    } catch {
      throw new UnauthorizedException('Lien invalide ou expiré');
    }

    if (payload.ticketId !== ticketId) {
      // Token signé pour un autre billet — tentative de replay
      throw new UnauthorizedException('Lien invalide pour ce billet');
    }

    // 3. Rassembler les données nécessaires au renderer
    const [tenant, trip, bStation, aStation] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({
        where:  { id: ticket.tenantId },
        select: { name: true },
      }),
      this.prisma.trip.findUnique({
        where:   { id: ticket.tripId },
        include: {
          route: { include: { origin: true, destination: true } },
          bus:   true,
        },
      }),
      ticket.boardingStationId
        ? this.prisma.station.findUnique({
            where:  { id: ticket.boardingStationId },
            select: { name: true, city: true },
          })
        : Promise.resolve(null),
      ticket.alightingStationId
        ? this.prisma.station.findUnique({
            where:  { id: ticket.alightingStationId },
            select: { name: true, city: true },
          })
        : Promise.resolve(null),
    ]);

    // 4. Rendu HTML officiel — même renderer que le back-office
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
      actorId:    'public-verify',
      scope:      undefined,
      // Ces stations sont injectées par le renderer si la forme l'accepte ;
      // à défaut elles restent dispo via ticket.trip.route.origin/destination.
      ...(bStation ? { boardingStation: bStation } : {}),
      ...(aStation ? { alightingStation: aStation } : {}),
    } as any);

    this.log.log(`[DocumentVerify] ticket=${ticketId} rendered for public view`);
    return html;
  }

  // ─── Parcel ────────────────────────────────────────────────────────────────

  async renderParcelByTrackingCode(trackingCode: string): Promise<string> {
    if (!trackingCode || typeof trackingCode !== 'string') {
      throw new NotFoundException('Code de suivi manquant');
    }

    const parcel = await this.prisma.parcel.findFirst({
      where:   { trackingCode },
      include: { destination: true },
    });
    if (!parcel) {
      throw new NotFoundException('Colis introuvable');
    }

    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where:  { id: parcel.tenantId },
      select: { name: true },
    });

    const recipInfoRaw = (parcel.recipientInfo ?? {}) as Record<string, unknown>;
    const portalSender = (recipInfoRaw.sender ?? null) as
      | { name?: string; email?: string } | null;
    const senderUser = parcel.senderId
      ? await this.prisma.user.findUnique({
          where:  { id: parcel.senderId },
          select: { name: true, email: true },
        })
      : null;

    const trackingBase = this.appConfig.publicTrackingUrl;

    const html = await renderParcelLabel({
      parcel: {
        id:            parcel.id,
        trackingCode:  parcel.trackingCode,
        weight:        parcel.weight,
        price:         parcel.price,
        status:        parcel.status,
        createdAt:     parcel.createdAt,
        recipientInfo: recipInfoRaw,
        sender: senderUser
          ? { name: senderUser.name, email: senderUser.email }
          : portalSender
            ? { name: portalSender.name ?? null, email: portalSender.email ?? '' }
            : null,
        destination: parcel.destination
          ? { name: parcel.destination.name, city: parcel.destination.city }
          : null,
      },
      tenantName:   tenant.name,
      trackingBase,
      actorId:      'public-verify',
      scope:        undefined,
    });

    this.log.log(`[DocumentVerify] parcel=${trackingCode} rendered for public view`);
    return html;
  }
}
