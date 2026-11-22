import { Keypair } from '@stellar/stellar-sdk';
import { SimulatedEscrowGateway } from './simulated.gateway';

describe('SimulatedEscrowGateway (espejo de reglas del contrato)', () => {
  const buyer = Keypair.random();
  const importer = Keypair.random();
  const arbiter = Keypair.random();
  const stranger = Keypair.random();
  const id = 'aa'.repeat(32);
  let g: SimulatedEscrowGateway;
  const now = () => Math.floor(Date.now() / 1000);
  const terms = (advance = 0n) => ({
    importer: importer.publicKey(),
    arbiter: arbiter.publicKey(),
    token: g.tokenContractId,
    amountTotal: 1200n,
    advanceAmount: advance,
    mode: advance ? ('PARTIAL_ADVANCE' as const) : ('FULL_ESCROW' as const),
    termsHashHex: 'bb'.repeat(32),
    fundingDeadline: now() + 600,
    fulfillmentDeadline: now() + 86400,
  });
  const run = async (kp: Keypair, call: Parameters<SimulatedEscrowGateway['prepare']>[0]) => {
    const p = await g.prepare(call, kp.publicKey());
    return g.submit(SimulatedEscrowGateway.sign(p.unsignedXdr, kp), p.txHash);
  };

  beforeEach(() => {
    g = new SimulatedEscrowGateway(arbiter.publicKey(), 9000);
    g.mint(buyer.publicKey(), 10_000n);
  });

  it('PARTIAL: fund -> anticipo -> confirm; invariantes', async () => {
    expect(
      (
        await run(buyer, {
          fn: 'create_and_fund',
          orderIdHex: id,
          buyer: buyer.publicKey(),
          terms: terms(900n),
        })
      ).status,
    ).toBe('SUCCESS');
    await expect(
      g.prepare({ fn: 'claim_advance', orderIdHex: id }, buyer.publicKey()),
    ).rejects.toThrow(); // firma ajena
    expect((await run(importer, { fn: 'claim_advance', orderIdHex: id })).status).toBe('SUCCESS');
    await expect(
      g.prepare({ fn: 'claim_advance', orderIdHex: id }, importer.publicKey()),
    ).rejects.toMatchObject({ contractError: 'AdvanceAlreadyClaimed' });
    expect((await run(buyer, { fn: 'confirm_delivery_and_release', orderIdHex: id })).status).toBe(
      'SUCCESS',
    );
    const o = (await g.getOrder(id))!;
    expect(o.sellerReleased + o.buyerRefunded + o.remainingEscrow).toBe(o.amountTotal);
    expect(await g.tokenBalance(importer.publicKey())).toBe(1200n);
  });

  it('rechaza sobre firmado por otra cuenta o con hash distinto', async () => {
    const p = await g.prepare(
      { fn: 'create_and_fund', orderIdHex: id, buyer: buyer.publicKey(), terms: terms() },
      buyer.publicKey(),
    );
    await expect(
      g.submit(SimulatedEscrowGateway.sign(p.unsignedXdr, stranger), p.txHash),
    ).rejects.toMatchObject({ code: 'MISSING_SIGNATURE' });
    await expect(
      g.submit(SimulatedEscrowGateway.sign(p.unsignedXdr, buyer), '00'.repeat(32)),
    ).rejects.toMatchObject({ code: 'TX_MISMATCH' });
    expect(await g.getOrder(id)).toBeNull();
  });

  it('árbitro solo reparte el saldo retenido', async () => {
    await run(buyer, {
      fn: 'create_and_fund',
      orderIdHex: id,
      buyer: buyer.publicKey(),
      terms: terms(900n),
    });
    await run(importer, { fn: 'claim_advance', orderIdHex: id });
    await run(buyer, {
      fn: 'open_dispute',
      orderIdHex: id,
      caller: buyer.publicKey(),
      reasonHashHex: 'cc'.repeat(32),
    });
    await expect(
      g.prepare(
        {
          fn: 'resolve_dispute',
          orderIdHex: id,
          refundToBuyer: 1200n,
          releaseToImporter: 0n,
          resolutionHashHex: 'dd'.repeat(32),
        },
        arbiter.publicKey(),
      ),
    ).rejects.toMatchObject({ contractError: 'InvalidResolution' });
    expect(
      (
        await run(arbiter, {
          fn: 'resolve_dispute',
          orderIdHex: id,
          refundToBuyer: 300n,
          releaseToImporter: 0n,
          resolutionHashHex: 'dd'.repeat(32),
        })
      ).status,
    ).toBe('SUCCESS');
    expect((await g.getOrder(id))!.buyerRefunded).toBe(300n);
  });
});
