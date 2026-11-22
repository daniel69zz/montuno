import 'reflect-metadata';
import './load-env';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { loadEnv } from './config/env';
import { JsonLogger } from './common/logger';

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, {
    logger: new JsonLogger(env.LOG_LEVEL),
    bodyParser: false,
  });
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(env.API_PORT);
}
void bootstrap();
