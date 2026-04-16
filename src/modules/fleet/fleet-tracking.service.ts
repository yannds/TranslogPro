import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { CreateFuelLogDto } from './dto/create-fuel-log.dto';
import { CreateOdometerReadingDto } from './dto/create-odometer-reading.dto';

@Injectable()
export class FleetTrackingService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Odometer ─────────────────────────────────────────────────────────────

  async createOdometerReading(tenantId: string, dto: CreateOdometerReadingDto, actorId: string) {
    const bus = await this.prisma.bus.findFirst({ where: { id: dto.busId, tenantId } });
    if (!bus) throw new NotFoundException(`Bus ${dto.busId} introuvable`);

    if (bus.currentOdometerKm != null && dto.readingKm < bus.currentOdometerKm) {
      throw new BadRequestException(
        `Relevé (${dto.readingKm} km) inférieur au dernier relevé connu (${bus.currentOdometerKm} km)`,
      );
    }

    const [reading] = await this.prisma.$transaction([
      this.prisma.odometerReading.create({
        data: {
          tenantId,
          busId:       dto.busId,
          readingKm:   dto.readingKm,
          readingDate: dto.readingDate ? new Date(dto.readingDate) : new Date(),
          source:      dto.source ?? 'MANUAL',
          note:        dto.note,
          createdById: actorId,
        },
      }),
      this.prisma.bus.update({
        where: { id: dto.busId },
        data:  { currentOdometerKm: dto.readingKm },
      }),
    ]);

    return reading;
  }

  async getOdometerReadings(tenantId: string, busId: string) {
    await this._assertBusExists(tenantId, busId);
    return this.prisma.odometerReading.findMany({
      where:   { tenantId, busId },
      orderBy: { readingDate: 'desc' },
      take:    100,
    });
  }

  // ─── Fuel Logs ────────────────────────────────────────────────────────────

  async createFuelLog(tenantId: string, dto: CreateFuelLogDto, actorId: string) {
    const bus = await this.prisma.bus.findFirst({ where: { id: dto.busId, tenantId } });
    if (!bus) throw new NotFoundException(`Bus ${dto.busId} introuvable`);

    const totalCost = dto.totalCost ?? (dto.pricePerL != null ? dto.pricePerL * dto.quantityL : undefined);

    const log = await this.prisma.fuelLog.create({
      data: {
        tenantId,
        busId:       dto.busId,
        logDate:     dto.logDate ? new Date(dto.logDate) : new Date(),
        fuelType:    dto.fuelType,
        quantityL:   dto.quantityL,
        pricePerL:   dto.pricePerL,
        totalCost,
        odometerKm:  dto.odometerKm,
        stationName: dto.stationName,
        fullTank:    dto.fullTank ?? false,
        note:        dto.note,
        createdById: actorId,
      },
    });

    // Si un kilométrage est fourni et supérieur au dernier relevé, mettre à jour
    if (dto.odometerKm != null && (bus.currentOdometerKm == null || dto.odometerKm > bus.currentOdometerKm)) {
      await this.prisma.bus.update({
        where: { id: dto.busId },
        data:  { currentOdometerKm: dto.odometerKm },
      });
    }

    return log;
  }

  async getFuelLogs(tenantId: string, busId: string) {
    await this._assertBusExists(tenantId, busId);
    return this.prisma.fuelLog.findMany({
      where:   { tenantId, busId },
      orderBy: { logDate: 'desc' },
      take:    200,
    });
  }

  /** Statistiques consommation pour un bus */
  async getFuelStats(tenantId: string, busId: string) {
    await this._assertBusExists(tenantId, busId);

    const logs = await this.prisma.fuelLog.findMany({
      where:   { tenantId, busId, fuelType: { not: 'ADBLUE' } },
      orderBy: { logDate: 'asc' },
    });

    const adBlueLogs = await this.prisma.fuelLog.findMany({
      where:   { tenantId, busId, fuelType: 'ADBLUE' },
      orderBy: { logDate: 'asc' },
    });

    const bus = await this.prisma.bus.findFirst({ where: { id: busId, tenantId } });

    const totalFuelL    = logs.reduce((s, l) => s + l.quantityL, 0);
    const totalFuelCost = logs.reduce((s, l) => s + (l.totalCost ?? 0), 0);
    const totalAdBlueL  = adBlueLogs.reduce((s, l) => s + l.quantityL, 0);
    const totalAdBlueCost = adBlueLogs.reduce((s, l) => s + (l.totalCost ?? 0), 0);

    // Calcul consommation moyenne (L/100km) basé sur les pleins complets
    let avgConsumptionPer100Km: number | null = null;
    const fullTankLogs = logs.filter(l => l.fullTank && l.odometerKm != null);
    if (fullTankLogs.length >= 2) {
      const sorted = fullTankLogs.sort((a, b) => (a.odometerKm! - b.odometerKm!));
      let totalKm = 0;
      let totalLiters = 0;
      for (let i = 1; i < sorted.length; i++) {
        totalKm += sorted[i].odometerKm! - sorted[i - 1].odometerKm!;
        totalLiters += sorted[i].quantityL;
      }
      if (totalKm > 0) {
        avgConsumptionPer100Km = Math.round((totalLiters / totalKm) * 100 * 100) / 100;
      }
    }

    return {
      busId,
      currentOdometerKm: bus?.currentOdometerKm ?? null,
      declaredConsumptionPer100Km: bus?.fuelConsumptionPer100Km ?? null,
      declaredAdBlueConsumptionPer100Km: bus?.adBlueConsumptionPer100Km ?? null,
      fuel: {
        totalLiters: Math.round(totalFuelL * 100) / 100,
        totalCostXof: Math.round(totalFuelCost),
        logCount: logs.length,
        avgConsumptionPer100Km,
      },
      adBlue: {
        totalLiters: Math.round(totalAdBlueL * 100) / 100,
        totalCostXof: Math.round(totalAdBlueCost),
        logCount: adBlueLogs.length,
      },
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async _assertBusExists(tenantId: string, busId: string) {
    const bus = await this.prisma.bus.findFirst({ where: { id: busId, tenantId } });
    if (!bus) throw new NotFoundException(`Bus ${busId} introuvable`);
    return bus;
  }
}
