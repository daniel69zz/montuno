import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Keypair } from '@stellar/stellar-sdk';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { signSep53 } from '../src/common/auth/sep53';
import { PrismaService } from '../src/common/prisma.service';
import { ESCROW_GATEWAY } from '../src/stellar/escrow-gateway';
import { TOKEN_SENDER, TokenSender } from '../src/stellar/caja-sender';
import { CajaTestnetRampProvider } from '../src/integrations/caja-ramp.provider';
import { RAMP_PROVIDER } from '../src/integrations/ports';
import { SimulatedEscrowGateway } from '../src/stellar/simulated.gateway';

export const UNIT = 10_000_000n;
export const idem = () => ({ 'Idempotency-Key': randomUUID() });

export interface Ctx {
  app: INestApplication;
  http: () => ReturnType<typeof request>;
  prisma: PrismaService;
  gateway: SimulatedEscrowGateway;
  arbiterKp: Keypair;
}

export async function createApp(
  opts: { tokenSender?: (g: SimulatedEscrowGateway) => TokenSender } = {},
): Promise<Ctx> {
  const arbiterKp = Keypair.random();
  const gateway = new SimulatedEscrowGateway(arbiterKp.publicKey(), 9000);
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ESCROW_GATEWAY)
    .useValue(gateway);
  if (opts.tokenSender) {
    // rampa caja-testnet con un emisor falso (sin red): misma lógica de RampsService
    const sender = opts.tokenSender(gateway);
    builder = builder
      .overrideProvider(TOKEN_SENDER)
      .useValue(sender)
      .overrideProvider(RAMP_PROVIDER)
      .useFactory({
        factory: (caja: CajaTestnetRampProvider) => caja,
        inject: [CajaTestnetRampProvider],
      });
  }
  const mod = await builder.compile();
  const app = mod.createNestApplication({
    bodyParser: false,
    logger: process.env.TEST_DEBUG ? ['error'] : false,
  });
  configureApp(app);
  await app.init();
  const prisma = app.get(PrismaService);
  await truncate(prisma);
  return { app, http: () => request(app.getHttpServer()), prisma, gateway, arbiterKp };
}

