import {
  atomicToDecimal,
  bpsOf,
  canImporterSetLogistic,
  canonicalJson,
  computeTermsHash,
  decimalToAtomic,
  feeFromBps,
  onchainOrderId,
  parseAtomic,
  withinBps,
  TERMS_SCHEMA_VERSION,
  CanonicalTermsV1,
} from './index';

describe('money', () => {
  it('convierte decimales a atómicos sin float', () => {
    expect(decimalToAtomic('1200', 7)).toBe(12_000_000_000n);
    expect(decimalToAtomic('0.1', 7)).toBe(1_000_000n);
    expect(decimalToAtomic('0.0000001', 7)).toBe(1n);
    expect(() => decimalToAtomic('0.00000001', 7)).toThrow();
    expect(() => decimalToAtomic('1e3', 7)).toThrow();
    expect(() => decimalToAtomic('-1', 7)).toThrow();
    expect(atomicToDecimal(12_005_000_000n, 7)).toBe('1200.5');
    expect(atomicToDecimal(1n, 7)).toBe('0.0000001');
  });
  it('valida enteros atómicos', () => {
    expect(parseAtomic('9000000000')).toBe(9_000_000_000n);
    for (const bad of ['', '01', '1.5', '-3', ' 1', 'abc'])
      expect(() => parseAtomic(bad)).toThrow();
  });
  it('bps igual que el contrato', () => {
    expect(bpsOf(900n, 1200n)).toBe(7500);
    expect(withinBps(9_000n, 10_000n, 9000)).toBe(true);
    expect(withinBps(9_001n, 10_000n, 9000)).toBe(false);
    expect(feeFromBps(1001n, 100)).toBe(11n); // 10.01 -> 11 (redondeo hacia arriba)
    expect(feeFromBps(1000n, 100)).toBe(10n);
  });
});

describe('terms hash', () => {
  const base: CanonicalTermsV1 = {
    schema: TERMS_SCHEMA_VERSION,
    quoteId: 'q1',
    quoteVersion: 1,
    importerId: 'i1',
    product: { url: 'https://www.amazon.com/dp/X', name: 'MacBook', variant: null, quantity: 1 },
    destinationCity: 'La Paz',
    deliveryEstimateDays: 20,
    purchaseTerms: 'Compra en Amazon',
    fiat: { amount: '8352.00', currency: 'BOB' },
    fx: { rate: '6.96', spreadBps: 50, source: 'mock', expiresAt: '2026-01-01T00:00:00.000Z' },
    fees: { serviceFeeAtomic: '0', rampFeeAtomic: '0' },
    token: { contractId: 'C...', decimals: 7 },
    amountTotalAtomic: '12000000000',
    escrowMode: 'FULL_ESCROW',
    advanceAmountAtomic: '0',
    fundingDeadline: '2026-01-01T00:00:00.000Z',
    fulfillmentDeadline: '2026-02-01T00:00:00.000Z',
    riskDisclosureVersion: 'full/v1',
  };
  it('es independiente del orden de claves y cambia con cualquier campo', () => {
    const rev = (v: unknown): unknown =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(
            Object.entries(v)
              .reverse()
              .map(([k, x]) => [k, rev(x)]),
          )
        : v;
    const reordered = rev(base);
    expect(canonicalJson(reordered)).toBe(canonicalJson(base));
    const h = computeTermsHash(base);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(computeTermsHash({ ...base, advanceAmountAtomic: '1' })).not.toBe(h);
    expect(computeTermsHash({ ...base, quoteVersion: 2 })).not.toBe(h);
  });
  it('order id on-chain determinista de 32 bytes', () => {
    expect(onchainOrderId('abc')).toBe(onchainOrderId('abc'));
    expect(onchainOrderId('abc')).toHaveLength(64);
  });
});

describe('logística', () => {
  it('solo avanza y nunca a ACCEPTED por importadora', () => {
    expect(canImporterSetLogistic('NOT_PURCHASED', 'PURCHASED')).toBe(true);
    expect(canImporterSetLogistic('PURCHASED', 'DELIVERED')).toBe(true);
    expect(canImporterSetLogistic('DELIVERED', 'IN_TRANSIT')).toBe(false);
    expect(canImporterSetLogistic('DELIVERED', 'ACCEPTED')).toBe(false);
  });
});
