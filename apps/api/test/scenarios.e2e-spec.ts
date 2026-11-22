/**
 * Escenarios de aceptación de la guía (§11) a través de la API HTTP + Postgres real,
 * con el gateway de escrow SIMULADO (mismas reglas que el contrato, firmas ed25519 reales).
 * La versión contra Testnet real está en scripts/e2e-testnet.ts.
 */
import { createHash } from 'crypto';
import { Keypair } from '@stellar/stellar-sdk';
import { hmacHex } from '../src/common/crypto';
import { SimulatedEscrowGateway } from '../src/stellar/simulated.gateway';
import {
  acceptCheckout,
  actor,
  admin,
  createApp,
  Ctx,
  fund,
  idem,
  publishQuote,
  quoteBody,
  signAndSubmit,
  UNIT,
  verifiedImporter,
} from './helpers';

const TOTAL = 1_200n * UNIT;
const ADVANCE = 900n * UNIT;
const RETAINED = 300n * UNIT;

let ctx: Ctx;
beforeAll(async () => {
  ctx = await createApp();
});
afterAll(async () => {
  await ctx.app.close();
});

const get = (path: string, auth: { Authorization: string }) =>
  ctx.http().get(`/api/v1${path}`).set(auth);
const post = (path: string, auth: { Authorization: string }, body: object = {}) =>
  ctx.http().post(`/api/v1${path}`).set(auth).set(idem()).send(body);

async function deliver(imp: { auth: { Authorization: string } }, orderId: string) {
  for (const state of ['PURCHASED', 'IN_TRANSIT', 'ARRIVED_BOLIVIA', 'DELIVERED'])
    await ctx
      .http()
      .patch(`/api/v1/orders/${orderId}/logistics`)
      .set(imp.auth)
      .send({
        state,
        ...(state === 'IN_TRANSIT' ? { trackingNumber: 'TRK-12345', carrier: 'DHL' } : {}),
      })
      .expect(200);
}

async function uploadEvidence(
  who: { auth: { Authorization: string } },
  orderId: string,
  type: string,
) {
  const pdf = Buffer.concat([
    Buffer.from('%PDF-1.4\n'),
    Buffer.from('comprobante de compra de prueba'),
  ]);
  const sha = createHash('sha256').update(pdf).digest('hex');
  const u = await post(`/orders/${orderId}/evidence/upload-url`, who.auth, {
    type,
    mimeType: 'application/pdf',
    sizeBytes: pdf.length,
    sha256: sha,
  }).expect(201);
  const path = new URL(u.body.uploadUrl);
  await ctx
    .http()
    .put(path.pathname + path.search)
    .set('content-type', 'application/pdf')
    .send(pdf)
    .expect(200);
  await post(`/orders/${orderId}/evidence/confirm-upload`, who.auth, {
    objectKey: u.body.objectKey,
  }).expect(201);
  return u.body.objectKey as string;
}

