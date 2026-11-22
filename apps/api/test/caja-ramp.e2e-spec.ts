/**
 * Rampa caja-testnet (pago en BOB simulado + entrega de USDC de testnet desde la caja).
 * Aquí el emisor es falso (acredita en el ledger simulado); la entrega real contra Testnet se prueba en
 * scripts/e2e-testnet.ts con RAMP_PROVIDER=caja-testnet.
 */
import { Keypair } from '@stellar/stellar-sdk';
import { randomBytes } from 'crypto';
import { hmacHex } from '../src/common/crypto';
import { loadEnv } from '../src/config/env';
import type { TokenSender } from '../src/stellar/caja-sender';
import { SimulatedEscrowGateway } from '../src/stellar/simulated.gateway';
import {
  acceptCheckout,
  actor,
  createApp,
  Ctx,
  fund,
  idem,
  publishQuote,
  quoteBody,
  UNIT,
  verifiedImporter,
} from './helpers';

const TOTAL = 12n * UNIT;

class FakeSender implements TokenSender {
  readonly cajaAddress = Keypair.random().publicKey();
  calls: { to: string; amount: bigint; hash: string }[] = [];
  trustlines = new Set<string>();
  next: 'SUCCESS' | 'FAILED' | 'PENDING' | 'THROW' = 'SUCCESS';
  constructor(private readonly g: SimulatedEscrowGateway) {
    g.mint(this.cajaAddress, 1_000n * UNIT);
  }
  balanceOf(a: string) {
    return this.g.tokenBalance(a);
  }
  async canReceive(a: string) {
    return this.trustlines.has(a);
  }
  async send(to: string, amount: bigint) {
    if (this.next === 'THROW') throw new Error('simulación rechazada por el RPC');
    const hash = randomBytes(32).toString('hex');
    this.calls.push({ to, amount, hash });
    if (this.next === 'SUCCESS') {
      // mueve tokens simulados de la caja a la wallet (no al contrato)
      this.g.mint(to, amount);
      this.g.mint(this.cajaAddress, -amount);
    }
    return { txHash: hash, status: this.next as 'SUCCESS' | 'FAILED' | 'PENDING', ledger: 1 };
  }
}

let ctx: Ctx;
let sender: FakeSender;
beforeAll(async () => {
  ctx = await createApp({ tokenSender: (g) => (sender = new FakeSender(g)) });
});
afterAll(async () => ctx.app.close());

const post = (path: string, auth: { Authorization: string }, body: object = {}) =>
  ctx.http().post(`/api/v1${path}`).set(auth).set(idem()).send(body);

async function orderWithRamp(email: string) {
  const imp = await verifiedImporter(ctx, `imp-${email}`);
  const buyer = await actor(ctx, `buyer-${email}`);
  const { token } = await publishQuote(ctx, imp, quoteBody('FULL_ESCROW', TOTAL, 0n, { serviceFeeAtomic: '0' }));
  const { orderId } = await acceptCheckout(ctx, buyer, token);
  return { imp, buyer, orderId };
}

async function startRamp(buyer: { auth: { Authorization: string } }, orderId: string) {
  const q = await post(`/orders/${orderId}/ramp/quote`, buyer.auth).expect(201);
  expect(q.body.route.id).toBe('CAJA-BOB-USDC-TESTNET');
  await post('/me/kyc/start', buyer.auth, { corridorId: q.body.route.id }).expect(201);
  const st = await post(`/orders/${orderId}/ramp/start`, buyer.auth, {
    rampQuoteId: q.body.rampQuoteId,
  }).expect(201);
  expect(st.body.paymentInstructions.method).toBe('QR_SIMULADO');
  return st.body.ramp.providerReference as string;
}

