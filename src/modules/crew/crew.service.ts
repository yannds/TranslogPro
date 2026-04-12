import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

export interface AssignCrewDto {
  staffId:  string;
  crewRole: 'CO_PILOT' | 'HOSTESS' | 'SECURITY' | 'MECHANIC_ON_BOARD';
}

@Injectable()
export class CrewService {
  constructor(private readonly prisma: PrismaService) {}

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

    return this.prisma.crewAssignment.create({
      data: { tenantId, tripId, staffId: dto.staffId, crewRole: dto.crewRole },
    });
  }

  async getForTrip(tenantId: string, tripId: string) {
    return this.prisma.crewAssignment.findMany({
      where: { tenantId, tripId },
    });
  }

  async markBriefed(tenantId: string, tripId: string, staffId: string) {
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