describe('Escenario 1 — FULL_ESCROW con capital propio', () => {
  it('fund 1.200 -> comprobante/tracking -> confirmación -> 1.200 a la importadora, saldo 0', async () => {
    const imp = await verifiedImporter(ctx, 'imp1@test.local');
    const buyer = await actor(ctx, 'buyer1@test.local');
    const { token } = await publishQuote(ctx, imp, quoteBody('FULL_ESCROW', TOTAL));

    // vista pública sanitizada
    const view = await ctx.http().get(`/api/v1/checkout/${token}`).expect(200);
    expect(JSON.stringify(view.body)).not.toMatch(/G[A-Z2-7]{55}/); // sin wallets
    expect(view.body.escrow).toMatchObject({
      mode: 'FULL_ESCROW',
      protectedAmountAtomic: TOTAL.toString(),
      simulated: true,
    });

    const { orderId } = await acceptCheckout(ctx, buyer, token);
    // sin tokens no se puede preparar el funding
    await post(`/orders/${orderId}/escrow/prepare-funding`, buyer.auth)
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe('INSUFFICIENT_TOKEN_BALANCE'));
    ctx.gateway.mint(buyer.kp.publicKey(), TOTAL);

    const { prep, sub } = await fund(ctx, buyer, orderId);
    expect(prep.body).toMatchObject({
      action: 'create_and_fund',
      signer: { role: 'BUYER', address: buyer.kp.publicKey() },
    });
    expect(prep.body.args.terms).toMatchObject({
      amountTotal: TOTAL.toString(),
      advanceAmount: '0',
      mode: 'FULL_ESCROW',
    });
    expect(sub.status).toBe(201);
    expect(sub.body).toMatchObject({
      status: 'CONFIRMED',
      order: { paymentState: 'ESCROW_FUNDED', onchainStatus: 'FUNDED' },
    });

    // API valida el saldo del contrato antes de ESCROW_FUNDED
    const esc = await get(`/orders/${orderId}/escrow`, buyer.auth).expect(200);
    expect(esc.body.onchain).toMatchObject({ remainingEscrow: TOTAL.toString(), status: 'FUNDED' });
    expect(await ctx.gateway.tokenBalance(ctx.gateway.contractId)).toBe(TOTAL);

    // FULL: no hay anticipo
    await post(`/orders/${orderId}/advance/prepare`, imp.auth)
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe('ADVANCE_NOT_ALLOWED'));
    // confirmación antes de la entrega: rechazada
    await post(`/orders/${orderId}/delivery/prepare-confirmation`, buyer.auth).expect(409);

    await uploadEvidence(imp, orderId, 'RECEIPT');
    await deliver(imp, orderId);
    const ev = await get(`/orders/${orderId}/evidence`, buyer.auth).expect(200);
    expect(ev.body).toHaveLength(1);
    const dl = new URL(ev.body[0].downloadUrl);
    await ctx
      .http()
      .get(dl.pathname + dl.search)
      .expect(200);
    await ctx
      .http()
      .get(dl.pathname + '?exp=1&sig=00')
      .expect(403); // URL sin firma válida

    // la importadora no puede confirmar por el comprador
    await post(`/orders/${orderId}/delivery/prepare-confirmation`, imp.auth).expect(403);
    const conf = await post(`/orders/${orderId}/delivery/prepare-confirmation`, buyer.auth).expect(
      201,
    );
    expect(conf.body.releasesToImporterAtomic).toBe(TOTAL.toString());
    const done = await signAndSubmit(ctx, buyer, orderId, conf.body);
    expect(done.body.status).toBe('CONFIRMED');

    const o = await get(`/orders/${orderId}`, buyer.auth).expect(200);
    expect(o.body.states).toEqual({
      payment: 'ESCROW_FUNDED',
      logistic: 'ACCEPTED',
      dispute: 'NONE',
      onchain: 'SETTLED',
    });
    expect(o.body.escrow.projection).toMatchObject({
      sellerReleasedAtomic: TOTAL.toString(),
      remainingEscrowAtomic: '0',
    });
    expect(o.body.summary.code).toBe('COMPLETED');
    expect(await ctx.gateway.tokenBalance(imp.kp.publicKey())).toBe(TOTAL);
    const txs = await ctx.prisma.escrowTransaction.findMany({ where: { orderId } });
    expect(txs.map((t) => t.eventType).sort()).toEqual([
      'delivery_confirmed',
      'escrow_created',
      'funded',
    ]);
  });
});

