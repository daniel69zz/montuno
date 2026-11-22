import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ENV, Env, loadEnv } from './config/env';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';
import { ConfigController } from './config/config.controller';
import { TrustlessWorkClient } from './trustless-work/trustless-work.client';
import { TrustlessWorkConfig } from './trustless-work/trustless-work.config';
import { TrustlessWorkEscrowService } from './trustless-work/trustless-work-escrow.service';
import { AuditService } from './common/audit.service';
import { AuthGuard } from './common/auth/auth.guard';
import { SessionService } from './common/auth/session.service';
import { AllExceptionsFilter } from './common/http/exception.filter';
import { CorrelationMiddleware } from './common/http/correlation.middleware';
import { IdempotencyInterceptor } from './common/http/idempotency.interceptor';
import { PrismaService } from './common/prisma.service';
import { AdminController } from './admin/admin.controller';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import {
  MockEmailOtpIdentityProvider,
  StellarWalletIdentityProvider,
} from './auth/identity.service';
import { CheckoutController } from './checkouts/checkout.controller';
import { CheckoutService } from './checkouts/checkout.service';
import { DisputesController } from './disputes/disputes.controller';
import { DisputesService } from './disputes/disputes.service';
import { EscrowService } from './escrow/escrow.service';
import { OrdersController } from './escrow/orders.controller';
import { EvidenceController, StorageController } from './evidence/evidence.controller';
import { EvidenceService } from './evidence/evidence.service';
import { HealthController } from './health/health.controller';
import { ImportersController } from './importers/importers.controller';
import { ImportersService } from './importers/importers.service';
import { MockKycProvider } from './integrations/mock-kyc.provider';
import { CajaTestnetRampProvider } from './integrations/caja-ramp.provider';
import { MockRampProvider } from './integrations/mock-ramp.provider';
import { SorobanCajaSender, TOKEN_SENDER } from './stellar/caja-sender';
import { KYC_PROVIDER, RAMP_PROVIDER } from './integrations/ports';
import { JobsService } from './jobs/jobs.service';
import { LogisticsService } from './orders/logistics.service';
import { OrderAccessService } from './orders/order-access.service';
import { OrdersQueryService } from './orders/orders-query.service';
import { QuotesController } from './quotes/quotes.controller';
import { QuotesService } from './quotes/quotes.service';
import { RampsController } from './ramps/ramps.controller';
import { RampsService } from './ramps/ramps.service';
import { escrowGatewayProvider } from './stellar/stellar.providers';
import { LocalObjectStorage, OBJECT_STORAGE } from './storage/object-storage';
import { MeController } from './users/me.controller';
import { WebhooksController } from './webhooks/webhooks.controller';

const env = loadEnv();

@Module({
  imports: [
    JwtModule.register({
      secret: env.SESSION_SECRET,
      signOptions: { algorithm: 'HS256' },
      verifyOptions: { algorithms: ['HS256'] },
    }),
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: env.NODE_ENV === 'test' ? 10_000 : 120 },
    ]),
  ],
  controllers: [
    HealthController,
    ConfigController,
    CatalogController,
    AuthController,
    MeController,
    ImportersController,
    AdminController,
    QuotesController,
    CheckoutController,
    OrdersController,
    DisputesController,
    RampsController,
    EvidenceController,
    StorageController,
    WebhooksController,
  ],
  providers: [
    { provide: ENV, useValue: env satisfies Env },
    PrismaService,
    AuditService,
    SessionService,
    MockEmailOtpIdentityProvider,
    StellarWalletIdentityProvider,
    AuthService,
    ImportersService,
    QuotesService,
    CheckoutService,
    OrderAccessService,
    OrdersQueryService,
    LogisticsService,
    EscrowService,
    CatalogService,
    TrustlessWorkConfig,
    TrustlessWorkClient,
    TrustlessWorkEscrowService,
    DisputesService,
    RampsService,
    EvidenceService,
    JobsService,
    escrowGatewayProvider,
    MockKycProvider,
    { provide: KYC_PROVIDER, useExisting: MockKycProvider },
    MockRampProvider,
    {
      // la caja solo se construye (y solo lee su clave) con RAMP_PROVIDER=caja-testnet
      provide: TOKEN_SENDER,
      inject: [ENV],
      useFactory: (e: Env) =>
        e.RAMP_PROVIDER === 'caja-testnet' ? new SorobanCajaSender(e) : null,
    },
    CajaTestnetRampProvider,
    {
      provide: RAMP_PROVIDER,
      inject: [ENV, MockRampProvider, CajaTestnetRampProvider],
      useFactory: (e: Env, mock: MockRampProvider, caja: CajaTestnetRampProvider) =>
        e.RAMP_PROVIDER === 'caja-testnet' ? caja : mock,
    },
    { provide: OBJECT_STORAGE, useClass: LocalObjectStorage },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationMiddleware).forRoutes('{*path}');
  }
}
