import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  // API Versioning
  app.enableVersioning({ type: VersioningType.URI });
  app.setGlobalPrefix('api');

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
  app.useGlobalInterceptors(new RequestIdInterceptor(), new LoggingInterceptor());

  // CORS (configuré par tenant en production via Kong)
  app.enableCors({
    origin: process.env.NODE_ENV === 'development' ? '*' : false,
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