describe('Escenario 2 — PARTIAL_ADVANCE', () => {
  it('fund 1.200 -> anticipo 900 ANTES de comprar -> entrega -> 300; sin dobles reclamos', async () => {
    const imp = await verifiedImporter(ctx, 'imp2@test.local', {
      maxAdvanceBps: 8000,
      modes: ['FULL_ESCROW', 'PARTIAL_ADVANCE'],
    });
    const buyer = await actor(ctx, 'buyer2@test.local');
    const { token } = await publishQuote(ctx, imp, quoteBody('PARTIAL_ADVANCE', TOTAL, ADVANCE));
    const view = await ctx.http().get(`/api/v1/checkout/${token}`).expect(200);
    expect(view.body.escrow).toMatchObject({
      advanceBps: 7500,
      protectedAmountAtomic: RETAINED.toString(),
    });
    expect(view.body.riskDisclosure.text).toMatch(/NO puede ser recuperado/);
    expect(view.body.riskDisclosure.text).toMatch(/900/);

    const { orderId } = await acceptCheckout(ctx, buyer, token);
    const consent = await ctx.prisma.consentRecord.findFirstOrThrow({ where: { orderId } });
    expect(consent).toMatchObject({
      disclosureVersion: 'partial/v1',
      advanceAmountAtomic: ADVANCE,
      protectedAmountAtomic: RETAINED,
    });

    ctx.gateway.mint(buyer.kp.publicKey(), TOTAL);
    // anticipo antes del funding: imposible
    await post(`/orders/${orderId}/advance/prepare`, imp.auth).expect(409);
    await fund(ctx, buyer, orderId);

    // anticipo sin comprobante de compra (logística NOT_PURCHASED)
    const adv = await post(`/orders/${orderId}/advance/prepare`, imp.auth).expect(201);
    expect(adv.body.signer).toMatchObject({ role: 'IMPORTER', address: imp.kp.publicKey() });
    // el comprador no puede firmar por la importadora
    await signAndSubmit(ctx, buyer, orderId, adv.body).expect(403);
    const advDone = await signAndSubmit(ctx, imp, orderId, adv.body).expect(201);
    expect(advDone.body.status).toBe('CONFIRMED');
    expect(await ctx.gateway.tokenBalance(imp.kp.publicKey())).toBe(ADVANCE);
    let o = await get(`/orders/${orderId}`, imp.auth).expect(200);
    expect(o.body.states.onchain).toBe('ADVANCE_PAID');
    expect(o.body.escrow.projection.remainingEscrowAtomic).toBe(RETAINED.toString());
    expect(o.body.states.logistic).toBe('NOT_PURCHASED');

    // segundo anticipo: rechazado (API y contrato)
    await post(`/orders/${orderId}/advance/prepare`, imp.auth).expect(409);
    // re-enviar la misma tx confirmada no duplica
    const again = await signAndSubmit(ctx, imp, orderId, adv.body);
    expect(again.body.status).toBe('CONFIRMED');
    expect(await ctx.gateway.tokenBalance(imp.kp.publicKey())).toBe(ADVANCE);

    await uploadEvidence(imp, orderId, 'RECEIPT');
    await deliver(imp, orderId);
    const conf = await post(`/orders/${orderId}/delivery/prepare-confirmation`, buyer.auth).expect(
      201,
    );
    expect(conf.body.releasesToImporterAtomic).toBe(RETAINED.toString());
    await signAndSubmit(ctx, buyer, orderId, conf.body).expect(201);
    o = await get(`/orders/${orderId}`, buyer.auth).expect(200);
    expect(o.body.states.onchain).toBe('SETTLED');
    expect(o.body.escrow.projection).toMatchObject({
      remainingEscrowAtomic: '0',
      sellerReleasedAtomic: TOTAL.toString(),
      advanceReleasedAtomic: ADVANCE.toString(),
    });
    expect(await ctx.gateway.tokenBalance(imp.kp.publicKey())).toBe(TOTAL);
    await post(`/orders/${orderId}/delivery/prepare-confirmation`, buyer.auth).expect(409);
  });

  it('el anticipo no puede superar el límite de la importadora; por defecto está deshabilitado', async () => {
    const imp = await verifiedImporter(ctx, 'imp2b@test.local'); // defaults: solo FULL, 0 bps
    const q = await post('/quotes', imp.auth, quoteBody('PARTIAL_ADVANCE', TOTAL, ADVANCE)).expect(
      201,
    );
    await post(`/quotes/${q.body.id}/publish`, imp.auth)
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe('MODE_NOT_ALLOWED'));
    const imp2 = await verifiedImporter(ctx, 'imp2c@test.local', {
      maxAdvanceBps: 5000,
      modes: ['PARTIAL_ADVANCE'],
    });
    const q2 = await post(
      '/quotes',
      imp2.auth,
      quoteBody('PARTIAL_ADVANCE', TOTAL, ADVANCE),
    ).expect(201);
    await post(`/quotes/${q2.body.id}/publish`, imp2.auth)
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe('ADVANCE_LIMIT_EXCEEDED'));
    // el admin no puede autorizar más que el tope del contrato
    await ctx
      .http()
      .patch(`/api/v1/admin/importers/${imp2.importerId}/limits`)
      .set(await admin(ctx))
      .send({ maxOrderAmountAtomic: '1', maxAdvanceBps: 9500, allowedModes: ['PARTIAL_ADVANCE'] })
      .expect(422);
  });
});

