import { Keypair, nativeToScVal, scValToNative, StrKey, xdr } from '@stellar/stellar-sdk';
import { decodeOrder, encodeCallArgs } from './soroban.gateway';
import { contractErrorFromMessage } from './escrow-gateway';

const G = () => Keypair.random().publicKey();
const C = StrKey.encodeContract(Buffer.alloc(32, 7));

describe('codificación de argumentos Soroban', () => {
  it('create_and_fund: struct OrderTerms con claves ordenadas y tipos exactos', () => {
    const args = encodeCallArgs({
      fn: 'create_and_fund',
      orderIdHex: 'ab'.repeat(32),
      buyer: G(),
      terms: {
        importer: G(),
        arbiter: G(),
        token: C,
        amountTotal: 12_000_000_000n,
        advanceAmount: 9_000_000_000n,
        mode: 'PARTIAL_ADVANCE',
        termsHashHex: 'cd'.repeat(32),
        fundingDeadline: 1_800_000_000,
        fulfillmentDeadline: 1_800_100_000,
      },
    });
    expect(args).toHaveLength(3);
    const map = args[2] as unknown as {
      type: string;
      value: { key: { value: unknown }; val: { type: string } }[];
    };
    expect(map.type).toBe('scvMap');
    const keys = map.value.map((e) => String(e.key.value));
    expect(keys).toEqual([...keys].sort());
    expect(keys).toEqual([
      'advance_amount',
      'amount_total',
      'arbiter',
      'fulfillment_deadline',
      'funding_deadline',
      'importer',
      'mode',
      'terms_hash',
      'token',
    ]);
    const types = Object.fromEntries(map.value.map((e) => [String(e.key.value), e.val.type]));
    expect(types).toMatchObject({
      amount_total: 'scvI128',
      mode: 'scvU32',
      funding_deadline: 'scvU64',
      terms_hash: 'scvBytes',
      token: 'scvAddress',
    });
    const native = scValToNative(args[2]) as Record<string, unknown>;
    expect(native.amount_total).toBe(12_000_000_000n);
    expect(native.mode).toBe(1);
  });

  it('rechaza ids que no son 32 bytes', () => {
    expect(() => encodeCallArgs({ fn: 'claim_advance', orderIdHex: 'zz' })).toThrow();
  });

  it('decodifica Order on-chain', () => {
    const o = decodeOrder({
      order_id: Buffer.alloc(32, 1),
      buyer: G(),
      importer: G(),
      arbiter: G(),
      asset: C,
      amount_total: 100n,
      advance_amount: 75n,
      advance_released: 75n,
      seller_released: 75n,
      buyer_refunded: 0n,
      remaining_escrow: 25n,
      terms_hash: Buffer.alloc(32, 2),
      mode: 1,
      funding_deadline: 1n,
      fulfillment_deadline: 2n,
      status: 1,
      funded_at: 3n,
      dispute_opened_by: undefined,
      dispute_reason_hash: undefined,
      resolution_hash: undefined,
    });
    expect(o.status).toBe('ADVANCE_PAID');
    expect(o.mode).toBe('PARTIAL_ADVANCE');
    expect(o.remainingEscrow).toBe(25n);
    expect(o.resolutionHashHex).toBeNull();
  });

  it('mapea códigos de error del contrato', () => {
    expect(contractErrorFromMessage('HostError: Error(Contract, #13)')).toBe(
      'AdvanceAlreadyClaimed',
    );
    expect(contractErrorFromMessage('otro')).toBeUndefined();
    expect(nativeToScVal(1n, { type: 'i128' })).toBeInstanceOf(xdr.ScVal);
  });
});
