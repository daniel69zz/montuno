import { atomicToDecimal } from '@montuno/shared';
import type { RampQuote, RampQuoteInput } from './ports';

/** Cotización de PRUEBA (tipo de cambio ficticio explícito, sin floats). Compartida por mock y caja. */
export const TEST_RATE_BOB = '6.96';
export const TEST_SPREAD_BPS = 50;
export function testQuote(
  provider: string,
  input: RampQuoteInput,
  ttlMs = 10 * 60 * 1000,
): RampQuote {
  const rateCents = 696n;
  const scale = 10n ** BigInt(input.tokenDecimals);
  const baseCents = (input.targetAtomic * rateCents + scale - 1n) / scale;
  const spreadCents = (baseCents * BigInt(TEST_SPREAD_BPS) + 9999n) / 10000n;
  return {
    routeId: input.routeId,
    provider,
    fiatAmount: atomicToDecimal(baseCents + spreadCents, 2),
    fiatCurrency: 'BOB',
    rate: TEST_RATE_BOB,
    spreadBps: TEST_SPREAD_BPS,
    feeFiat: atomicToDecimal(spreadCents, 2),
    deliversAtomic: input.targetAtomic,
    expiresAt: new Date(Date.now() + ttlMs),
    simulated: true,
  };
}
