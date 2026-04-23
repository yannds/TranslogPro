import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

/**
 * INVARIANT : tout tenant possède au moins une agence.
 * - Création initiale : OnboardingService.onboard() provisionne l'agence par défaut.
 * - Backfill tenants existants : backfillDefaultAgencies() dans prisma/seeds/iam.seed.ts.
 * - Suppression : AgencyService.remove() refuse la dernière agence (409 Conflict).
 */

export interface CreateAgencyDto {
  name:       string;
  stationId?: string | null;
}

export interface UpdateAgencyDto {
  name?:      string;
  stationId?: string | null;
}

@Injectable()
export class AgencyService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateAgencyDto) {
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('Le nom de l\'agence est requis');

    const stationId = dto.stationId && dto.stationId.trim() !== '' ? dto.stationId : null;
    if (stationId) await this.assertStationBelongsToTenant(tenantId, stationId);

    // Transaction atomique : création agence + provisioning caisse VIRTUELLE.
    // Invariant : toute agence a exactement 1 CashRegister{kind='VIRTUAL'}
    // portant les side-effects comptables sans session caissier.
    return this.prisma.transact(async (tx) => {
      const agency = await tx.agency.create({
        data: { tenantId, name, stationId },
      });
      await tx.cashRegister.create({
        data: {
          tenantId,
          agencyId:       agency.id,
          agentId:        'SYSTEM',
          kind:           'VIRTUAL',
          status:         'OPEN',
          initialBalance: 0,
        },
      });
      return agency;
    });
  }

  findAll(tenantId: string) {
    return this.prisma.agency.findMany({
      where:   { tenantId },
      select:  { id: true, name: true, stationId: true },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const agency = await this.prisma.agency.findFirst({
      where: { id, tenantId },
    });
    if (!agency) throw new NotFoundException(`Agence ${id} introuvable dans ce tenant`);
    return agency;
  }

  async update(tenantId: string, id: string, dto: UpdateAgencyDto) {
    await this.findOne(tenantId, id);

    if (dto.stationId !== undefined && dto.stationId !== null && dto.stationId.trim() !== '') {
      await this.assertStationBelongsToTenant(tenantId, dto.stationId);
    }

    const trimmedName = dto.name !== undefined ? dto.name.trim() : undefined;
    if (trimmedName !== undefined && trimmedName === '') {
      throw new BadRequestException('Le nom de l\'agence ne peut pas être vide');
    }

    return this.prisma.agency.update({
      where: { id },
      data: {
        ...(trimmedName !== undefined    ? { name:      trimmedName }                 : {}),
        ...(dto.stationId !== undefined  ? { stationId: dto.stationId ?? null }       : {}),
      },
    });
  }

  /**
   * Supprime une agence, sauf si c'est la dernière du tenant (INVARIANT ≥1).
   * Détache les users encore rattachés (`agencyId = null`) dans la transaction —
   * PermissionGuard renverra 403 sur les prochaines requêtes scope `.agency`
   * pour ces users jusqu'à ce qu'ils soient réaffectés.
   */
  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);

    const total = await this.prisma.agency.count({ where: { tenantId } });
    if (total <= 1) {
      throw new ConflictException(
        'Impossible de supprimer la dernière agence du tenant — ' +
        'créez-en une nouvelle avant de supprimer celle-ci.',
      );
    }

    return this.prisma.transact(async (tx) => {
      await tx.user.updateMany({
        where: { tenantId, agencyId: id },
        data:  { agencyId: null },
      });
      await tx.agency.delete({ where: { id } });
      return { deleted: true };
    });
  }

  private async assertStationBelongsToTenant(tenantId: string, stationId: string) {
    const station = await this.prisma.station.findFirst({
      where: { id: stationId, tenantId },
      select: { id: true },
    });
    if (!station) {
      throw new BadRequestException(`Station ${stationId} introuvable dans ce tenant`);
    }
  }
}
