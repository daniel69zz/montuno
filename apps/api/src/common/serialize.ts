import { Prisma } from '@prisma/client';

/** Convierte bigint -> string, Decimal -> string, Date -> ISO recursivamente para respuestas JSON. */
export function toJson<T>(value: T): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value === null || typeof value !== 'object') return value;
  if (Prisma.Decimal.isDecimal(value)) return (value as unknown as Prisma.Decimal).toString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array)
    return Buffer.from(value as Uint8Array).toString('hex');
  if (Array.isArray(value)) return value.map(toJson);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toJson(v)]),
  );
}
