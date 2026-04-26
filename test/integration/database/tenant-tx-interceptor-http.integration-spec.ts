import { Controller, Get, INestApplication, Module, Req } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService, wrapPrismaServiceWithTxProxy } from '../../../src/infrastructure/database/prisma.service';
import { TenantContextService } from '../../../src/infrastructure/database/tenant-context.service';
import { TenantTxInterceptor } from '../../../src/infrastructure/database/tenant-tx.interceptor';
import { SECRET_SERVICE } from '../../../src/infrastructure/secret/interfaces/secret.interface';

/**
 * Test integration HTTP : booting a Nest minimal app + supertest, verifie
 * la chaine complete :
 *   request HTTP -> middleware tenant-context -> TenantTxInterceptor -> handler
 *   -> query via Proxy -> tx avec set_config -> retour HTTP
 *
 * Ce test couvre le dernier trou laisse par les unit tests (mocks) et le test
 * Prisma direct precedent (sans NestJS HTTP).
 */
@Controller('test-rls')
class TestRlsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('current-tenant')
  async currentTenant(@Req() _req: any): Promise<{ tid: string | null }> {
    const rows = await this.prisma.$queryRaw<{ tid: string | null }[]>`
      SELECT current_setting('app.tenant_id', true) AS tid
    `;
    return { tid: rows[0]?.tid ?? null };
  }
}

/**
 * Middleware applicatif minimaliste qui injecte le tenant via header
 * pour simuler l'effet de RlsMiddleware (qui lit req.user.tenantId apres
 * BetterAuth, indispo dans cet env de test).
 */
function makeTenantHeaderMiddleware() {
  return (req: any, _res: any, next: any) => {
    const t = req.headers['x-test-tenant-id'];
    if (typeof t === 'string' && t.length > 0) {
      TenantContextService.run({ tenantId: t }, next);
      return;
    }
    next();
  };
}

@Module({
  controllers: [TestRlsController],
  providers: [
    TenantContextService,
    {
      provide: SECRET_SERVICE,
      useValue: { getSecret: async () => process.env.DATABASE_URL },
    },
    {
      provide: PrismaService,
      useFactory: (secret: any, ctx: TenantContextService) => {
        const real = new PrismaService(secret, ctx);
        return wrapPrismaServiceWithTxProxy(real);
      },
      inject: [SECRET_SERVICE, TenantContextService],
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantTxInterceptor,
    },
  ],
})
class TestModule {}

describe('TenantTxInterceptor — integration HTTP (NestJS + supertest)', () => {
  const ORIGINAL_FLAG = process.env.TENANT_DB_LEVEL_RLS;
  let app: INestApplication;

  beforeAll(async () => {
    process.env.TENANT_DB_LEVEL_RLS = 'on';

    const moduleRef = await Test.createTestingModule({
      imports: [TestModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(makeTenantHeaderMiddleware());
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (ORIGINAL_FLAG === undefined) delete process.env.TENANT_DB_LEVEL_RLS;
    else process.env.TENANT_DB_LEVEL_RLS = ORIGINAL_FLAG;
  });

  it('Sans header tenant : interceptor pass-through, query sans set_config', async () => {
    const res = await request(app.getHttpServer())
      .get('/test-rls/current-tenant')
      .expect(200);
    expect(res.body.tid ?? '').toBe('');
  });

  it('Avec X-Test-Tenant-Id : interceptor wrap dans tx, query voit le tenant', async () => {
    const res = await request(app.getHttpServer())
      .get('/test-rls/current-tenant')
      .set('X-Test-Tenant-Id', 'tnt-HTTP-A')
      .expect(200);
    expect(res.body.tid).toBe('tnt-HTTP-A');
  });

  it('2 requetes parallles avec tenants differents : isolation respectee', async () => {
    const [resA, resB] = await Promise.all([
      request(app.getHttpServer())
        .get('/test-rls/current-tenant')
        .set('X-Test-Tenant-Id', 'tnt-PARA-A'),
      request(app.getHttpServer())
        .get('/test-rls/current-tenant')
        .set('X-Test-Tenant-Id', 'tnt-PARA-B'),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect(resA.body.tid).toBe('tnt-PARA-A');
    expect(resB.body.tid).toBe('tnt-PARA-B');
  });

  it('Apres une requete avec tenant : la suivante sans tenant est de nouveau vide', async () => {
    await request(app.getHttpServer())
      .get('/test-rls/current-tenant')
      .set('X-Test-Tenant-Id', 'tnt-CLEAR-1')
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/test-rls/current-tenant')
      .expect(200);
    expect(res.body.tid ?? '').toBe('');
  });
});
