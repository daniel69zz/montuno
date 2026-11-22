// Cliente HTTP de la API de Montuno (mismo origen; en dev, proxy de Vite).

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

let token: string | null = null;
export function setToken(t: string | null) {
  token = t;
}
export function getToken() {
  return token;
}

const newKey = () => crypto.randomUUID();

/**
 * `idempotent`: agrega Idempotency-Key. Los reintentos de la UI reutilizan la misma clave
 * si se pasa `key` (p. ej. el mismo click), para que el servidor no duplique efectos.
 */
export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; idempotent?: boolean; key?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  if (opts.idempotent) headers['idempotency-key'] = opts.key ?? newKey();
  const res = await fetch(`/api/v1${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: opts.signal,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const e = json?.error ?? {};
    throw new ApiError(res.status, e.code ?? `HTTP_${res.status}`, e.message ?? res.statusText, e.details);
  }
  return json as T;
}

/** Mensaje en español para la UI a partir de un error de la API. */
export function humanError(e: unknown): string {
  if (e instanceof ApiError) {
    const map: Record<string, string> = {
      INSUFFICIENT_TOKEN_BALANCE: 'Tu wallet no tiene USDC suficiente. Usa la recarga o consigue USDC de testnet.',
      QUOTE_RECALCULATION_REQUIRED: 'La cotización venció. Pide a la importadora una nueva.',
      QUOTE_EXPIRED: 'La cotización venció. Pide a la importadora una nueva.',
      TRUSTLINE_REQUIRED: 'Tu wallet debe activar USDC (trustline) antes de recibir.',
      WALLET_UNVERIFIED: 'Primero verifica tu wallet.',
      TX_MISMATCH: 'La firma no corresponde a la operación preparada. Vuelve a intentarlo.',
      MISSING_SIGNATURE: 'La transacción no tiene la firma de la wallet correcta.',
      DISPUTE_ACTIVE: 'Hay una disputa activa: los fondos están congelados.',
      UNAUTHORIZED: 'Tu sesión venció. Vuelve a entrar.',
    };
    if (e.status === 401) return map.UNAUTHORIZED;
    return map[e.code] ?? e.message;
  }
  if (e instanceof Error) return e.message;
  return 'Algo salió mal.';
}