describe('Escenario 3 — incumplimiento tras anticipo', () => {
  it('disputa: no autorizados no resuelven; árbitro devuelve 300; la API no promete 1.200', async () => {
    const imp = await verifiedImporter(ctx, 'imp3@test.local', {
      maxAdvanceBps: 8000,
      modes: ['PARTIAL_ADVANCE'],
    });
    const buyer = await actor(ctx, 'buyer3@test.local');
    const { token } = await publishQuote(ctx, imp, quoteBody('PARTIAL_ADVANCE', TOTAL, ADVANCE));
    const { orderId } = await acceptCheckout(ctx, buyer, token);
    ctx.gateway.mint(buyer.kp.publicKey(), TOTAL);
    await fund(ctx, buyer, orderId);
    const adv = await post(`/orders/${orderId}/advance/prepare`, imp.auth).expect(201);
    await signAndSubmit(ctx, imp, orderId, adv.body).expect(201);

    const d = await post(`/orders/${orderId}/disputes`, buyer.auth, {
      reason: 'El producto nunca llegó y la importadora no responde.',
    }).expect(201);
    expect(d.body.prepared).toMatchObject({ action: 'open_dispute', signer: { role: 'BUYER' } });
    await signAndSubmit(ctx, buyer, orderId, d.body.prepared).expect(201);
    let o = await get(`/orders/${orderId}`, buyer.auth).expect(200);
    expect(o.body.states).toMatchObject({ dispute: 'OPEN', onchain: 'DISPUTED' });
    expect(o.body.summary.code).toBe('IN_DISPUTE');

    // la importadora no puede liberar saldo durante la disputa
    await ctx
      .http()
      .patch(`/api/v1/orders/${orderId}/logistics`)
      .set(imp.auth)
      .send({ state: 'DELIVERED' })
      .expect(200);
    await post(`/orders/${orderId}/delivery/prepare-confirmation`, buyer.auth).expect(409);

    // cuentas no autorizadas no pueden resolver (ni con rol ADMIN, ni un ARBITER con otra wallet)
    const adm = await admin(ctx);
    const body = {
      refundToBuyerAtomic: RETAINED.toString(),
      releaseToImporterAtomic: '0',
      resolution: 'Devolución del saldo retenido por no entrega.',
    };
    await post(
      `/orders/${orderId}/disputes/${d.body.disputeId}/prepare-resolution`,
      adm,
      body,
    ).expect(403);
    await post(
      `/orders/${orderId}/disputes/${d.body.disputeId}/prepare-resolution`,
      imp.auth,
      body,
    ).expect(403);
    const fakeArb = await actor(ctx, 'fakearb@test.local');
    await post(`/admin/users/${fakeArb.userId}/roles`, adm, { role: 'ARBITER' }).expect(201);
    await post(
      `/orders/${orderId}/disputes/${d.body.disputeId}/prepare-resolution`,
      fakeArb.auth,
      body,
    ).expect(404);

    // árbitro real (wallet = arbiter on-chain)
    const arb = await actor(ctx, 'arbiter@test.local', ctx.arbiterKp);
    await post(`/admin/users/${arb.userId}/roles`, adm, { role: 'ARBITER' }).expect(201);
    await post(`/orders/${orderId}/disputes/${d.body.disputeId}/review`, arb.auth).expect(201);
    // intentar repartir 1.200 (incluye el anticipo pagado): rechazado
    await post(`/orders/${orderId}/disputes/${d.body.disputeId}/prepare-resolution`, arb.auth, {
      ...body,
      refundToBuyerAtomic: TOTAL.toString(),
    })
      .expect(422)
      .expect((r) => expect(r.body.error.details.remainingEscrowAtomic).toBe(RETAINED.toString()));
    const res = await post(
      `/orders/${orderId}/disputes/${d.body.disputeId}/prepare-resolution`,
      arb.auth,
      body,
    ).expect(201);
    expect(res.body.note).toMatch(/anticipo ya pagado/);
    await signAndSubmit(ctx, arb, orderId, res.body.prepared).expect(201);

    o = await get(`/orders/${orderId}`, buyer.auth).expect(200);
    expect(o.body.states).toMatchObject({
      dispute: 'RESOLVED',
      onchain: 'SETTLED',
      payment: 'PARTIALLY_REFUNDED',
    });
    expect(o.body.escrow.projection).toMatchObject({
      buyerRefundedAtomic: RETAINED.toString(),
      remainingEscrowAtomic: '0',
      sellerReleasedAtomic: ADVANCE.toString(),
    });
    const esc = await get(`/orders/${orderId}/escrow`, buyer.auth).expect(200);
    expect(esc.body.protection.alreadyReleasedToImporterAtomic).toBe(ADVANCE.toString());
    expect(await ctx.gateway.tokenBalance(buyer.kp.publicKey())).toBe(RETAINED);
    const dispute = await ctx.prisma.dispute.findUniqueOrThrow({ where: { id: d.body.disputeId } });
    expect(dispute.status).toBe('RESOLVED');
  });
});

