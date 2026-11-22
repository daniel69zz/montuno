import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, raw } from 'express';
import helmet from 'helmet';
import { loadEnv } from './config/env';

/** Configuración HTTP compartida por main.ts y los tests. */
export function configureApp(app: INestApplication) {
  const env = loadEnv();
  app.use(helmet());
  app.enableCors({
    origin: env.FRONTEND_ORIGIN.split(','),
    credentials: false,
    allowedHeaders: ['authorization', 'content-type', 'idempotency-key', 'x-correlation-id'],
  });
  // Subidas de evidencia: cuerpo binario limitado; resto JSON pequeño (rawBody para firmas de webhook).
  app.use('/api/v1/storage/objects', raw({ type: () => true, limit: env.EVIDENCE_MAX_BYTES }));
  app.use(
    json({
      limit: '100kb',
      verify: (req, _res, buf) => ((req as unknown as { rawBody: Buffer }).rawBody = buf),
    }),
  );
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'ready', method: RequestMethod.GET },
    ],
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  const config = new DocumentBuilder()
    .setTitle('Montuno API (backend)')
    .setDescription(
      'Backend de cotizaciones y escrow Soroban (Stellar TESTNET). Montuno: API del monorepo (escrow Soroban en Stellar Testnet).',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .addGlobalParameters({
      name: 'Idempotency-Key',
      in: 'header',
      required: false,
      description: 'Obligatoria en endpoints mutadores marcados',
    })
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config), {
    jsonDocumentUrl: 'docs/openapi.json',
  });
  return env;
}
