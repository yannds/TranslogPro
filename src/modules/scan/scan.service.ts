import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

/**
 * ScanService — lookup par code (QR / code court) pour le portail Agent Quai.
 *
 * Le portail agent scanne un code imprimé sur un billet ou un colis et attend
 * en retour le type de document + l'entité + le prochain geste métier (état
 * suivant dans le blueprint). Le but : éviter 2 choses reprochées à l'ancien
 * portail mock :
 *   1. Imposer à l'agent de choisir à l'avance billet/colis avant de scanner
 *   2. Laisser le scan sans réponse (pas de feedback état-changé)
 *
 * On expose donc 2 endpoints distincts (ticket/parcel) : l'agent clique
 * explicitement le bon menu, un mauvais code retourne 404 proprement. Pour
 * fusion future (un seul endpoint qui détecte le type), garder cette structure
 * séparée permet de composer.
 */
export interface ScanCapabilities {
  /** L'utilisateur peut scanner pour enregistrer en gare (CHECK_IN). */
  canCheckIn: boolean;
  /** L'utilisateur peut scanner pour embarquer dans le bus (BOARD). */
  canBoard:   boolean;
}

@Injectable()
export class ScanService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calcule ce que l'utilisateur peut faire depuis ses écrans de scan dans le
   * tenant courant. Deux conditions combinées par AND :
   *   1. L'utilisateur a la permission (DB `role_permissions`).
   *   2. Le blueprint Traveler du tenant a une transition active pour l'action
   *      (WorkflowConfig(Traveler, SCAN_IN | SCAN_BOARD, isActive=true)).
   *
   * Si le tenant désactive SCAN_BOARD dans son blueprint, l'agent ne verra pas
   * le bouton même si sa permission est là. Pareil si l'admin retire la perm
   * traveler.verify.agency d'un rôle — le bouton disparaît sans avoir à
   * recompiler l'app. C'est ce qui permet l'UX "full blueprint".
   */
  /**
   * Wrapper qui résout les permissions depuis le RoleId. Le controller
   * utilise cette variante, évite que l'appelant doive fetch perm lui-même.
   */
  async getCapabilitiesByRole(tenantId: string, roleId: string): Promise<ScanCapabilities> {
    const perms = await this.prisma.rolePermission.findMany({
      where:  { roleId },
      select: { permission: true },
    });
    return this.getCapabilities(tenantId, perms.map(p => p.permission));
  }

  async getCapabilities(tenantId: string, userPermissions: string[]): Promise<ScanCapabilities> {
    const [scanInActive, scanBoardActive] = await Promise.all([
      this.prisma.workflowConfig.findFirst({
        where: { tenantId, entityType: 'Traveler', action: 'SCAN_IN', isActive: true },
        select: { id: true },
      }),
      this.prisma.workflowConfig.findFirst({
        where: { tenantId, entityType: 'Traveler', action: 'SCAN_BOARD', isActive: true },
        select: { id: true },
      }),
    ]);

    const perms = new Set(userPermissions);
    return {
      canCheckIn: !!scanInActive     && perms.has('data.ticket.scan.agency'),
      canBoard:   !!scanBoardActive  && perms.has('data.traveler.verify.agency'),
    };
  }

  /**
   * Recherche un ticket par code (qrCode ou id). Renvoie l'entité enrichie
   * avec le trip + route + bus + traveler existant (pour connaître l'état
   * courant CHECKED_IN / BOARDED).
   *
   * Tenant-scoped : un agent ne peut pas résoudre un billet d'un autre tenant
   * même s'il devinait le code (protection IDOR latente).
   *
   * `intent` fixe la frontière d'action attendue du scanner :
   *   - `check-in` (défaut) : agent gare/quai au guichet — s'arrête à
   *     CHECKED_IN. Un re-scan d'un déjà CHECKED_IN retourne
   *     `ALREADY_CHECKED_IN` (warning info), PAS `BOARD` — sinon l'agent
   *     boarderait par erreur alors que c'est le rôle du chauffeur.
   *   - `board` : chauffeur au bus — s'arrête à BOARDED. Un scan d'un
   *     passager encore en CONFIRMED crée un Traveler en CHECKED_IN puis
   *     avance à BOARDED (fallback quand il n'y a pas d'agent gare).
   *
   * Sans `intent`, comportement historique (advance d'une étape selon état)
   * — gardé pour compat mais déprécié ; les UIs devraient toujours passer
   * un intent explicite.
   */
  async lookupTicket(tenantId: string, code: string, intent: 'check-in' | 'board' | null = null) {
    const trimmed = (code ?? '').trim();
    if (!trimmed) {
      throw new NotFoundException('Code vide');
    }

    // Ticket n'a pas de relation Prisma `trip` (juste un tripId scalaire) —
    // on fait 2 requêtes parallèles pour le ticket et son trip.
    const ticket = await this.prisma.ticket.findFirst({
      where: {
        tenantId,
        OR: [
          { qrCode: trimmed },
          { id:     trimmed },
        ],
      },
    });
    if (!ticket) throw new NotFoundException('Billet introuvable');

    const [trip, traveler] = await Promise.all([
      this.prisma.trip.findFirst({
        where:   { id: ticket.tripId, tenantId },
        include: {
          route: {
            include: {
              origin:      { select: { id: true, name: true, city: true } },
              destination: { select: { id: true, name: true, city: true } },
            },
          },
          bus: { select: { id: true, plateNumber: true, agencyId: true } },
        },
      }),
      this.prisma.traveler.findFirst({
        where:  { tenantId, ticketId: ticket.id },
        select: { id: true, status: true },
      }),
    ]);

    const nextAction = this.resolveNextAction(ticket.status, traveler?.status, intent);

    return {
      kind:       'TICKET' as const,
      ticket: {
        id:            ticket.id,
        qrCode:        ticket.qrCode,
        passengerName: ticket.passengerName,
        seatNumber:    ticket.seatNumber,
        fareClass:     ticket.fareClass,
        status:        ticket.status,
      },
      trip: trip ? {
        id:                 trip.id,
        status:             trip.status,
        departureScheduled: trip.departureScheduled,
        routeLabel:         `${trip.route?.origin?.city ?? trip.route?.origin?.name ?? ''} → ${trip.route?.destination?.city ?? trip.route?.destination?.name ?? ''}`,
        busPlate:           trip.bus?.plateNumber ?? null,
      } : null,
      traveler: traveler ? { id: traveler.id, status: traveler.status } : null,
      nextAction,
    };
  }

  /**
   * Recherche un colis par code (trackingCode ou id). Renvoie l'entité + trip
   * (via shipment) + prochaine action suggérée selon l'état blueprint.
   */
  async lookupParcel(tenantId: string, code: string) {
    const trimmed = (code ?? '').trim();
    if (!trimmed) {
      throw new NotFoundException('Code vide');
    }

    const parcel = await this.prisma.parcel.findFirst({
      where: {
        tenantId,
        OR: [
          { trackingCode: trimmed },
          { id:           trimmed },
        ],
      },
      include: {
        destination: { select: { id: true, name: true, city: true } },
        shipment: {
          include: {
            trip: {
              include: {
                route: {
                  include: {
                    origin:      { select: { id: true, name: true, city: true } },
                    destination: { select: { id: true, name: true, city: true } },
                  },
                },
                bus: { select: { id: true, plateNumber: true, agencyId: true } },
              },
            },
          },
        },
      },
    });

    if (!parcel) throw new NotFoundException('Colis introuvable');

    const trip = parcel.shipment?.trip ?? null;
    const nextAction = this.resolveParcelNextAction(parcel.status);

    return {
      kind: 'PARCEL' as const,
      parcel: {
        id:            parcel.id,
        trackingCode:  parcel.trackingCode,
        weight:        parcel.weight,
        status:        parcel.status,
        destinationCity: parcel.destination?.city ?? parcel.destination?.name ?? null,
      },
      trip: trip ? {
        id:                 trip.id,
        status:             trip.status,
        departureScheduled: trip.departureScheduled,
        routeLabel:         `${trip.route?.origin?.city ?? trip.route?.origin?.name ?? ''} → ${trip.route?.destination?.city ?? trip.route?.destination?.name ?? ''}`,
        busPlate:           trip.bus?.plateNumber ?? null,
      } : null,
      nextAction,
    };
  }

  /**
   * Résout la prochaine action métier attendue en fonction de l'état Ticket
   * + Traveler + intention du scanner. L'intention permet de distinguer
   * l'agent gare (intent='check-in', limite CHECKED_IN) du chauffeur
   * (intent='board', vise BOARDED).
   *
   * Codes retournés :
   *   CHECK_IN            — billet valide, à enregistrer en gare
   *   BOARD               — passager enregistré, prêt à embarquer dans le bus
   *   ALREADY_CHECKED_IN  — déjà enregistré (informatif agent ; pas de regression)
   *   ALREADY_BOARDED     — déjà à bord (idempotent)
   *   TICKET_*            — refus métier (annulé/expiré/pending)
   */
  private resolveNextAction(
    ticketStatus:   string,
    travelerStatus: string | undefined,
    intent:         'check-in' | 'board' | null,
  ): 'CHECK_IN' | 'BOARD' | 'ALREADY_CHECKED_IN' | 'ALREADY_BOARDED' | 'TICKET_CANCELLED' | 'TICKET_EXPIRED' | 'TICKET_PENDING' {
    if (ticketStatus === 'CANCELLED') return 'TICKET_CANCELLED';
    if (ticketStatus === 'EXPIRED')   return 'TICKET_EXPIRED';
    if (ticketStatus === 'PENDING_PAYMENT' || ticketStatus === 'CREATED') return 'TICKET_PENDING';

    // Déjà à bord → idempotent pour tous les intents.
    if (travelerStatus === 'BOARDED') return 'ALREADY_BOARDED';

    if (intent === 'check-in') {
      // Agent gare/quai : ne dépasse jamais CHECKED_IN. Un re-scan d'un déjà
      // enregistré doit être *informatif*, pas lancer un BOARD implicite.
      if (travelerStatus === 'CHECKED_IN') return 'ALREADY_CHECKED_IN';
      return 'CHECK_IN';
    }

    if (intent === 'board') {
      // Chauffeur au bus : vise BOARDED. Si le passager n'a pas encore été
      // scanné en gare (traveler absent ou <CHECKED_IN), on boarde directement
      // via lazy-create au fromState de SCAN_BOARD — couvre le cas "pas
      // d'agent gare dispo". Si CHECKED_IN → board normal.
      return 'BOARD';
    }

    // Sans intent explicite (compat rétro) — comportement historique.
    if (travelerStatus === 'CHECKED_IN') return 'BOARD';
    return 'CHECK_IN';
  }

  /**
   * Prochaine action attendue sur un colis, selon son état courant. Aligné
   * strictement sur le blueprint Parcel du tenant (workflow_configs) :
   *
   *   CREATED      → RECEIVE → AT_ORIGIN           (non déclenché par scan)
   *   AT_ORIGIN    → ADD_TO_SHIPMENT → PACKED      (nécessite contexte shipment)
   *   PACKED       → LOAD → LOADED                 ← scan chargement
   *   LOADED       → DEPART → IN_TRANSIT           (side-effect automatique Trip.DEPART)
   *   IN_TRANSIT   → ARRIVE → ARRIVED              ← scan arrivée chauffeur
   *   ARRIVED      → DELIVER → DELIVERED           ← scan remise destinataire
   *
   * Un scan sur un `LOADED` ne déclenche AUCUNE action manuelle — le colis
   * attend que le bus démarre. Retourner `ARRIVE` ici envoyait l'action au
   * backend qui la rejetait en 400 (transition LOADED+ARRIVE inexistante).
   * Idem pour AT_ORIGIN : il faut ADD_TO_SHIPMENT qui requiert un shipmentId
   * — pas accessible depuis un scan QR seul.
   */
  private resolveParcelNextAction(
    parcelStatus: string,
  ): 'LOAD' | 'ARRIVE' | 'DELIVER' | 'ALREADY_LOADED' | 'ALREADY_DELIVERED' | 'CANCELLED' | 'NEEDS_SHIPMENT' | 'PACK' {
    if (parcelStatus === 'DELIVERED') return 'ALREADY_DELIVERED';
    if (parcelStatus === 'CANCELLED' || parcelStatus === 'LOST' || parcelStatus === 'DAMAGED' || parcelStatus === 'RETURNED') return 'CANCELLED';
    if (parcelStatus === 'ARRIVED')    return 'DELIVER';
    if (parcelStatus === 'IN_TRANSIT') return 'ARRIVE';
    if (parcelStatus === 'LOADED')     return 'ALREADY_LOADED';  // attend DEPART auto
    if (parcelStatus === 'PACKED')     return 'LOAD';
    if (parcelStatus === 'AT_ORIGIN')  return 'NEEDS_SHIPMENT';  // doit passer par ADD_TO_SHIPMENT
    return 'PACK';
  }
}
