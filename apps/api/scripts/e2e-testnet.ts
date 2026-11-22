/**
 * E2E REAL en Stellar TESTNET a través de la API HTTP (FULL y PARTIAL + disputa tras anticipo).
 *
 * - Levanta la API en proceso con ESCROW_GATEWAY=soroban contra el contrato de docs/deployments/testnet.json.
 * - Las claves de prueba se leen del keystore local de la CLI de Stellar (`stellar keys show`) y se usan SOLO
 *   del lado "cliente" para firmar (SEP-53 y XDR). Nunca se envían al servidor.
 * - Activos sin valor (TESTUSD). Requiere DATABASE_URL de una BD de desarrollo con migraciones aplicadas.
 *
 * Uso: DATABASE_URL=... npm run e2e:testnet -w apps/api
 */
import 'reflect-metadata';
import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import { Keypair } from '@stellar/stellar-sdk';

const ROOT = path.resolve(__dirname, '../../..');
const dep = JSON.parse(readFileSync(path.join(ROOT, 'docs/deployments/testnet.json'), 'utf8'));
const secretOf = (identity: string) =>
  execFileSync('stellar', ['keys', 'show', identity], { encoding: 'utf8' }).trim();

Object.assign(process.env, {
  NODE_ENV: 'development',
  SESSION_SECRET: process.env.SESSION_SECRET ?? `e2e-${randomUUID()}-${randomUUID()}`,
  STELLAR_NETWORK: 'testnet',
  STELLAR_NETWORK_PASSPHRASE: dep.networkPassphrase,
  ESCROW_GATEWAY: 'soroban',
  STELLAR_ESCROW_CONTRACT_ID: dep.escrowContractId,
  STELLAR_ESCROW_TOKEN_CONTRACT_ID: dep.token.contractId,
  STELLAR_ARBITER_ADDRESS: dep.accounts.arbiter,
  STELLAR_MAX_ADVANCE_BPS: String(dep.maxAdvanceBps),
  ADMIN_INITIAL_EMAIL: 'admin@e2e.local',
  MOCK_KYC_AUTO_APPROVE: 'true',
  JOBS_ENABLED: 'false',
  // rampa: pago BOB simulado + USDC de Circle de testnet REAL entregado por la caja (ie-caja)
  RAMP_PROVIDER: 'caja-testnet',
  RAMP_CAJA_SECRET: secretOf(dep.cliIdentities.caja),
  AUTH_THROTTLE_LIMIT: '1000',
  LOG_LEVEL: 'warn',
});

const UNIT = 10_000_000n;
const TOTAL = 12n * UNIT; // 12 USDC de testnet por orden
const ADVANCE = 9n * UNIT;
const RETAINED = TOTAL - ADVANCE;

