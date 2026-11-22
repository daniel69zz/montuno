/**
 * Catálogo/proveedores/solicitudes de cotización + motor de escrow Trustless Work (beta) contra un servidor
 * FALSO que respeta los esquemas documentados de su Core API v2.
 */
import { signPreparedXdr } from '../src/stellar/soroban.gateway';
import { FakeTrustlessWork } from './fake-trustless-work';
import {
  acceptCheckout,
  actor,
  Actor,
  admin,
  createApp,
  Ctx,
  idem,
  quoteBody,
  UNIT,
  verifiedImporter,
} from './helpers';

const PASS = 'Test SDF Network ; September 2015';
const TOTAL = 12n * UNIT;
let ctx: Ctx;
const tw = new FakeTrustlessWork();

beforeAll(async () => {
  await tw.start();
  ctx = await createApp();
});
afterAll(async () => {
  await ctx.app.close();
  await tw.stop();
});

const post = (path: string, auth: { Authorization: string }, body: object = {}) =>
  ctx.http().post(`/api/v1${path}`).set(auth).set(idem()).send(body);
const get = (path: string, auth?: { Authorization: string }) =>
  auth ? ctx.http().get(`/api/v1${path}`).set(auth) : ctx.http().get(`/api/v1${path}`);
const submitXdr = (who: Actor, orderId: string, p: { preparedId: string; unsignedXdr: string }) =>
  post(`/orders/${orderId}/escrow/submit`, who.auth, {
    preparedId: p.preparedId,
    signedXdr: signPreparedXdr(p.unsignedXdr, PASS, who.kp),
  });

const item = {
  title: 'iPhone 16 Pro 256GB',
  category: 'telefonia',
  description: 'Importación desde Apple Store US, sellado, con garantía internacional.',
  referencePriceFiat: '9800.00',
  fiatCurrency: 'BOB',
  referenceUrl: 'https://www.apple.com/shop/buy-iphone/iphone-16-pro',
  deliveryEstimateDays: 18,
};

describe('catálogo, proveedores y solicitudes de cotización', () => {
  it('solo muestra productos de importadoras VERIFIED, sin datos privados', async () => {
    const imp = await verifiedImporter(ctx, 'cat-imp@test.local');
    const created = await post('/importers/me/catalog', imp.auth, item).expect(201);
    // importadora no verificada: su producto no aparece
    const pending = await actor(ctx, 'cat-pending@test.local');
    await post('/importers', pending.auth, { publicName: 'Pendiente SRL' }).expect(201);
    const login2 = await actor(ctx, 'cat-pending2@test.local');
    void login2;

    const list = await get('/catalog').expect(200);
    expect(list.body.map((i: { id: string }) => i.id)).toContain(created.body.id);
    expect(
      list.body.every(
        (i: { provider: { publicName: string } }) => i.provider.publicName !== 'Pendiente SRL',
      ),
    ).toBe(true);
    expect(JSON.stringify(list.body)).not.toMatch(/G[A-Z2-7]{55}/); // sin wallets
    await get(`/catalog?q=iphone&category=telefonia`)
      .expect(200)
      .expect((r) => expect(r.body).toHaveLength(1));
    await get('/catalog/categories').expect(200);
    const provs = await get('/providers').expect(200);
    expect(provs.body.find((p: { id: string }) => p.id === imp.importerId)).toMatchObject({
      catalogItems: 1,
      offersAdvance: false,
    });
    await get(`/providers/${imp.importerId}`)
      .expect(200)
      .expect((r) => expect(r.body.items).toHaveLength(1));
    // URL interna rechazada; desactivar oculta el producto
    await post('/importers/me/catalog', imp.auth, {
      ...item,
      referenceUrl: 'http://10.0.0.1/x',
    }).expect(422);
    await ctx
      .http()
      .patch(`/api/v1/importers/me/catalog/${created.body.id}`)
      .set(imp.auth)
      .send({ active: false })
      .expect(200);
    await get(`/catalog/${created.body.id}`).expect(404);
  });

  it('solicitud -> cotización vinculada -> solo el comprador recupera el enlace de checkout', async () => {
    const imp = await verifiedImporter(ctx, 'req-imp@test.local');
    const it1 = await post('/importers/me/catalog', imp.auth, item).expect(201);
    const buyer = await actor(ctx, 'req-buyer@test.local');
    const other = await actor(ctx, 'req-other@test.local');

    await post('/quote-requests', imp.auth, {
      importerId: imp.importerId,
      catalogItemId: it1.body.id,
      details: 'yo mismo',
      quantity: 1,
      destinationCity: 'La Paz',
    }).expect(403);
    await post('/quote-requests', buyer.auth, {
      importerId: imp.importerId,
      details: 'sin producto',
      quantity: 1,
      destinationCity: 'La Paz',
    }).expect(422);
    const req = await post('/quote-requests', buyer.auth, {
      importerId: imp.importerId,
      catalogItemId: it1.body.id,
      details: 'Color negro, por favor',
      quantity: 1,
      destinationCity: 'Cochabamba',
    }).expect(201);
    expect(req.body).toMatchObject({ status: 'OPEN', checkoutToken: null });

    const inbox = await get('/importers/me/quote-requests', imp.auth).expect(200);
    expect(inbox.body[0]).toMatchObject({ id: req.body.id, details: 'Color negro, por favor' });
    expect(inbox.body[0].checkoutToken).toBeUndefined();

    // otra importadora no puede responder esta solicitud
    const imp2 = await verifiedImporter(ctx, 'req-imp2@test.local');
    await post(
      '/quotes',
      imp2.auth,
      quoteBody('FULL_ESCROW', TOTAL, 0n, { serviceFeeAtomic: '0', quoteRequestId: req.body.id }),
    ).expect(404);

    const q = await post(
      '/quotes',
      imp.auth,
      quoteBody('FULL_ESCROW', TOTAL, 0n, { serviceFeeAtomic: '0', quoteRequestId: req.body.id }),
    ).expect(201);
    const pub = await post(`/quotes/${q.body.id}/publish`, imp.auth).expect(201);
    const mine = await get('/me/quote-requests', buyer.auth).expect(200);
    expect(mine.body[0]).toMatchObject({
      status: 'QUOTED',
      checkoutToken: pub.body.checkout.token,
    });
    expect((await get('/me/quote-requests', other.auth).expect(200)).body).toHaveLength(0);
    await get(`/checkout/${mine.body[0].checkoutToken}`).expect(200);
    // segunda cotización para la misma solicitud: rechazada
    await post(
      '/quotes',
      imp.auth,
      quoteBody('FULL_ESCROW', TOTAL, 0n, { serviceFeeAtomic: '0', quoteRequestId: req.body.id }),
    ).expect(409);
    // el pedido muestra producto y proveedor
    const { orderId } = await acceptCheckout(ctx, buyer, pub.body.checkout.token);
    const o = await get(`/orders/${orderId}`, buyer.auth).expect(200);
    expect(o.body.product.name).toBe('MacBook Air 13"');
    expect(o.body.provider.publicName).toMatch(/Importadora/);
  });
});

