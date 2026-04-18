/**
 * create-test-app.ts — Factory e2e TransLog Pro
 *
 * Stratégie :
 *   • Tous les providers d'infrastructure remplacés par des mocks in-memory.
 *   • Un middleware global injecte req.user depuis le header "x-test-user".
 *   • Le vrai PermissionGuard tourne avec le Prisma mocké
 *     (rolePermission.findFirst retourne toujours une permission → accès OK).
 *   • Sans x-test-user → PermissionGuard voit req.user = undefined →
 *     jette UnauthorizedException (401) — comportement production correct.
 *   • RedisRateLimitGuard overridé → jamais bloquant en test.
 */

import { INestApplication, ValidationPipe, Injectable, NestMiddleware, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/infrastructure/database/prisma.service';
import { RedisPublisherService } from '../../src/infrastructure/eventbus/redis-publisher.service';
import { SECRET_SERVICE } from '../../src/infrastructure/secret/interfaces/secret.interface';
import { REDIS_CLIENT } from '../../src/infrastructure/eventbus/redis-publisher.service';
import { EVENT_BUS } from '../../src/infrastructure/eventbus/interfaces/eventbus.interface';
import { PAYMENT_SERVICE } from '../../src/infrastructure/payment/interfaces/payment.interface';
import { SMS_SERVICE, WHATSAPP_SERVICE } from '../../src/infrastructure/notification/interfaces/sms.interface';
import { WEATHER_SERVICE } from '../../src/infrastructure/weather/interfaces/weather.interface';
import { STORAGE_SERVICE } from '../../src/infrastructure/storage/interfaces/storage.interface';
import { IDENTITY_SERVICE } from '../../src/infrastructure/identity/interfaces/identity.interface';
import { RedisRateLimitGuard } from '../../src/common/guards/redis-rate-limit.guard';
import { DisplayGateway } from '../../src/modules/display/display.gateway';
import { TrackingGateway } from '../../src/modules/tracking/tracking.gateway';
import { SCOPE_CONTEXT_KEY } from '../../src/core/iam/guards/permission.guard';
import { CanActivate, ExecutionContext } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import {
  createPrismaMock,
  createRedisMock,
  createSecretMock,
  TENANT_ID, USER_ID, ROLE_ID, AGENCY_ID,
} from './mock-providers';

// ─── TestUserMiddleware ────────────────────────────────────────────────────────
// Injecte req.user + scope context depuis le header x-test-user (JSON).
// Le vrai PermissionGuard utilise ensuite req.user pour vérifier les droits.
// Prisma mocké retournant toujours un rolePermission → toute permission passe.

@Injectable()
class TestUserMiddleware implements NestMiddleware {
  use(req: Request & { user?: unknown; [key: string]: unknown }, _res: Response, next: NextFunction) {
    const raw = (req.headers as Record<string, string | undefined>)['x-test-user'];
    if (raw) {
      const user = JSON.parse(raw) as {
        id: string; tenantId: string; roleId: string; roleName: string;
        agencyId?: string; userType?: string;
      };
      req['user'] = user;
      req[SCOPE_CONTEXT_KEY] = {
        scope:           'global',
        tenantId:        user.tenantId,
        userId:          user.id,
        agencyId:        user.agencyId,
        isImpersonating: false,
        actorTenantId:   user.tenantId,
      };
    }
    next();
  }
}

// ─── No-op rate limit guard ───────────────────────────────────────────────────
@Injectable()
class TestRateLimitGuard implements CanActivate {
  canActivate(_ctx: ExecutionContext): boolean { return true; }
}

// ─── External service mocks ───────────────────────────────────────────────────

const storageMock = {
  getUploadUrl:   jest.fn().mockResolvedValue({ url: 'https://mock-s3/upload', key: 'tenant/doc.pdf', expiresAt: new Date(Date.now() + 900_000) }),
  getDownloadUrl: jest.fn().mockResolvedValue({ url: 'https://mock-s3/download', key: 'tenant/doc.pdf', expiresAt: new Date(Date.now() + 900_000) }),
  deleteObject:   jest.fn().mockResolvedValue(undefined),
  assertObjectBelongsToTenant: jest.fn().mockReturnValue(true),
};

const paymentMock = {
  initiate:      jest.fn().mockResolvedValue({ status: 'PENDING',     externalRef: 'FLW-MOCK-001', amount: 5000, currency: 'XAF' }),
  verify:        jest.fn().mockResolvedValue({ status: 'SUCCESSFUL',  externalRef: 'FLW-MOCK-001' }),
  verifyWebhook: jest.fn().mockResolvedValue({ valid: true, event: 'charge.completed' }),
  refund:        jest.fn().mockResolvedValue({ status: 'PENDING',     externalRef: 'RFD-MOCK-001' }),
};

const smsMock      = { send: jest.fn().mockResolvedValue({ success: true, sid: 'SM-MOCK-001' }), healthCheck: jest.fn().mockResolvedValue(true) };
const whatsappMock = { send: jest.fn().mockResolvedValue({ success: true, sid: 'WA-MOCK-001' }), healthCheck: jest.fn().mockResolvedValue(true) };
const weatherMock  = { getCurrentWeather: jest.fn().mockResolvedValue({ condition: 'Sunny', temperature: 28, humidity: 65, windSpeed: 15, description: 'Ciel dégagé', icon: '01d' }) };
const identityMock = { createUser: jest.fn().mockResolvedValue({ id: USER_ID, email: 'test@example.com' }), getSession: jest.fn().mockResolvedValue(null), signOut: jest.fn().mockResolvedValue(undefined) };

// ─── Factory ──────────────────────────────────────────────────────────────────

export interface TestApp {
  app:    INestApplication;
  prisma: ReturnType<typeof createPrismaMock>;
  redis:  ReturnType<typeof createRedisMock>;
}

export async function createTestApp(): Promise<TestApp> {
  const prisma = createPrismaMock();
  const redis  = createRedisMock();
  const secret = createSecretMock();

  // transact mock must pass the full prisma mock so services can call
  // prisma.publicReport.create() etc. inside the transaction callback
  prisma.transact = jest.fn().mockImplementation(
    (fn: (tx: ReturnType<typeof createPrismaMock>) => Promise<unknown>) => fn(prisma),
  );

  const redisPubMock = {
    publish:         jest.fn().mockResolvedValue(undefined),
    getClient:       jest.fn().mockReturnValue(redis),
    onModuleInit:    jest.fn().mockResolvedValue(undefined),
    onModuleDestroy: jest.fn().mockResolvedValue(undefined),
  };

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    // Core infrastructure
    .overrideProvider(PrismaService)        .useValue(prisma)
    .overrideProvider(SECRET_SERVICE)       .useValue(secret)
    .overrideProvider(REDIS_CLIENT)         .useValue(redis)
    .overrideProvider(EVENT_BUS)            .useValue({
      publish:   jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn(),
      emit:      jest.fn().mockResolvedValue(undefined),
    })

    // Prevent RedisPublisherService.onModuleInit() from creating a real Redis connection
    .overrideProvider(RedisPublisherService).useValue(redisPubMock)

    // External services (Vault-backed)
    .overrideProvider(STORAGE_SERVICE)      .useValue(storageMock)
    .overrideProvider(PAYMENT_SERVICE)      .useValue(paymentMock)
    .overrideProvider(SMS_SERVICE)          .useValue(smsMock)
    .overrideProvider(WHATSAPP_SERVICE)     .useValue(whatsappMock)
    .overrideProvider(WEATHER_SERVICE)      .useValue(weatherMock)
    .overrideProvider(IDENTITY_SERVICE)     .useValue(identityMock)

    // WebSocket gateways — no HTTP routes, prevent Redis connections in test
    .overrideProvider(DisplayGateway)       .useValue({ onModuleInit: jest.fn() })
    .overrideProvider(TrackingGateway)      .useValue({ onModuleInit: jest.fn() })

    // Rate limit guard — never blocks in tests
    .overrideGuard(RedisRateLimitGuard)     .useClass(TestRateLimitGuard)

    .compile();

  const app = moduleFixture.createNestApplication();

  // Aligner le test-app sur main.ts : certains contrôleurs sont annotés
  // `@Controller({ version: '1', path: '…' })` (WhiteLabel, Pricing…) et ne
  // sont exposés que si le versioning URI est actif. Sans ça → 404 en e2e.
  app.enableVersioning({ type: VersioningType.URI });

  // Inject test user BEFORE any guard runs
  app.use((req: Request & { user?: unknown; [k: string]: unknown }, res: Response, next: NextFunction) => {
    const raw = (req.headers as Record<string, string | undefined>)['x-test-user'];
    if (raw) {
      const user = JSON.parse(raw) as { id: string; tenantId: string; [k: string]: unknown };
      (req as unknown as { user: typeof user }).user = user;
      (req as Record<string, unknown>)[SCOPE_CONTEXT_KEY] = {
        scope:           'global',
        tenantId:        user.tenantId,
        userId:          user.id,
        agencyId:        user['agencyId'],
        isImpersonating: false,
        actorTenantId:   user.tenantId,
      };
    }
    next();
  });

  app.useGlobalPipes(new ValidationPipe({
    whitelist:            true,
    forbidNonWhitelisted: false,
    transform:            true,
    transformOptions:     { enableImplicitConversion: true },
  }));

  await app.init();

  return { app, prisma, redis };
}

// ─── Auth header helpers ──────────────────────────────────────────────────────

export const AUTH_HEADERS = {
  admin: {
    'x-test-user': JSON.stringify({
      id: USER_ID, tenantId: TENANT_ID, roleId: ROLE_ID,
      roleName: 'ADMIN', agencyId: AGENCY_ID, userType: 'STAFF',
    }),
  },
  driver: {
    'x-test-user': JSON.stringify({
      id: USER_ID, tenantId: TENANT_ID, roleId: ROLE_ID,
      roleName: 'DRIVER', agencyId: AGENCY_ID, userType: 'STAFF',
    }),
  },
  customer: {
    'x-test-user': JSON.stringify({
      id: USER_ID, tenantId: TENANT_ID, roleId: ROLE_ID,
      roleName: 'CUSTOMER', userType: 'CUSTOMER',
    }),
  },
};

export { TENANT_ID, USER_ID, ROLE_ID, AGENCY_ID };
