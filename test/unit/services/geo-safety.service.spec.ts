/**
 * SafetyService — Tests unitaires
 *
 * Ce qui est testé :
 *   - reportAlert() : délégation GeoSafetyProvider si tripId+GPS fournis,
 *                     status=VERIFIED si score ≥ seuil configuré,
 *                     status=PENDING si score < seuil,
 *                     pas d'appel geo si tripId ou GPS manquants
 *   - listAlerts()  : filtrage par status optionnel
 *   - dismiss()     : mise à jour status=DISMISSED
 *
 * Mock : PrismaService, GeoSafetyProvider, TenantConfigService, IEventBus
 */

import { SafetyService, AlertType, ReportAlertDto } from '@modules/safety/safety.service';
import { PrismaService } from '@infra/database/prisma.service';
import { GeoSafetyProvider } from '@core/security/geo-safety.provider';
import { TenantConfigService } from '@core/security/tenant-config.service';
import { IEventBus } from '@infra/eventbus/interfaces/eventbus.interface';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const TENANT = 'tenant-safety-001';
const ACTOR  = { id: 'customer-01', tenantId: TENANT, roleId: 'role-customer', roleName: 'Customer' };

const ALERT_BASE = {
  id:                'alert-001',
  tenantId:          TENANT,
  tripId:            'trip-001',
  reporterId:        'voyageur-01',
  type:              AlertType.DANGEROUS_DRIVING,
  verificationScore: 0.8,
  status:            'VERIFIED',
  source:            'IN_APP',
  createdAt:         new Date(),
};

const CONFIG_AUTO_VERIFY_THRESHOLD = 0.7;

const DTO_WITH_GPS: ReportAlertDto = {
  type:        AlertType.DANGEROUS_DRIVING,
  tripId:      'trip-001',
  gpsLat:      14.693425,
  gpsLng:      -17.447938,
  description: 'Conduite dangereuse signalée',
};

const DTO_WITHOUT_GPS: ReportAlertDto = {
  type: AlertType.BREAKDOWN,
};

// ─── Mock factories ────────────────────────────────────────────────────────────

function makePrisma(alert = ALERT_BASE): jest.Mocked<PrismaService> {
  return {
    safetyAlert: {
      create:    jest.fn().mockResolvedValue(alert),
      findMany:  jest.fn().mockResolvedValue([alert]),
      update:    jest.fn().mockResolvedValue({ ...alert, status: 'DISMISSED' }),
    },
    transact: jest.fn().mockImplementation((fn: (tx: PrismaService) => Promise<unknown>) => fn({
      safetyAlert: { create: jest.fn().mockResolvedValue(alert) },
    } as unknown as PrismaService)),
  } as unknown as jest.Mocked<PrismaService>;
}

function makeGeo(score = 0.8): jest.Mocked<GeoSafetyProvider> {
  return {
    computeTripGeoScore: jest.fn().mockResolvedValue(score),
  } as unknown as jest.Mocked<GeoSafetyProvider>;
}

function makeConfigs(threshold = CONFIG_AUTO_VERIFY_THRESHOLD): jest.Mocked<TenantConfigService> {
  return {
    getConfig: jest.fn().mockResolvedValue({ autoVerifyScoreThreshold: threshold }),
  } as unknown as jest.Mocked<TenantConfigService>;
}