describe('Escenario 4 — rampa OK pero el token no llegó al contrato', () => {
  it('WALLET_FUNDED / ESCROW_PENDING no habilitan anticipo; la conciliación aplica el funding una sola vez', async () => {
    const imp = await verifiedImporter(ctx, 'imp4@test.local', {
      maxAdvanceBps: 8000,
      modes: ['PARTIAL_ADVANCE'],
    });
    const buyer = await actor(ctx, 'buyer4@test.local');
    const { token } = await publishQuote(ctx, imp, quoteBody('PARTIAL_ADVANCE', TOTAL, ADVANCE));
    const { orderId } = await acceptCheckout(ctx, buyer, token);

    const rq = await post(`/orders/${orderId}/ramp/quote`, buyer.auth).expect(201);
    expect(rq.body.simulated).toBe(true);
    await post(`/me/kyc/start`, buyer.auth, { corridorId: rq.body.route.id }).expect(201);
    const st = await post(`/orders/${orderId}/ramp/start`, buyer.auth, {
      rampQuoteId: rq.body.rampQuoteId,
    }).expect(201);
    const ref = st.body.ramp.providerReference as string;

    // webhook mock firmado (y uno falso)
    const payload = JSON.stringify({
      eventId: 'evt-1',
      providerReference: ref,
      outcome: 'COMPLETED',
    });
    const ts = String(Math.floor(Date.now() / 1000));
    await ctx
      .http()
      .post('/api/v1/webhooks/mock-ramp')
      .set('content-type', 'application/json')
      .set('x-mock-timestamp', ts)
      .set('x-mock-signature', 'ab'.repeat(32))
      .send(payload)
      .expect(401);
    const sig = hmacHex(process.env.MOCK_WEBHOOK_SECRET!, `${ts}.${payload}`);
    const send = () =>
      ctx
        .http()
        .post('/api/v1/webhooks/mock-ramp')
        .set('content-type', 'application/json')
        .set('x-mock-timestamp', ts)
        .set('x-mock-signature', sig)
        .send(payload);
    expect((await send().expect(200)).body).toMatchObject({ duplicate: false, applied: true });
    expect((await send().expect(200)).body).toMatchObject({ duplicate: true });

    let o = await get(`/orders/${orderId}`, buyer.auth).expect(200);
    expect(o.body.states.payment).toBe('WALLET_FUNDED');
    expect(o.body.summary.code).toBe('WALLET_FUNDED');
    await post(`/orders/${orderId}/advance/prepare`, imp.auth).expect(409);
    await ctx
      .http()
      .patch(`/api/v1/orders/${orderId}/logistics`)
      .set(imp.auth)
      .send({ state: 'PURCHASED' })
      .expect(409);

    // el comprador firma el funding pero el "envío" no ocurre por la API (p. ej. se cae el cliente)
    const prep = await post(`/orders/${orderId}/escrow/prepare-funding`, buyer.auth).expect(201);
    o = await get(`/orders/${orderId}`, buyer.auth).expect(200);
    expect(o.body.states.payment).toBe('ESCROW_PENDING');
    await post(`/orders/${orderId}/advance/prepare`, imp.auth).expect(409);
    // la transacción llega a la red por otra vía (el cliente la envió directamente)
    const signed = SimulatedEscrowGateway.sign(prep.body.unsignedXdr, buyer.kp);
    expect((await ctx.gateway.submit(signed, prep.body.txHash)).status).toBe('SUCCESS');

    const jobs = ctx.app.get((await import('../src/jobs/jobs.service')).JobsService);
    await jobs.indexEvents();
    await jobs.indexEvents(); // re-ejecución idempotente
    await jobs.reconcile();
    o = await get(`/orders/${orderId}`, buyer.auth).expect(200);
    expect(o.body.states).toMatchObject({ payment: 'ESCROW_FUNDED', onchain: 'FUNDED' });
    const funded = await ctx.prisma.escrowTransaction.findMany({
      where: { orderId, eventType: 'funded' },
    });
    expect(funded).toHaveLength(1);
    const payEvents = await ctx.prisma.orderEvent.findMany({
      where: { orderId, kind: 'payment', to: 'ESCROW_FUNDED' },
    });
    expect(payEvents).toHaveLength(1);
    await post(`/orders/${orderId}/advance/prepare`, imp.auth).expect(201);
  });
});