describe('rampa caja-testnet', () => {
  it('sin trustline del USDC no se cotiza', async () => {
    const { buyer, orderId } = await orderWithRamp('t1@test.local');
    await post(`/orders/${orderId}/ramp/quote`, buyer.auth)
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe('TRUSTLINE_REQUIRED'));
  });

  it('pago simulado -> la caja entrega UNA vez -> WALLET_FUNDED -> el comprador financia el contrato', async () => {
    const { buyer, orderId } = await orderWithRamp('t2@test.local');
    sender.trustlines.add(buyer.kp.publicKey());
    const ref = await startRamp(buyer, orderId);

    const r1 = await post(`/orders/${orderId}/ramp/simulate-payment`, buyer.auth).expect(201);
    expect(r1.body).toMatchObject({ applied: true, status: 'COMPLETED' });
    expect(sender.calls.filter((c) => c.to === buyer.kp.publicKey())).toHaveLength(1);
    expect(sender.calls.at(-1)!.amount).toBe(TOTAL);

    // reintentos: ni otro simulate-payment ni un webhook firmado vuelven a pagar
    await post(`/orders/${orderId}/ramp/simulate-payment`, buyer.auth).expect(409);
    const payload = JSON.stringify({
      eventId: `evt-${ref}`,
      providerReference: ref,
      outcome: 'COMPLETED',
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const w = await ctx
      .http()
      .post('/api/v1/webhooks/mock-ramp')
      .set('content-type', 'application/json')
      .set('x-mock-timestamp', ts)
      .set('x-mock-signature', hmacHex(process.env.MOCK_WEBHOOK_SECRET!, `${ts}.${payload}`))
      .send(payload)
      .expect(200);
    expect(w.body).toMatchObject({ applied: false });
    expect(sender.calls.filter((c) => c.to === buyer.kp.publicKey())).toHaveLength(1);

    const ramp = await ctx.prisma.rampTransaction.findUniqueOrThrow({
      where: { providerReference: ref },
    });
    expect(ramp).toMatchObject({ status: 'COMPLETED', deliveryTxHash: sender.calls.at(-1)!.hash });
    let o = await ctx.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(o.paymentState).toBe('WALLET_FUNDED'); // nunca ESCROW_FUNDED por la rampa

    const { sub } = await fund(ctx, buyer, orderId);
    expect(sub.body.status).toBe('CONFIRMED');
    o = await ctx.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(o.paymentState).toBe('ESCROW_FUNDED');
  });

  it('entrega PENDING (timeout del RPC) queda PROCESSING y la conciliación la cierra por hash, sin re-pagar', async () => {
    const { buyer, orderId } = await orderWithRamp('t3@test.local');
    sender.trustlines.add(buyer.kp.publicKey());
    const ref = await startRamp(buyer, orderId);
    sender.next = 'PENDING';
    const r = await post(`/orders/${orderId}/ramp/simulate-payment`, buyer.auth).expect(201);
    sender.next = 'SUCCESS';
    expect(r.body.status).toBe('PROCESSING');
    const hash = r.body.deliveryTxHash as string;
    const spy = jest
      .spyOn(ctx.gateway, 'getTransactionStatus')
      .mockImplementation(async (h: string) =>
        h === hash ? { status: 'SUCCESS', ledger: 9 } : { status: 'NOT_FOUND' },
      );
    const { RampsService } = await import('../src/ramps/ramps.service');
    const ramps = ctx.app.get(RampsService);
    await ramps.reconcileDeliveries();
    await ramps.reconcileDeliveries();
    spy.mockRestore();
    expect(
      (await ctx.prisma.rampTransaction.findUniqueOrThrow({ where: { providerReference: ref } }))
        .status,
    ).toBe('COMPLETED');
    expect(
      (await ctx.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).paymentState,
    ).toBe('WALLET_FUNDED');
    expect(sender.calls.filter((c) => c.to === buyer.kp.publicKey())).toHaveLength(1);
  });

  it('entrega fallida o rechazada -> rampa FAILED y pago FAILED (reintentable)', async () => {
    for (const mode of ['FAILED', 'THROW'] as const) {
      const { buyer, orderId } = await orderWithRamp(`t4-${mode}@test.local`);
      sender.trustlines.add(buyer.kp.publicKey());
      const ref = await startRamp(buyer, orderId);
      sender.next = mode;
      const r = await post(`/orders/${orderId}/ramp/simulate-payment`, buyer.auth).expect(201);
      sender.next = 'SUCCESS';
      expect(r.body.status).toBe('FAILED');
      expect(
        (await ctx.prisma.rampTransaction.findUniqueOrThrow({ where: { providerReference: ref } }))
          .status,
      ).toBe('FAILED');
      expect(
        (await ctx.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).paymentState,
      ).toBe('FAILED');
    }
  });

  it('caja sin fondos o monto sobre el tope: no se cotiza', async () => {
    const { buyer, orderId } = await orderWithRamp('t5@test.local');
    sender.trustlines.add(buyer.kp.publicKey());
    const bal = await ctx.gateway.tokenBalance(sender.cajaAddress);
    ctx.gateway.mint(sender.cajaAddress, -bal);
    await post(`/orders/${orderId}/ramp/quote`, buyer.auth)
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe('CAJA_SIN_FONDOS'));
    ctx.gateway.mint(sender.cajaAddress, bal);
  });
});

describe('validación de entorno de la caja', () => {
  const base = {
    ...process.env,
    ESCROW_GATEWAY: 'soroban',
    STELLAR_ESCROW_CONTRACT_ID: 'C' + 'A'.repeat(55),
    STELLAR_ESCROW_TOKEN_CONTRACT_ID: 'C' + 'B'.repeat(55),
    STELLAR_ARBITER_ADDRESS: Keypair.random().publicKey(),
  };
  it('exige soroban + clave, y se prohíbe en production', () => {
    const secret = Keypair.random().secret();
    expect(() =>
      loadEnv({ ...base, RAMP_PROVIDER: 'caja-testnet', RAMP_CAJA_SECRET: secret }),
    ).not.toThrow();
    expect(() => loadEnv({ ...base, RAMP_PROVIDER: 'caja-testnet' })).toThrow(/RAMP_CAJA_SECRET/);
    expect(() =>
      loadEnv({
        ...base,
        ESCROW_GATEWAY: 'simulated',
        RAMP_PROVIDER: 'caja-testnet',
        RAMP_CAJA_SECRET: secret,
      }),
    ).toThrow(/soroban/);
    expect(() =>
      loadEnv({
        ...base,
        NODE_ENV: 'production',
        RAMP_PROVIDER: 'caja-testnet',
        RAMP_CAJA_SECRET: secret,
      }),
    ).toThrow(/production/);
  });
});
