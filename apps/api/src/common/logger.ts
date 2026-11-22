import { LoggerService } from '@nestjs/common';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;
// Claves que jamás deben aparecer en logs.
const SECRET_KEYS = /(secret|password|token|authorization|signature|seed|private|otp|code|xdr)/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') {
    return typeof value === 'bigint' ? value.toString() : value;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [
      k,
      SECRET_KEYS.test(k) ? '[REDACTED]' : redact(v, depth + 1),
    ]),
  );
}

/** Logger JSON estructurado (una línea por evento). */
export class JsonLogger implements LoggerService {
  constructor(private readonly level: Level = 'info') {}
  private write(level: Level, message: unknown, context?: string, extra?: unknown) {
    if (LEVELS[level] < LEVELS[this.level]) return;
    let payload: Record<string, unknown>;
    if (typeof message === 'string') {
      try {
        const parsed = JSON.parse(message);
        payload = typeof parsed === 'object' && parsed ? parsed : { msg: message };
      } catch {
        payload = { msg: message };
      }
    } else payload = { msg: message };
    const line = {
      ts: new Date().toISOString(),
      level,
      context,
      ...(redact(payload) as object),
      ...(extra ? { extra: redact(extra) } : {}),
    };
    (level === 'error' ? process.stderr : process.stdout).write(JSON.stringify(line) + '\n');
  }
  log(m: unknown, c?: string) {
    this.write('info', m, c);
  }
  error(m: unknown, trace?: string, c?: string) {
    this.write('error', m, c, trace ? { trace } : undefined);
  }
  warn(m: unknown, c?: string) {
    this.write('warn', m, c);
  }
  debug(m: unknown, c?: string) {
    this.write('debug', m, c);
  }
  verbose(m: unknown, c?: string) {
    this.write('debug', m, c);
  }
}