describe('motor Trustless Work (beta, FULL_ESCROW)', () => {
  async function twOrder(tag: string) {
    const imp = await verifiedImporter(ctx, `tw-imp-${tag}@test.local`);
    const buyer = await actor(ctx, `tw-buyer-${tag}@test.local`);
    const q = await post(
      '/quotes',
      imp.auth,
      quoteBody('FULL_ESCROW', TOTAL, 0n, {
        serviceFeeAtomic: '0',
        escrowEngine: 'TRUSTLESS_WORK',
      }),
    ).expect(201);
    const pub = await post(`/quotes/${q.body.id}/publish`, imp.auth).expect(201);
    const { orderId, view } = await acceptCheckout(ctx, buyer, pub.body.checkout.token);
    expect(view.escrow.engine).toBe('TRUSTLESS_WORK');
    return { imp, buyer, orderId };
  }
  async function fundTw(buyer: Actor, orderId: string) {
    const d = await post(`/orders/${orderId}/escrow/prepare-funding`, buyer.auth).expect(201);
    expect(d.body).toMatchObject({
      engine: 'TRUSTLESS_WORK',
      step: 'deploy',
      signer: { role: 'BUYER', address: buyer.kp.publicKey() },
    });
    expect(d.body.args).toMatchObject({
      amount: 12,
      platformFee: 0,
      roles: { receiver: expect.any(String), disputeResolvers: [ctx.arbiterKp.publicKey()] },
    });
    expect(d.body.args.description).toMatch(/^termsHash:[0-9a-f]{64}$/); // sin PII
    await submitXdr(buyer, orderId, d.body)
      .expect(201)
      .expect((r) => expect(r.body.status).toBe('CONFIRMED'));
    let o = await ctx.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(o.twContractId).toMatch(/^C/);
    expect(o.paymentState).toBe('ESCROW_PENDING'); // desplegado, aún sin fondos
    const f = await post(`/orders/${orderId}/escrow/prepare-funding`, buyer.auth).expect(201);
    expect(f.body.step).toBe('fund');
    await submitXdr(buyer, orderId, f.body).expect(201);
    o = await ctx.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(o).toMatchObject({
      paymentState: 'ESCROW_FUNDED',
      onchainStatus: 'FUNDED',
      remainingEscrowAtomic: TOTAL,
    });
  }

  it('/config ofrece el motor; anticipo parcial con Trustless Work se rechaza al publicar', async () => {
    const cfg = await get('/config').expect(200);
    expect(cfg.body.escrowEngines.map((e: { id: string }) => e.id)).toEqual([
      'MONTUNO',
      'TRUSTLESS_WORK',
    ]);
    const imp = await verifiedImporter(ctx, 'tw-partial@test.local', {
      maxAdvanceBps: 8000,
      modes: ['FULL_ESCROW', 'PARTIAL_ADVANCE'],
    });
    const q = await post(
      '/quotes',
      imp.auth,
      quoteBody('PARTIAL_ADVANCE', TOTAL, 9n * UNIT, {
        serviceFeeAtomic: '0',
        escrowEngine: 'TRUSTLESS_WORK',
      }),
    ).expect(201);
    await post(`/quotes/${q.body.id}/publish`, imp.auth)
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe('ENGINE_MODE_UNSUPPORTED'));
  });

  it('deploy -> fund -> entrega -> approve -> release: liquidado y aceptado', async () => {
    const { imp, buyer, orderId } = await twOrder('ok');
    await fundTw(buyer, orderId);
    await post(`/orders/${orderId}/advance/prepare`, imp.auth).expect(422);
    for (const state of ['PURCHASED', 'IN_TRANSIT', 'DELIVERED'])
      await ctx
        .http()
        .patch(`/api/v1/orders/${orderId}/logistics`)
        .set(imp.auth)
        .send({ state })
        .expect(200);
    const a = await post(`/orders/${orderId}/delivery/prepare-confirmation`, buyer.auth).expect(
      201,
    );
    expect(a.body.step).toBe('approve');
    // firma de otra cuenta sobre la tx correcta: rechazada
    await post(`/orders/${orderId}/escrow/submit`, buyer.auth, {
      preparedId: a.body.preparedId,
      signedXdr: signPreparedXdr(a.body.unsignedXdr, PASS, imp.kp),
    }).expect(422);
    await submitXdr(buyer, orderId, a.body).expect(201);
    const r = await post(`/orders/${orderId}/delivery/prepare-confirmation`, buyer.auth).expect(
      201,
    );
    expect(r.body.step).toBe('release');
    await submitXdr(buyer, orderId, r.body).expect(201);
    const o = await get(`/orders/${orderId}`, buyer.auth).expect(200);
    expect(o.body.states).toMatchObject({
      onchain: 'SETTLED',
      logistic: 'ACCEPTED',
      payment: 'ESCROW_FUNDED',
    });
    expect(o.body.engine).toBe('TRUSTLESS_WORK');
    const view = await get(`/orders/${orderId}/escrow`, buyer.auth).expect(200);
    expect(view.body).toMatchObject({ engine: 'TRUSTLESS_WORK', escrow: { released: true } });
    expect(tw.calls.every((c) => !JSON.stringify(c.body).match(/@test\.local/))).toBe(true); // sin PII hacia TW
  });

  it('disputa con razón privada (solo hash a TW) y resolución 9/3 por el árbitro', async () => {
    const { buyer, orderId } = await twOrder('dispute');
    await fundTw(buyer, orderId);
    const d = await post(`/orders/${orderId}/disputes`, buyer.auth, {
      reason: 'El paquete llegó vacío, adjunto fotos.',
    }).expect(201);
    expect(d.body.prepared.args.reason).toMatch(/^montuno-reason-sha256:[0-9a-f]{64}$/);
    await submitXdr(buyer, orderId, d.body.prepared).expect(201);
    expect(
      (await ctx.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).disputeState,
    ).toBe('OPEN');

    const adm = await admin(ctx);
    const arb = await actor(ctx, 'tw-arb@test.local', ctx.arbiterKp);
    await post(`/admin/users/${arb.userId}/roles`, adm, { role: 'ARBITER' }).expect(201);
    const body = {
      refundToBuyerAtomic: (9n * UNIT).toString(),
      releaseToImporterAtomic: (3n * UNIT).toString(),
      resolution: 'Reembolso parcial por daño comprobado.',
    };
    await post(`/orders/${orderId}/disputes/${d.body.disputeId}/prepare-resolution`, arb.auth, {
      ...body,
      releaseToImporterAtomic: '1',
    }).expect(422);
    const res = await post(
      `/orders/${orderId}/disputes/${d.body.disputeId}/prepare-resolution`,
      arb.auth,
      body,
    ).expect(201);
    expect(res.body.prepared.args.distributions).toEqual([
      { address: buyer.kp.publicKey(), amount: 9 },
      { address: expect.any(String), amount: 3 },
    ]);
    await submitXdr(arb, orderId, res.body.prepared).expect(201);
    const o = await ctx.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(o).toMatchObject({
      onchainStatus: 'SETTLED',
      disputeState: 'RESOLVED',
      paymentState: 'PARTIALLY_REFUNDED',
      buyerRefundedAtomic: 9n * UNIT,
    });
  });

  it('si TW reporta roles distintos a los pactados, la orden NO se marca financiada', async () => {
    const { buyer, orderId } = await twOrder('mismatch');
    tw.overrideReceiver = buyer.kp.publicKey();
    try {
      const d = await post(`/orders/${orderId}/escrow/prepare-funding`, buyer.auth).expect(201);
      await submitXdr(buyer, orderId, d.body).expect(201);
      const o = await ctx.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(o.paymentState).toBe('FAILED');
    } finally {
      tw.overrideReceiver = undefined;
    }
  });
});
