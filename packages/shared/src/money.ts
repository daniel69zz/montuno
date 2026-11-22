// Dinero SIEMPRE como enteros atómicos (bigint). Nunca float.

export const BPS_DENOMINATOR = 10_000n;
const INT_RE = /^(0|[1-9][0-9]*)$/;
const DEC_RE = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

export function parseAtomic(value: string): bigint {
  if (typeof value !== 'string' || !INT_RE.test(value)) {
    throw new Error(`Monto atómico inválido: ${String(value)}`);
  }
  return BigInt(value);
}

/** "1200.5" con 7 decimales -> 12005000000n. Rechaza más decimales que la escala. */
export function decimalToAtomic(value: string, decimals: number): bigint {
  if (!DEC_RE.test(value)) throw new Error(`Decimal inválido: ${value}`);
  const [int, frac = ''] = value.split('.');
  if (frac.length > decimals) throw new Error(`Máximo ${decimals} decimales: ${value}`);
  return BigInt(int) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
}

export function atomicToDecimal(value: bigint, decimals: number): string {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const base = 10n ** BigInt(decimals);
  const int = abs / base;
  const frac = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${int}${frac ? '.' + frac : ''}`;
}

/** bps = floor(part * 10000 / total). */
export function bpsOf(part: bigint, total: bigint): number {
  if (total <= 0n) throw new Error('total debe ser > 0');
  return Number((part * BPS_DENOMINATOR) / total);
}

/** Mismo chequeo que el contrato: part * 10000 <= total * maxBps (sin división, sin redondeo). */
export function withinBps(part: bigint, total: bigint, maxBps: number): boolean {
  return part * BPS_DENOMINATOR <= total * BigInt(maxBps);
}

/** Comisión determinista con redondeo hacia arriba (a favor de cubrir el costo, declarado antes de pagar). */
export function feeFromBps(amount: bigint, bps: number): bigint {
  if (bps < 0 || bps > 10_000) throw new Error('bps fuera de rango');
  return (amount * BigInt(bps) + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR;
}