describe('Escenario 5 — acceso y condiciones', () => {
  it('usuario ajeno no ve ni opera; términos viejos o vencidos no financian; requests duplicados no duplican', async () => {
    const imp = await verifiedImporter(ctx, 'imp5@test.local');
    const buyer = await actor(ctx, 'buyer5@test.local');
    const stranger = await actor(ctx, 'stranger5@test.local');
    const { token, quoteId } = await publishQuote(ctx, imp, quoteBody('FULL_ESCROW', TOTAL));

    // la importadora no puede comprar su propia cotización
    const view = await ctx.http().get(`/api/v1/checkout/${token}`).expect(200);
    const acceptBody = (w: string, termsHash = view.body.termsHash) => ({
      termsHash,
      buyerWallet: w,
      acceptTerms: true,
      disclosureVersion: view.body.riskDisclosure.version,
      disclosureHash: view.body.riskDisclosure.hash,
    });
    await post(`/checkout/${token}/accept`, imp.auth, acceptBody(imp.kp.publicKey())).expect(403);
    // términos distintos a los vigentes
    await post(
      `/checkout/${token}/accept`,
      buyer.auth,
      acceptBody(buyer.kp.publicKey(), 'ff'.repeat(32)),
    ).expect(409);
    // wallet sin prueba de posesión
    await post(
      `/checkout/${token}/accept`,
      buyer.auth,
      acceptBody(Keypair.random().publicKey()),
    ).expect(422);
    // consentimiento sin aceptar
    await post(`/checkout/${token}/accept`, buyer.auth, {
      ...acceptBody(buyer.kp.publicKey()),
      acceptTerms: false,
    }).expect(400);
    // sin sesión
    await ctx
      .http()
      .post(`/api/v1/checkout/${token}/accept`)
      .set(idem())
      .send(acceptBody(buyer.kp.publicKey()))
      .expect(401);

    // idempotencia: dos requests idénticos con la misma clave => misma respuesta, una sola orden
    const key = { 'Idempotency-Key': 'accept-key-0001' };
    const a1 = await ctx
      .http()
      .post(`/api/v1/checkout/${token}/accept`)
      .set(buyer.auth)
      .set(key)
      .send(acceptBody(buyer.kp.publicKey()))
      .expect(201);
    const a2 = await ctx
      .http()
      .post(`/api/v1/checkout/${token}/accept`)
      .set(buyer.auth)
      .set(key)
      .send(acceptBody(buyer.kp.publicKey()))
      .expect(201);
    expect(a2.headers['idempotent-replayed']).toBe('true');
    expect(a2.body.orderId).toBe(a1.body.orderId);
    await ctx
      .http()
      .post(`/api/v1/checkout/${token}/accept`)
      .set(buyer.auth)
      .set(key)
      .send({ ...acceptBody(buyer.kp.publicKey()), disclosureVersion: 'x' })
      .expect(422);
    expect(await ctx.prisma.order.count({ where: { quoteId } })).toBe(1);
    // el enlace no se reutiliza por otro comprador
    await post(
      `/checkout/${token}/accept`,
      stranger.auth,
      acceptBody(stranger.kp.publicKey()),
    ).expect(409);
    // sin Idempotency-Key en endpoint mutador
    await ctx
      .http()
      .post(`/api/v1/orders/${a1.body.orderId}/escrow/prepare-funding`)
      .set(buyer.auth)
      .expect(400);

    const orderId = a1.body.orderId as string;
    // IDOR: ajeno recibe 404 en todo
    await get(`/orders/${orderId}`, stranger.auth).expect(404);
    await get(`/orders/${orderId}/escrow`, stranger.auth).expect(404);
    await get(`/orders/${orderId}/evidence`, stranger.auth).expect(404);
    await post(`/orders/${orderId}/escrow/prepare-funding`, stranger.auth).expect(404);
    await post(`/orders/${orderId}/disputes`, stranger.auth, {
      reason: 'intento de abrir disputa ajena',
    }).expect(404);
    await get(`/quotes/${quoteId}`, stranger.auth).expect(403); // requiere rol importadora

    // el usuario ajeno no puede enviar una tx preparada para el comprador, ni el comprador una alterada
    ctx.gateway.mint(buyer.kp.publicKey(), TOTAL);
    const prep = await post(`/orders/${orderId}/escrow/prepare-funding`, buyer.auth).expect(201);
    await signAndSubmit(ctx, stranger, orderId, prep.body).expect(404);
    const other = await ctx.gateway.prepare(
      {
        ...(prep.body.args as object),
        terms: {
          ...prep.body.args.terms,
          amountTotal: 1n,
          advanceAmount: 0n,
          fundingDeadline: Number(prep.body.args.terms.fundingDeadline),
          fulfillmentDeadline: Number(prep.body.args.terms.fulfillmentDeadline),
        },
      } as never,
      buyer.kp.publicKey(),
    );
    await ctx
      .http()
      .post(`/api/v1/orders/${orderId}/escrow/submit`)
      .set(buyer.auth)
      .set(idem())
      .send({
        preparedId: prep.body.preparedId,
        signedXdr: SimulatedEscrowGateway.sign(other.unsignedXdr, buyer.kp),
      })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe('TX_MISMATCH'));
    // firma de otra cuenta sobre la tx correcta
    await ctx
      .http()
      .post(`/api/v1/orders/${orderId}/escrow/submit`)
      .set(buyer.auth)
      .set(idem())
      .send({
        preparedId: prep.body.preparedId,
        signedXdr: SimulatedEscrowGateway.sign(prep.body.unsignedXdr, stranger.kp),
      })
      .expect(422);
    // envío legítimo, dos veces
    const s1 = await signAndSubmit(ctx, buyer, orderId, prep.body).expect(201);
    const s2 = await signAndSubmit(ctx, buyer, orderId, prep.body).expect(201);
    expect(s1.body.txHash).toBe(s2.body.txHash);
    expect(await ctx.gateway.tokenBalance(ctx.gateway.contractId)).toBeGreaterThanOrEqual(TOTAL);
    expect(
      await ctx.prisma.escrowTransaction.count({ where: { orderId, eventType: 'funded' } }),
    ).toBe(1);
    // segundo funding imposible
    await post(`/orders/${orderId}/escrow/prepare-funding`, buyer.auth).expect(409);
  });

  it('cotización vencida (o FX vencido) no permite financiar con términos viejos', async () => {
    const imp = await verifiedImporter(ctx, 'imp6@test.local');
    const buyer = await actor(ctx, 'buyer6@test.local');
    const { token } = await publishQuote(ctx, imp, quoteBody('FULL_ESCROW', TOTAL));
    const { orderId } = await acceptCheckout(ctx, buyer, token);
    // simula que el FX/la cotización vencieron antes del depósito
    await ctx.prisma.order.update({
      where: { id: orderId },
      data: { fundingDeadline: new Date(Date.now() - 1000) },
    });
    ctx.gateway.mint(buyer.kp.publicKey(), TOTAL);
    await post(`/orders/${orderId}/escrow/prepare-funding`, buyer.auth)
      .expect(409)
      .expect((r) => expect(r.body.error.code).toBe('QUOTE_RECALCULATION_REQUIRED'));
    const o = await ctx.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { quote: true },
    });
    expect(o.quote.status).toBe('EXPIRED');
    expect(o.paymentState).toBe('NOT_STARTED');

    // una cotización DRAFT modificada no conserva el hash anterior; una publicada no se edita
    const q = await post('/quotes', imp.auth, quoteBody('FULL_ESCROW', TOTAL)).expect(201);
    await ctx
      .http()
      .patch(`/api/v1/quotes/${q.body.id}`)
      .set(imp.auth)
      .send({ expectedVersion: 1, amountAtomic: (1_100n * UNIT).toString() })
      .expect(200);
    await ctx
      .http()
      .patch(`/api/v1/quotes/${q.body.id}`)
      .set(imp.auth)
      .send({ expectedVersion: 1, amountAtomic: '1' })
      .expect(409);
    await post(`/quotes/${q.body.id}/publish`, imp.auth).expect(201);
    await ctx
      .http()
      .patch(`/api/v1/quotes/${q.body.id}`)
      .set(imp.auth)
      .send({ expectedVersion: 2, amountAtomic: '1' })
      .expect(409);
  });

  it('URLs de producto internas o no https se rechazan; evidencias con MIME falso se rechazan', async () => {
    const imp = await verifiedImporter(ctx, 'imp7@test.local');
    await post(
      '/quotes',
      imp.auth,
      quoteBody('FULL_ESCROW', TOTAL, 0n, { productUrl: 'http://169.254.169.254/latest' }),
    ).expect(422);
    const buyer = await actor(ctx, 'buyer7@test.local');
    const { token } = await publishQuote(ctx, imp, quoteBody('FULL_ESCROW', TOTAL));
    const { orderId } = await acceptCheckout(ctx, buyer, token);
    const fake = Buffer.from('<html>no soy un pdf</html>');
    const sha = createHash('sha256').update(fake).digest('hex');
    await post(`/orders/${orderId}/evidence/upload-url`, buyer.auth, {
      type: 'RECEIPT',
      mimeType: 'application/pdf',
      sizeBytes: fake.length,
      sha256: sha,
    }).expect(403); // comprador no sube RECEIPT
    await post(`/orders/${orderId}/evidence/upload-url`, imp.auth, {
      type: 'RECEIPT',
      mimeType: 'text/html',
      sizeBytes: fake.length,
      sha256: sha,
    }).expect(422);
    const u = await post(`/orders/${orderId}/evidence/upload-url`, imp.auth, {
      type: 'RECEIPT',
      mimeType: 'application/pdf',
      sizeBytes: fake.length,
      sha256: sha,
    }).expect(201);
    const path = new URL(u.body.uploadUrl);
    await ctx
      .http()
      .put(path.pathname + path.search)
      .set('content-type', 'application/pdf')
      .send(fake)
      .expect(200);
    await post(`/orders/${orderId}/evidence/confirm-upload`, imp.auth, {
      objectKey: u.body.objectKey,
    })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe('MIME_MISMATCH'));
  });
});

