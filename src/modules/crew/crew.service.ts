import { Injectable, NotFoundException, ConflictException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService }              from '../../infrastructure/database/prisma.service';
import { SchedulingGuardService }     from '../scheduling-guard/scheduling-guard.service';
import type { ScopeContext } from '../../common/decorators/scope-context.decorator';
import { assertTripOwnership } from '../../common/helpers/scope-filter';

export interface AssignCrewDto {
  staffId:  string;
  crewRole: 'CO_PILOT' | 'HOSTESS' | 'SECURITY' | 'MECHANIC_ON_BOARD';
}

@Injectable()
export class CrewService {
  constructor(
    private readonly prisma:          PrismaService,
    private readonly schedulingGuard: SchedulingGuardService,
  ) {}

  async assign(tenantId: string, tripId: string, dto: AssignCrewDto) {
    const [trip, staff] = await Promise.all([
      this.prisma.trip.findFirst({ where: { id: tripId, tenantId } }),
      this.prisma.staff.findFirst({ where: { userId: dto.staffId, tenantId } }),
    ]);

    if (!trip)  throw new NotFoundException(`Trip ${tripId} introuvable`);
    if (!staff) throw new NotFoundException(`Staff ${dto.staffId} introuvable`);

    const existing = await this.prisma.crewAssignment.findUnique({
      where: { tripId_staffId: { tripId, staffId: dto.staffId } },
    });
    if (existing) throw new ConflictException('Ce membre d\'équipage est déjà assigné à ce trajet');

    // ── Unicité temporelle : même staff ne peut pas être sur 2 trajets qui se chevauchent ──
    const overlapping = await this.prisma.crewAssignment.findFirst({
      where: {
        tenantId,
        staffId: dto.staffId,
        tripId:  { not: tripId },
        trip: {
          status:             { notIn: ['CANCELLED', 'COMPLETED'] },
          departureScheduled: { lt: trip.arrivalScheduled },
          arrivalScheduled:   { gt: trip.departureScheduled },
        },
      },
      include: { trip: { include: { route: true } } },
    });
    if (overlapping) {
      const dep = overlapping.trip.departureScheduled.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const routeName = overlapping.trip.route?.name ?? overlapping.tripId;
      throw new ConflictException(
        `Ce membre d'équipage est déjà affecté au trajet "${routeName}" à ${dep} (conflit horaire)`,
      );
    }

    // ── Scheduling Guard: vérifier disponibilité du membre d'équipage ─────────
    // On vérifie seulement le personnel (pas le bus — déjà vérifié à la création du trip)
    const check = await this.schedulingGuard.checkAssignability(tenantId, undefined, dto.staffId);
    if (!check.canAssign) {
      const details = check.reasons.map(r => r.message).join(' | ');
      throw new BadRequestException(`Affectation équipage impossible: ${details}`);
    }

    return this.prisma.crewAssignment.create({
      data: { tenantId, tripId, staffId: dto.staffId, crewRole: dto.crewRole },
    });
  }

  async getMineUpcoming(tenantId: string, userId: string) {
    // CrewAssignment.staffId is a Staff.id, not a User.id — resolve first.
    const staff = await this.prisma.staff.findFirst({
      where: { userId, tenantId },
      select: { id: true },
    });
    if (!staff) return [];

    const tripInclude = {
      route: {
        include: {
          origin:      { select: { id: true, name: true } },
          destination: { select: { id: true, name: true } },
        },
      },
      bus: { select: { plateNumber: true } },
    };

    // 1. Crew assignments (co-pilot, hostess, etc.)
    const crewAssignments = await this.prisma.crewAssignment.findMany({
      where: { tenantId, staffId: staff.id },
      include: { trip: { include: tripInclude }, briefingRecord: true },
      orderBy: { createdAt: 'desc' },
    });

    // 2. Trips where the user is the main driver (Trip.driverId)
    //    Synthesize virtual "assignments" so the frontend has a uniform shape.
    const driverTrips = await this.prisma.trip.findMany({
      where: {
        tenantId,
        driverId: staff.id,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
      include: {
        ...tripInclude,
        crewAssignments: {
          where: { staffId: staff.id },
          select: { id: true },
        },
      },
      orderBy: { departureScheduled: 'desc' },
    });

    // Only synthesize for trips where the driver does NOT already have a CrewAssignment
    const existingTripIds = new Set(crewAssignments.map(a => a.tripId));
    const syntheticAssignments = driverTrips
      .filter(t => !existingTripIds.has(t.id) && t.crewAssignments.length === 0)
      .map(t => ({
        id:             `driver-${t.id}`,
        tenantId,
        tripId:         t.id,
        staffId:        staff.id,
        crewRole:       'DRIVER',
        briefedAt:      null as Date | null,
        createdAt:      t.departureScheduled,
        trip:           t,
        briefingRecord: null,
      }));

    return [...crewAssignments, ...syntheticAssignments];
  }

  async getForTrip(tenantId: string, tripId: string, scope?: ScopeContext) {
    if (scope) await assertTripOwnership(this.prisma, tenantId, tripId, scope);
    return this.prisma.crewAssignment.findMany({
      where: { tenantId, tripId },
    });
  }

  async markBriefed(tenantId: string, tripId: string, staffId: string, scope?: ScopeContext) {
    // Scope own : un membre d'équipage ne peut marquer briefé QUE lui-même.
    if (scope?.scope === 'own' && staffId !== scope.userId) {
      throw new ForbiddenException(`Scope 'own' violation — staffId ≠ actor.id`);
    }
    const assignment = await this.prisma.crewAssignment.findFirst({
      where: { tripId, staffId, tenantId },
    });
    if (!assignment) throw new NotFoundException('Assignment introuvable');

    return this.prisma.crewAssignment.update({
      where: { tripId_staffId: { tripId, staffId } },
      data:  { briefedAt: new Date() },
    });
  }

  /**
   * Vérifie que tout l'équipage est briefé (guard WorkflowEngine BOARDING).
   */
  async isFullyBriefed(tenantId: string, tripId: string): Promise<boolean> {
    const assignments = await this.prisma.crewAssignment.findMany({
      where: { tenantId, tripId },
    });
    return assignments.length > 0 && assignments.every(a => a.briefedAt !== null);
  }

  async remove(tenantId: string, tripId: string, staffId: string) {
    const assignment = await this.prisma.crewAssignment.findFirst({
      where: { tripId, staffId, tenantId },
    });
    if (!assignment) throw new NotFoundException('Assignment introuvable');

    return this.prisma.crewAssignment.delete({
      where: { tripId_staffId: { tripId, staffId } },
    });
  }
}