export async function truncate(prisma: PrismaService) {
  const rows = await prisma.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(',')} CASCADE`,
  );
}

export interface Actor {
  token: string;
  userId: string;
  kp: Keypair;
  walletId: string;
  auth: { Authorization: string };
}

export async function login(ctx: Ctx, email: string): Promise<{ token: string; userId: string }> {
  const otp = await ctx.http().post('/api/v1/auth/otp/request').send({ email }).expect(201);
  const s = await ctx
    .http()
    .post('/api/v1/auth/session')
    .send({ provider: 'mock-email-otp', email, code: otp.body.devCode })
    .expect(201);
  return { token: s.body.accessToken, userId: s.body.userId };
}

export async function linkWallet(ctx: Ctx, token: string, kp = Keypair.random()) {
  const auth = { Authorization: `Bearer ${token}` };
  const ch = await ctx
    .http()
    .post('/api/v1/me/wallets/challenge')
    .set(auth)
    .send({ address: kp.publicKey() })
    .expect(201);
  const v = await ctx
    .http()
    .post('/api/v1/me/wallets/verify')
    .set(auth)
    .send({ challengeId: ch.body.challengeId, signature: signSep53(kp, ch.body.message) })
    .expect(201);
  return { kp, walletId: v.body.id as string };
}

export async function actor(ctx: Ctx, email: string, kp?: Keypair): Promise<Actor> {
  const { token, userId } = await login(ctx, email);
  const w = await linkWallet(ctx, token, kp);
  return {
    token,
    userId,
    kp: w.kp,
    walletId: w.walletId,
    auth: { Authorization: `Bearer ${token}` },
  };
}

export async function admin(ctx: Ctx) {
  const { token } = await login(ctx, 'admin@test.local');
  return { Authorization: `Bearer ${token}` };
}

export async function verifiedImporter(
  ctx: Ctx,
  email: string,
  opts: { maxAdvanceBps?: number; modes?: string[] } = {},
) {
  const a = await actor(ctx, email);
  const imp = await ctx
    .http()
    .post('/api/v1/importers')
    .set(a.auth)
    .send({ publicName: `Importadora ${email}` })
    .expect(201);
  const adm = await admin(ctx);
  await ctx.http().post(`/api/v1/admin/importers/${imp.body.id}/verify`).set(adm).expect(201);
  await ctx
    .http()
    .patch(`/api/v1/admin/importers/${imp.body.id}/limits`)
    .set(adm)
    .send({
      maxOrderAmountAtomic: (5_000n * UNIT).toString(),
      maxAdvanceBps: opts.maxAdvanceBps ?? 0,
      allowedModes: opts.modes ?? ['FULL_ESCROW'],
    })
    .expect(200);
  await ctx
    .http()
    .post('/api/v1/importers/me/wallet/verify')
    .set(a.auth)
    .send({ walletId: a.walletId })
    .expect(201);
  return { ...a, importerId: imp.body.id as string };
}

export function quoteBody(
  mode: 'FULL_ESCROW' | 'PARTIAL_ADVANCE',
  total: bigint,
  advance = 0n,
  extra: Record<string, unknown> = {},
) {
  const in1h = new Date(Date.now() + 3600_000).toISOString();
  return {
    productUrl: 'https://www.amazon.com/dp/B0EXAMPLE',
    productName: 'MacBook Air 13"',
    productVariant: 'M4 16GB',
    quantity: 1,
    destinationCity: 'La Paz',
    deliveryEstimateDays: 20,
    purchaseTerms: 'Compra en Amazon US, envío por courier a La Paz.',
    fiatPrice: '8352.00',
    fiatCurrency: 'BOB',
    amountAtomic: total.toString(),
    serviceFeeAtomic: (20n * UNIT).toString(),
    fx: { rate: '6.96', spreadBps: 50, source: 'mock', expiresAt: in1h },
    escrowMode: mode,
    advanceAmountAtomic: advance.toString(),
    expiresAt: in1h,
    fulfillmentDeadline: new Date(Date.now() + 30 * 86400_000).toISOString(),
    ...extra,
  };
}

export async function publishQuote(ctx: Ctx, imp: Actor, body: Record<string, unknown>) {
  const q = await ctx
    .http()
    .post('/api/v1/quotes')
    .set(imp.auth)
    .set(idem())
    .send(body)
    .expect(201);
  const p = await ctx
    .http()
    .post(`/api/v1/quotes/${q.body.id}/publish`)
    .set(imp.auth)
    .set(idem())
    .expect(201);
  return { quoteId: q.body.id as string, token: p.body.checkout.token as string };
}

export async function acceptCheckout(ctx: Ctx, buyer: Actor, token: string) {
  const view = await ctx.http().get(`/api/v1/checkout/${token}`).expect(200);
  const r = await ctx
    .http()
    .post(`/api/v1/checkout/${token}/accept`)
    .set(buyer.auth)
    .set(idem())
    .send({
      termsHash: view.body.termsHash,
      buyerWallet: buyer.kp.publicKey(),
      acceptTerms: true,
      disclosureVersion: view.body.riskDisclosure.version,
      disclosureHash: view.body.riskDisclosure.hash,
    })
    .expect(201);
  return { orderId: r.body.orderId as string, view: view.body };
}

/** Prepara -> firma en "cliente" con la keypair -> envía. */
export function signAndSubmit(
  ctx: Ctx,
  who: Actor | { auth: { Authorization: string }; kp: Keypair },
  orderId: string,
  prepared: { preparedId: string; unsignedXdr: string },
) {
  const signedXdr = SimulatedEscrowGateway.sign(prepared.unsignedXdr, who.kp);
  return ctx
    .http()
    .post(`/api/v1/orders/${orderId}/escrow/submit`)
    .set(who.auth)
    .set(idem())
    .send({ preparedId: prepared.preparedId, signedXdr });
}

export async function fund(ctx: Ctx, buyer: Actor, orderId: string) {
  const prep = await ctx
    .http()
    .post(`/api/v1/orders/${orderId}/escrow/prepare-funding`)
    .set(buyer.auth)
    .set(idem())
    .expect(201);
  const sub = await signAndSubmit(ctx, buyer, orderId, prep.body);
  return { prep, sub };
}