describe('Operación', () => {
  it('health, ready y swagger', async () => {
    await ctx.http().get('/health').expect(200);
    const r = await ctx.http().get('/ready').expect(200);
    expect(r.body.checks.stellar.simulated).toBe(true);
    const doc = await ctx.http().get('/docs/openapi.json').expect(200);
    expect(Object.keys(doc.body.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/orders/{id}/escrow/prepare-funding',
        '/api/v1/checkout/{token}',
      ]),
    );
  });

  it('login con wallet embebida de Pollar (patrón WorkVille): firma SEP-53, origen solo informativo', async () => {
    // La UI: Pollar email login -> client.stellar.sep53.signMessage(message). Aquí la wallet embebida se
    // representa con una keypair (Pollar firma con el mismo esquema SEP-53).
    const pollarWallet = Keypair.random();
    const { signSep53 } = await import('../src/common/auth/sep53');
    const cfg = await ctx.http().get('/api/v1/config').expect(200);
    expect(cfg.body.auth).toMatchObject({
      signature: 'sep53',
      challengeEndpoint: '/api/v1/auth/wallet/challenge',
    });
    expect(cfg.body.pollar).toBeNull(); // sin POLLAR_API_KEY no se ofrece
    const ch = await ctx
      .http()
      .post('/api/v1/auth/wallet/challenge')
      .send({ address: pollarWallet.publicKey() })
      .expect(201);
    const s = await ctx
      .http()
      .post('/api/v1/auth/session')
      .send({
        provider: 'stellar-wallet',
        walletProvider: 'pollar',
        challengeId: ch.body.challengeId,
        signature: signSep53(pollarWallet, ch.body.message),
      })
      .expect(201);
    const me = await ctx
      .http()
      .get('/api/v1/me')
      .set({ Authorization: `Bearer ${s.body.accessToken}` })
      .expect(200);
    expect(me.body.wallets[0]).toMatchObject({
      address: pollarWallet.publicKey(),
      provider: 'pollar',
      verified: true,
    });
    expect(me.body.email).toBeNull(); // el correo de Pollar no se acepta sin verificación de servidor
    // declarar "pollar" no sirve de nada sin la firma correcta
    const ch2 = await ctx
      .http()
      .post('/api/v1/auth/wallet/challenge')
      .send({ address: pollarWallet.publicKey() })
      .expect(201);
    await ctx
      .http()
      .post('/api/v1/auth/session')
      .send({
        provider: 'stellar-wallet',
        walletProvider: 'pollar',
        challengeId: ch2.body.challengeId,
        signature: signSep53(Keypair.random(), ch2.body.message),
      })
      .expect(401);
  });

  it('login por wallet (SEP-53) con desafío de un solo uso', async () => {
    const kp = Keypair.random();
    const { signSep53 } = await import('../src/common/auth/sep53');
    const ch = await ctx
      .http()
      .post('/api/v1/auth/wallet/challenge')
      .send({ address: kp.publicKey() })
      .expect(201);
    await ctx
      .http()
      .post('/api/v1/auth/session')
      .send({
        provider: 'stellar-wallet',
        challengeId: ch.body.challengeId,
        signature: signSep53(Keypair.random(), ch.body.message),
      })
      .expect(401);
    const ok = await ctx
      .http()
      .post('/api/v1/auth/session')
      .send({
        provider: 'stellar-wallet',
        challengeId: ch.body.challengeId,
        signature: signSep53(kp, ch.body.message),
      })
      .expect(201);
    expect(ok.body.simulated).toBe(false);
    await ctx
      .http()
      .post('/api/v1/auth/session')
      .send({
        provider: 'stellar-wallet',
        challengeId: ch.body.challengeId,
        signature: signSep53(kp, ch.body.message),
      })
      .expect(401);
    const me = await ctx
      .http()
      .get('/api/v1/me')
      .set({ Authorization: `Bearer ${ok.body.accessToken}` })
      .expect(200);
    expect(me.body.wallets[0]).toMatchObject({ address: kp.publicKey(), verified: true });
    // OTP erróneo
    await ctx.http().post('/api/v1/auth/otp/request').send({ email: 'x@test.local' }).expect(201);
    await ctx
      .http()
      .post('/api/v1/auth/session')
      .send({ provider: 'mock-email-otp', email: 'x@test.local', code: '000000' })
      .expect(401);
  });
});
