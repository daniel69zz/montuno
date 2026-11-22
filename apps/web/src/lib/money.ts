// Dinero en enteros (bigint). Nunca float para calcular.

export const DECIMALS = 7;

export function toAtomic(value: string, decimals = DECIMALS): bigint {
  const v = value.trim().replace(',', '.');
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(v)) throw new Error('Monto inválido');
  const [i, f = ''] = v.split('.');
  if (f.length > decimals) throw new Error(`Máximo ${decimals} decimales`);
  return BigInt(i) * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0');
}

export function fromAtomic(v: bigint | string, decimals = DECIMALS): string {
  const n = typeof v === 'string' ? BigInt(v) : v;
  const neg = n < 0n;
  const a = neg ? -n : n;
  const base = 10n ** BigInt(decimals);
  const frac = (a % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${a / base}${frac ? '.' + frac : ''}`;
}

/** "1200" -> "1.200,00" (formato boliviano), sin pasar por float. */
export function fmtDecimal(dec: string, minFrac = 2): string {
  const [i, f = ''] = dec.split('.');
  const int = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const frac = (f + '0'.repeat(minFrac)).slice(0, Math.max(minFrac, f.replace(/0+$/, '').length));
  return frac ? `${int},${frac}` : int;
}

export function usdc(atomic: bigint | string): string {
  return `${fmtDecimal(fromAtomic(atomic))} USDC`;
}

export function fiat(amount: string, currency: string): string {
  return `${currency === 'BOB' ? 'Bs' : 'US$'} ${fmtDecimal(amount)}`;
}

export function pct(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 ? 2 : 0).replace('.', ',')} %`;
}