async function main() {
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/bootstrap');
  const { signSep53 } = await import('../src/common/auth/sep53');
  const { signPreparedXdr } = await import('../src/stellar/soroban.gateway');
  const app = await NestFactory.create(AppModule, { bodyParser: false, logger: ['error', 'warn'] });
  configureApp(app);
  await app.listen(0);
  const base = `${await app.getUrl()}/api/v1`.replace('[::1]', 'localhost');
  const run = randomUUID().slice(0, 8);
  const report: Record<string, unknown> = {
    ranAt: new Date().toISOString(),
    contractId: dep.escrowContractId,
    steps: [] as unknown[],
  };
  const steps = report.steps as unknown[];

  const call = async (
    method: string,
    p: string,
    token?: string,
    body?: unknown,
    expect = [200, 201],
  ) => {
    const r = await fetch(base + p, {
      method,
      headers: {
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await r.json().catch(() => ({}));
    if (!expect.includes(r.status))
      throw new Error(`${method} ${p} -> ${r.status} ${JSON.stringify(json)}`);
    return json as Record<string, any>;
  };
  const login = async (email: string, kp?: Keypair) => {
    const otp = await call('POST', '/auth/otp/request', undefined, { email });
    const s = await call('POST', '/auth/session', undefined, {
      provider: 'mock-email-otp',
      email,
      code: otp.devCode,
    });
    let walletId: string | undefined;
    if (kp) {
      const ch = await call('POST', '/me/wallets/challenge', s.accessToken, {
        address: kp.publicKey(),
      });
      walletId = (
        await call('POST', '/me/wallets/verify', s.accessToken, {
          challengeId: ch.challengeId,
          signature: signSep53(kp, ch.message),
          provider: 'cli-test',
        })
      ).id;
    }
    return { token: s.accessToken as string, userId: s.userId as string, walletId, kp: kp! };
  };
  const signSubmit = async (
    who: { token: string; kp: Keypair },
    orderId: string,
    prepared: Record<string, any>,
    label: string,
  ) => {
    const signed = signPreparedXdr(prepared.unsignedXdr, dep.networkPassphrase, who.kp); // firma en el "cliente"
    const r = await call('POST', `/orders/${orderId}/escrow/submit`, who.token, {
      preparedId: prepared.preparedId,
      signedXdr: signed,
    });
    if (r.status !== 'CONFIRMED') throw new Error(`${label}: ${JSON.stringify(r)}`);
    steps.push({ step: label, txHash: r.txHash, ledger: r.ledger, explorer: r.explorerUrl });
    console.log(`  ✓ ${label}  ${r.explorerUrl}`);
    return r;
  };

  const buyerKp = Keypair.fromSecret(secretOf(dep.cliIdentities.buyer));
  const importerKp = Keypair.fromSecret(secretOf(dep.cliIdentities.importer));
  const arbiterKp = Keypair.fromSecret(secretOf(dep.cliIdentities.arbiter));

  // Usuarios. Las wallets de CLI pueden quedar vinculadas a usuarios de corridas previas: se reutilizan.
  const reuse = async (role: string, kp: Keypair) => {
    const ch = await call('POST', '/auth/wallet/challenge', undefined, { address: kp.publicKey() });
    const s = await call('POST', '/auth/session', undefined, {
      provider: 'stellar-wallet',
      challengeId: ch.challengeId,
      signature: signSep53(kp, ch.message),
    });
    const me = await call('GET', '/me', s.accessToken);
    return {
      token: s.accessToken as string,
      userId: s.userId as string,
      walletId: me.wallets.find((w: any) => w.address === kp.publicKey()).id as string,
      kp,
      role,
    };
  };
  const adminU = await login('admin@e2e.local');
  const imp = await reuse('importer', importerKp);
  const buyer = await reuse('buyer', buyerKp);
  const arb = await reuse('arbiter', arbiterKp);
  await call('POST', `/admin/users/${arb.userId}/roles`, adminU.token, { role: 'ARBITER' });

  let importer = await call('GET', '/importers/me', imp.token, undefined, [200, 403, 404]);
  if (!importer.id)
    importer = await call('POST', '/importers', imp.token, { publicName: `E2E Testnet ${run}` });
  await call('POST', `/admin/importers/${importer.id}/verify`, adminU.token);
  await call('PATCH', `/admin/importers/${importer.id}/limits`, adminU.token, {
    maxOrderAmountAtomic: (1000n * UNIT).toString(),
    maxAdvanceBps: 8000,
    allowedModes: ['FULL_ESCROW', 'PARTIAL_ADVANCE'],
  });
  await call('POST', '/importers/me/wallet/verify', imp.token, { walletId: imp.walletId });

  const in1h = new Date(Date.now() + 3600_000).toISOString();
  const newOrder = async (mode: 'FULL_ESCROW' | 'PARTIAL_ADVANCE', advance: bigint) => {
    const q = await call('POST', '/quotes', imp.token, {
      productUrl: 'https://www.amazon.com/dp/B0E2ETEST',
      productName: `Producto E2E ${mode}`,
      quantity: 1,
      destinationCity: 'Santa Cruz',
      deliveryEstimateDays: 15,
      purchaseTerms: 'Prueba E2E en Testnet',
      fiatPrice: '83.52',
      fiatCurrency: 'BOB',
      amountAtomic: TOTAL.toString(),
      fx: { rate: '6.96', spreadBps: 0, source: 'e2e-mock', expiresAt: in1h },
      escrowMode: mode,
      advanceAmountAtomic: advance.toString(),
      expiresAt: in1h,
      fulfillmentDeadline: new Date(Date.now() + 20 * 86400_000).toISOString(),
    });
    const pub = await call('POST', `/quotes/${q.id}/publish`, imp.token);
    const view = await call('GET', `/checkout/${pub.checkout.token}`);
    const acc = await call('POST', `/checkout/${pub.checkout.token}/accept`, buyer.token, {
      termsHash: view.termsHash,
      buyerWallet: buyerKp.publicKey(),
      acceptTerms: true,
      disclosureVersion: view.riskDisclosure.version,
      disclosureHash: view.riskDisclosure.hash,
    });
    // Rampa: cotiza (BOB simulado) -> KYC mock -> inicia -> "pago" simulado -> la caja entrega USDC real.
    const orderId = acc.orderId as string;
    const rq = await call('POST', `/orders/${orderId}/ramp/quote`, buyer.token);
    await call('POST', '/me/kyc/start', buyer.token, { corridorId: rq.route.id });
    await call('POST', `/orders/${orderId}/ramp/start`, buyer.token, {
      rampQuoteId: rq.rampQuoteId,
    });
    const paid = await call('POST', `/orders/${orderId}/ramp/simulate-payment`, buyer.token);
    if (paid.status !== 'COMPLETED')
      throw new Error(`rampa no completada: ${JSON.stringify(paid)}`);
    const st = await call('GET', `/orders/${orderId}`, buyer.token);
    if (st.states.payment !== 'WALLET_FUNDED')
      throw new Error('la rampa debía dejar WALLET_FUNDED');
    steps.push({
      step: `${mode}:ramp_delivery_from_caja`,
      txHash: paid.deliveryTxHash,
      explorer: paid.explorerUrl,
    });
    console.log(`  ✓ ${mode}:rampa (caja -> comprador, USDC de testnet)  ${paid.explorerUrl}`);
    return orderId;
  };
  const deliver = async (orderId: string) => {
    for (const state of ['PURCHASED', 'IN_TRANSIT', 'DELIVERED'])
      await call('PATCH', `/orders/${orderId}/logistics`, imp.token, { state });
  };

  console.log('Escenario 1 — FULL_ESCROW (Testnet)');
  const o1 = await newOrder('FULL_ESCROW', 0n);
  await signSubmit(
    buyer,
    o1,
    await call('POST', `/orders/${o1}/escrow/prepare-funding`, buyer.token),
    'full:create_and_fund',
  );
  let v = await call('GET', `/orders/${o1}/escrow`, buyer.token);
  if (v.onchain.status !== 'FUNDED' || v.onchain.remainingEscrow !== TOTAL.toString())
    throw new Error('FULL no financiado on-chain');
  await call('POST', `/orders/${o1}/advance/prepare`, imp.token, undefined, [422]);
  await deliver(o1);
  await signSubmit(
    buyer,
    o1,
    await call('POST', `/orders/${o1}/delivery/prepare-confirmation`, buyer.token),
    'full:confirm_delivery_and_release',
  );
  v = await call('GET', `/orders/${o1}`, buyer.token);
  if (v.states.onchain !== 'SETTLED' || v.escrow.projection.remainingEscrowAtomic !== '0')
    throw new Error('FULL no liquidado');

  console.log('Escenario 2 — PARTIAL_ADVANCE (Testnet)');
  const o2 = await newOrder('PARTIAL_ADVANCE', ADVANCE);
  await signSubmit(
    buyer,
    o2,
    await call('POST', `/orders/${o2}/escrow/prepare-funding`, buyer.token),
    'partial:create_and_fund',
  );
  await signSubmit(
    imp,
    o2,
    await call('POST', `/orders/${o2}/advance/prepare`, imp.token),
    'partial:claim_advance',
  );
  await call('POST', `/orders/${o2}/advance/prepare`, imp.token, undefined, [409]);
  await deliver(o2);
  const c2 = await call('POST', `/orders/${o2}/delivery/prepare-confirmation`, buyer.token);
  if (c2.releasesToImporterAtomic !== RETAINED.toString())
    throw new Error('saldo a liberar incorrecto');
  await signSubmit(buyer, o2, c2, 'partial:confirm_delivery_and_release');
  v = await call('GET', `/orders/${o2}`, buyer.token);
  if (
    v.states.onchain !== 'SETTLED' ||
    v.escrow.projection.sellerReleasedAtomic !== TOTAL.toString()
  )
    throw new Error('PARTIAL no liquidado');

  console.log('Escenario 3 — disputa tras anticipo (Testnet)');
  const o3 = await newOrder('PARTIAL_ADVANCE', ADVANCE);
  await signSubmit(
    buyer,
    o3,
    await call('POST', `/orders/${o3}/escrow/prepare-funding`, buyer.token),
    'dispute:create_and_fund',
  );
  await signSubmit(
    imp,
    o3,
    await call('POST', `/orders/${o3}/advance/prepare`, imp.token),
    'dispute:claim_advance',
  );
  const d = await call('POST', `/orders/${o3}/disputes`, buyer.token, {
    reason: 'E2E: el pedido no llegó en el plazo pactado.',
  });
  await signSubmit(buyer, o3, d.prepared, 'dispute:open_dispute');
  await call(
    'POST',
    `/orders/${o3}/disputes/${d.disputeId}/prepare-resolution`,
    adminU.token,
    {
      refundToBuyerAtomic: RETAINED.toString(),
      releaseToImporterAtomic: '0',
      resolution: 'no autorizado',
    },
    [403],
  );
  await call(
    'POST',
    `/orders/${o3}/disputes/${d.disputeId}/prepare-resolution`,
    arb.token,
    {
      refundToBuyerAtomic: TOTAL.toString(),
      releaseToImporterAtomic: '0',
      resolution: 'intento de devolver el anticipo',
    },
    [422],
  );
  const res = await call(
    'POST',
    `/orders/${o3}/disputes/${d.disputeId}/prepare-resolution`,
    arb.token,
    {
      refundToBuyerAtomic: RETAINED.toString(),
      releaseToImporterAtomic: '0',
      resolution: 'Se devuelve el saldo retenido por no entrega.',
    },
  );
  await signSubmit(arb, o3, res.prepared, 'dispute:resolve_dispute');
  v = await call('GET', `/orders/${o3}`, buyer.token);
  if (
    v.states.payment !== 'PARTIALLY_REFUNDED' ||
    v.escrow.projection.buyerRefundedAtomic !== RETAINED.toString()
  )
    throw new Error('resolución no proyectada');

  // Indexador + conciliación contra el RPC real: eventos idempotentes, sin duplicados.
  const { JobsService } = await import('../src/jobs/jobs.service');
  const { PrismaService } = await import('../src/common/prisma.service');
  const jobs = app.get(JobsService);
  const prisma = app.get(PrismaService);
  const latest = (
    await (
      await fetch(process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestLedger' }),
      })
    ).json()
  ).result.sequence;
  const cpId = `escrow:${dep.escrowContractId}`;
  await prisma.indexerCheckpoint.upsert({
    where: { id: cpId },
    create: { id: cpId, lastLedger: latest - 200 },
    update: { lastLedger: latest - 200, cursor: null },
  });
  const idx1 = await jobs.indexEvents();
  const before = await prisma.escrowTransaction.count({ where: { orderId: { in: [o1, o2, o3] } } });
  await jobs.indexEvents();
  const rec = await jobs.reconcile();
  const after = await prisma.escrowTransaction.count({ where: { orderId: { in: [o1, o2, o3] } } });
  if (after !== before) throw new Error('el indexador duplicó eventos');
  const byType = await prisma.escrowTransaction.groupBy({
    by: ['eventType', 'source'],
    where: { orderId: { in: [o1, o2, o3] } },
    _count: true,
  });
  report.indexer = { firstPass: idx1, escrowTransactions: after, byType, reconcile: rec };
  console.log(
    `  ✓ indexador: ${JSON.stringify(idx1)}; registros=${after} (sin duplicados); conciliación=${JSON.stringify(rec)}`,
  );

  report.orders = { full: o1, partial: o2, disputeAfterAdvance: o3 };
  report.result = 'OK';
  const out = path.join(ROOT, 'docs/deployments/testnet-api-e2e.json');
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(`OK — registro en ${out}`);
  await app.close();
}

main().catch((e) => {
  console.error('E2E FALLÓ:', e instanceof Error ? e.message : e);
  process.exit(1);
});
