import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { PrismaExceptionInterceptor } from './common/interceptors/prisma-exception.interceptor';
import { RedisIoAdapter } from './infrastructure/redis-io.adapter';
import { SECRET_SERVICE, ISecretService } from './infrastructure/secret/interfaces/secret.interface';
import { corsOrigin } from './common/security/cors.helper';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: false, // true perdrait les logs si crash avant listen()
    // rawBody préservé pour la vérification HMAC des webhooks paiement
    // (PaymentWebhookController lit req.rawBody pour calculer la signature).
    rawBody: true,
  });

  // Redis adapter socket.io (doit être configuré avant listen())
  const secretService = app.get<ISecretService>(SECRET_SERVICE);
  const redisConfig = await secretService.getSecretObject<{
    HOST: string; PORT: string; PASSWORD?: string;
  }>('platform/redis');
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis(
    redisConfig.HOST,
    parseInt(redisConfig.PORT, 10),
    redisConfig.PASSWORD,
  );
  app.useWebSocketAdapter(redisIoAdapter);

  app.setGlobalPrefix('api');

  // HTTP Security headers (CSP, X-Frame-Options, HSTS, etc.)
  // Dev : pas de HSTS — sinon le navigateur upgrade http→https sur les
  // sous-domaines .translog.test et l'API NestJS (qui ne sert pas TLS)
  // se retrouve appelée en https, casse les preflights CORS.
  app.use(helmet({
    contentSecurityPolicy: process.env.NODE_ENV === 'production',
    crossOriginEmbedderPolicy: false, // Vite assets en dev
    hsts:                      process.env.NODE_ENV === 'production',
  }));

  // Cookie parser (lecture du cookie translog_session sur /api/auth/me, etc.)
  app.use(cookieParser());

  // Validation globale
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Filtres et intercepteurs globaux
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new RequestIdInterceptor(), new LoggingInterceptor(), new PrismaExceptionInterceptor());

  // CORS — politique unique partagée avec les WebSocket Gateways
  // (cf. src/common/security/cors.helper.ts). En prod, whitelist regex
  // sur PUBLIC_BASE_DOMAIN ; en dev, localhost + *.translog.test.
  app.enableCors({
    origin:      corsOrigin(),
    credentials: true,
  });

  // Health check endpoint
  app.getHttpAdapter().get('/health/live', (_req, res) => res.json({ status: 'ok' }));
  app.getHttpAdapter().get('/health/ready', (_req, res) => res.json({ status: 'ok' }));

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`🚀 TransLog Pro API running on port ${port}`);
  console.log(`📡 WebSocket Gateway on port 3001`);
}

bootstrap();
