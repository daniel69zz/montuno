// Representación canónica y versionada de la cotización para `termsHash`.
// No incluye PII (sin email, teléfono, nombre, dirección ni wallet del comprador).
import { createHash } from 'crypto';

export const TERMS_SCHEMA_VERSION = 'import-escrow/terms/v1';

export interface CanonicalTermsV1 {
  schema: typeof TERMS_SCHEMA_VERSION;
  quoteId: string;
  quoteVersion: number;
  importerId: string;
  product: { url: string; name: string; variant: string | null; quantity: number };
  destinationCity: string;
  deliveryEstimateDays: number;
  purchaseTerms: string;
  fiat: { amount: string; currency: string };
  fx: {
    rate: string | null;
    spreadBps: number | null;
    source: string | null;
    expiresAt: string | null;
  };
  fees: { serviceFeeAtomic: string; rampFeeAtomic: string };
  token: { contractId: string; decimals: number };
  amountTotalAtomic: string;
  escrowMode: string;
  advanceAmountAtomic: string;
  fundingDeadline: string;
  fulfillmentDeadline: string;
  riskDisclosureVersion: string;
  /** Solo presente si el motor no es el contrato propio (mantiene estables los hashes v1 de MONTUNO). */
  escrowEngine?: string;
}

/** JSON canónico: claves ordenadas, sin espacios, sin undefined. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'bigint')
      throw new Error('Usar strings para bigint en términos canónicos');
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Número no finito');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** termsHash = sha256(schema + "\n" + canonicalJson(terms)), en hex (32 bytes => BytesN<32> on-chain). */
export function computeTermsHash(terms: CanonicalTermsV1): string {
  return sha256Hex(`${terms.schema}\n${canonicalJson(terms)}`);
}

/** order_id on-chain determinista, sin PII: sha256("import-escrow/order/v1:" + orderId). */
export function onchainOrderId(orderId: string): string {
  return sha256Hex(`import-escrow/order/v1:${orderId}`);
}
