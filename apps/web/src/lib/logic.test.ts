import { describe, expect, it } from 'vitest';
import { fmtDecimal, fromAtomic, toAtomic, usdc } from './money';
import { buyerAction, importerAction, nextLogistic, strata } from './next-action';
import type { OrderView } from './types';

const base = (over: Partial<OrderView['states']> = {}, mode: OrderView['escrow']['mode'] = 'FULL_ESCROW'): OrderView =>
  ({
    id: 'o',
    quoteId: 'q',
    importerId: 'i',
    engine: 'MONTUNO',
    summary: { code: 'X', label: 'x' },
    states: { payment: 'NOT_STARTED', logistic: 'NOT_PURCHASED', dispute: 'NONE', onchain: 'NONE', ...over },
    escrow: {
      mode,
      network: 'testnet',
      contractId: 'C',
      tokenContractId: 'C',
      onchainOrderId: 'h',
      termsHash: 'h',
      simulated: true,
      amountAtomic: '12000000000',
      advanceAmountAtomic: '9000000000',
      projection: { advanceReleasedAtomic: '0', sellerReleasedAtomic: '0', buyerRefundedAtomic: '0', remainingEscrowAtomic: '0', lastSyncedAt: null },
      maxRecoverableByBuyerAtomic: '0',
    },
    fundingDeadline: '',
    fulfillmentDeadline: '',
    tracking: null,
    createdAt: '',
  }) as OrderView;

describe('dinero sin float', () => {
  it('convierte y formatea', () => {
    expect(toAtomic('1200')).toBe(12_000_000_000n);
    expect(toAtomic('0,5')).toBe(5_000_000n);
    expect(fromAtomic('12005000000')).toBe('1200.5');
    expect(fmtDecimal('1200.5')).toBe('1.200,50');
    expect(usdc('9000000000')).toBe('900,00 USDC');
    expect(() => toAtomic('1e3')).toThrow();
  });
});

describe('acción principal', () => {
  it('comprador: rampa o depósito; confirmar solo tras entrega', () => {
    expect(buyerAction(base(), { rampAvailable: true }).id).toBe('ramp');
    expect(buyerAction(base({ payment: 'WALLET_FUNDED' }), { rampAvailable: true }).id).toBe('fund');
    expect(buyerAction(base({ payment: 'ESCROW_FUNDED', onchain: 'FUNDED', logistic: 'IN_TRANSIT' }), { rampAvailable: true }).id).toBe('wait');
    expect(buyerAction(base({ payment: 'ESCROW_FUNDED', onchain: 'FUNDED', logistic: 'DELIVERED' }), { rampAvailable: true }).id).toBe('confirm');
    expect(buyerAction(base({ onchain: 'DISPUTED', dispute: 'OPEN' }), { rampAvailable: true }).id).toBe('wait');
  });
  it('importadora: anticipo antes de comprar, luego logística', () => {
    expect(importerAction(base({ payment: 'ESCROW_FUNDED', onchain: 'FUNDED' }, 'PARTIAL_ADVANCE')).id).toBe('advance');
    expect(importerAction(base({ payment: 'ESCROW_FUNDED', onchain: 'ADVANCE_PAID' }, 'PARTIAL_ADVANCE')).id).toBe('logistics');
    expect(importerAction(base({ payment: 'ESCROW_FUNDED', onchain: 'FUNDED', logistic: 'DELIVERED' })).id).toBe('wait');
    expect(nextLogistic('IN_TRANSIT')).toBe('ARRIVED_BOLIVIA');
    expect(nextLogistic('DELIVERED')).toBeNull();
  });
  it('estratos marcan una sola capa actual', () => {
    const s = strata(base({ payment: 'ESCROW_FUNDED', onchain: 'FUNDED', logistic: 'PURCHASED' }));
    expect(s.filter((x) => x.state === 'current')).toHaveLength(1);
    expect(s.find((x) => x.state === 'current')!.key).toBe('transit');
  });
});