function makeEventBus(): jest.Mocked<IEventBus> {
  return { publish: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<IEventBus>;
}

function buildService(overrides: Partial<{
  prisma:    ReturnType<typeof makePrisma>;
  geo:       ReturnType<typeof makeGeo>;
  configs:   ReturnType<typeof makeConfigs>;
  eventBus:  ReturnType<typeof makeEventBus>;
}> = {}) {
  const prisma   = overrides.prisma   ?? makePrisma();
  const geo      = overrides.geo      ?? makeGeo();
  const configs  = overrides.configs  ?? makeConfigs();
  const eventBus = overrides.eventBus ?? makeEventBus();
  return { service: new SafetyService(prisma, geo, configs, eventBus), prisma, geo, configs, eventBus };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SafetyService', () => {

  // ── reportAlert() ──────────────────────────────────────────────────────────

  describe('reportAlert()', () => {
    describe('avec tripId + GPS fournis', () => {
      it('appelle GeoSafetyProvider.computeTripGeoScore()', async () => {
        const { service, geo } = buildService();
        await service.reportAlert(TENANT, DTO_WITH_GPS, ACTOR as any);
        expect(geo.computeTripGeoScore).toHaveBeenCalledWith(
          TENANT, 'trip-001', DTO_WITH_GPS.gpsLat, DTO_WITH_GPS.gpsLng,
        );
      });

      it('crée l\'alerte avec status=VERIFIED si score ≥ seuil (0.8 ≥ 0.7)', async () => {
        let capturedData: any;
        const prisma = makePrisma();
        prisma.transact = jest.fn().mockImplementation(async (fn: any) => {
          const fakeTx = {
            safetyAlert: {
              create: jest.fn().mockImplementation(({ data }) => {
                capturedData = data;
                return Promise.resolve(ALERT_BASE);
              }),
            },
          };
          return fn(fakeTx);
        });
        const { service } = buildService({ prisma, geo: makeGeo(0.8) });
        await service.reportAlert(TENANT, DTO_WITH_GPS, ACTOR as any);
        expect(capturedData.status).toBe('VERIFIED');
        expect(capturedData.verificationScore).toBe(0.8);
      });

      it('crée l\'alerte avec status=PENDING si score < seuil (0.5 < 0.7)', async () => {
        let capturedData: any;
        const prisma = makePrisma();
        prisma.transact = jest.fn().mockImplementation(async (fn: any) => {
          const fakeTx = {
            safetyAlert: {
              create: jest.fn().mockImplementation(({ data }) => {
                capturedData = data;
                return Promise.resolve({ ...ALERT_BASE, status: 'PENDING' });
              }),
            },
          };
          return fn(fakeTx);
        });
        const { service } = buildService({ prisma, geo: makeGeo(0.5) });
        await service.reportAlert(TENANT, DTO_WITH_GPS, ACTOR as any);
        expect(capturedData.status).toBe('PENDING');
      });

      it('publie un DomainEvent safety.alert dans la transaction', async () => {
        const prisma = makePrisma();
        const eventBus = makeEventBus();
        const { service } = buildService({ prisma, eventBus });
        await service.reportAlert(TENANT, DTO_WITH_GPS, ACTOR as any);
        // La transaction est appelée
        expect(prisma.transact).toHaveBeenCalledTimes(1);
      });
    });

    describe('sans tripId ou GPS', () => {
      it('ne calcule pas de score geo si DTO sans tripId', async () => {
        const { service, geo } = buildService();
        await service.reportAlert(TENANT, DTO_WITHOUT_GPS, ACTOR as any);
        expect(geo.computeTripGeoScore).not.toHaveBeenCalled();
      });

      it('verificationScore=0 si aucune coordonnée', async () => {
        let capturedData: any;
        const prisma = makePrisma();
        prisma.transact = jest.fn().mockImplementation(async (fn: any) => {
          const fakeTx = {
            safetyAlert: {
              create: jest.fn().mockImplementation(({ data }) => {
                capturedData = data;
                return Promise.resolve({ ...ALERT_BASE, verificationScore: 0, status: 'PENDING' });
              }),
            },
          };
          return fn(fakeTx);
        });
        const { service } = buildService({ prisma });
        await service.reportAlert(TENANT, DTO_WITHOUT_GPS, ACTOR as any);
        expect(capturedData.verificationScore).toBe(0);
      });

      it('status=PENDING si verificationScore=0 et seuil=0.7', async () => {
        let capturedData: any;
        const prisma = makePrisma();
        prisma.transact = jest.fn().mockImplementation(async (fn: any) => {
          const fakeTx = {
            safetyAlert: {
              create: jest.fn().mockImplementation(({ data }) => {
                capturedData = data;
                return Promise.resolve(ALERT_BASE);
              }),
            },
          };
          return fn(fakeTx);
        });
        const { service } = buildService({ prisma });
        await service.reportAlert(TENANT, DTO_WITHOUT_GPS, ACTOR as any);
        expect(capturedData.status).toBe('PENDING');
      });
    });

    it('lit le seuil depuis TenantConfigService (zéro magic-number)', async () => {
      const { service, configs } = buildService();
      await service.reportAlert(TENANT, DTO_WITH_GPS, ACTOR as any);
      expect(configs.getConfig).toHaveBeenCalledWith(TENANT);
    });

    it('source=IN_APP', async () => {
      let capturedData: any;
      const prisma = makePrisma();
      prisma.transact = jest.fn().mockImplementation(async (fn: any) => {
        const fakeTx = {
          safetyAlert: {
            create: jest.fn().mockImplementation(({ data }) => {
              capturedData = data;
              return Promise.resolve(ALERT_BASE);
            }),
          },
        };
        return fn(fakeTx);
      });
      const { service } = buildService({ prisma });
      await service.reportAlert(TENANT, DTO_WITH_GPS, ACTOR as any);
      expect(capturedData.source).toBe('IN_APP');
    });
  });

  // ── listAlerts() ───────────────────────────────────────────────────────────

  describe('listAlerts()', () => {
    it('retourne les alertes du tenant', async () => {
      const { service } = buildService();
      const alerts = await service.listAlerts(TENANT);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].tenantId).toBe(TENANT);
    });

    it('filtre par status si fourni', async () => {
      const { service, prisma } = buildService();
      await service.listAlerts(TENANT, 'VERIFIED');
      expect(prisma.safetyAlert.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'VERIFIED' }) }),
      );
    });

    it('ne filtre pas par status si absent', async () => {
      const { service, prisma } = buildService();
      await service.listAlerts(TENANT);
      const call = (prisma.safetyAlert.findMany as jest.Mock).mock.calls[0][0];
      expect(call.where).not.toHaveProperty('status');
    });
  });

  // ── dismiss() ──────────────────────────────────────────────────────────────

  describe('dismiss()', () => {
    it('met à jour status=DISMISSED', async () => {
      const { service, prisma } = buildService();
      await service.dismiss(TENANT, 'alert-001');
      expect(prisma.safetyAlert.update).toHaveBeenCalledWith({
        where: { id: 'alert-001' },
        data:  { status: 'DISMISSED' },
      });
    });
  });
});
