import { z } from 'zod';

// Rechaza los valores de ejemplo de .env.example (secretos conocidos públicamente).
const PLACEHOLDER = /REPLACE_WITH|CHANGE[_-]?ME/i;
const secret = (name: string, min: number) =>
  z
    .string()
    .min(min, `${name} debe tener al menos ${min} caracteres`)
    .refine(
      (v) => !PLACEHOLDER.test(v),
      `${name} tiene el valor de ejemplo: genera uno con \`openssl rand -hex 32\``,
    );

// Validación estricta de variables de entorno al arrancar (fail-fast).
const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().optional(),
    SESSION_SECRET: secret('SESSION_SECRET', 32),
    SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
    FRONTEND_ORIGIN: z.string().default('http://localhost:3001'),
    PUBLIC_CHECKOUT_BASE_URL: z.string().default('http://localhost:3001/checkout'),
    PUBLIC_API_BASE_URL: z.string().default('http://localhost:3000'),
    AUTH_DOMAIN: z.string().default('localhost'),

    STELLAR_NETWORK: z.literal('testnet'), // Mainnet fuera de alcance: rechazado explícitamente
    STELLAR_NETWORK_PASSPHRASE: z.literal('Test SDF Network ; September 2015'),
    STELLAR_RPC_URL: z.string().url().default('https://soroban-testnet.stellar.org'),
    STELLAR_ESCROW_CONTRACT_ID: z
      .string()
      .regex(/^C[A-Z2-7]{55}$/)
      .or(z.literal(''))
      .default(''),
    STELLAR_ESCROW_TOKEN_CONTRACT_ID: z
      .string()
      .regex(/^C[A-Z2-7]{55}$/)
      .or(z.literal(''))
      .default(''),
    STELLAR_TOKEN_DECIMALS: z.coerce.number().int().min(0).max(18).default(7),
    STELLAR_ARBITER_ADDRESS: z
      .string()
      .regex(/^G[A-Z2-7]{55}$/)
      .or(z.literal(''))
      .default(''),
    STELLAR_MAX_ADVANCE_BPS: z.coerce.number().int().min(1).max(9999).default(9000),
    STELLAR_EXPLORER_BASE_URL: z.string().url().default('https://stellar.expert/explorer/testnet'),
    STELLAR_TX_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(300),
    /** 'soroban' = contrato real en Testnet; 'simulated' = ledger en memoria (dev/tests, marcado SIMULATED). */
    ESCROW_GATEWAY: z.enum(['soroban', 'simulated']).default('simulated'),

    IDENTITY_PROVIDER: z.enum(['mock']).default('mock'),
    POLLAR_MODE: z.enum(['mock']).default('mock'),
    POLLAR_KYC_MODE: z.enum(['mock']).default('mock'),
    POLLAR_RAMP_MODE: z.enum(['mock']).default('mock'),
    /** Llave PÚBLICA de Pollar (pub_testnet_... / pk_...): la usa el navegador; no es un secreto de servidor. */
    POLLAR_API_KEY: z
      .string()
      .regex(
        /^(pk|pub)_[A-Za-z0-9_-]+$/,
        'POLLAR_API_KEY debe ser la llave pública de Pollar (pub_testnet_..., pk_...)',
      )
      .or(z.literal(''))
      .default(''),
    POLLAR_BASE_URL: z.string().optional(),
    /**
     * Rampa: 'mock' (no mueve tokens; en gateway simulado acredita tokens simulados) o
     * 'caja-testnet' (una cuenta caja del servidor entrega USDC de Circle de TESTNET a la wallet del comprador).
     * caja-testnet es la ÚNICA excepción a "el servidor no firma": solo firma transferencias desde su propia caja.
     */
    RAMP_PROVIDER: z.enum(['mock', 'caja-testnet']).default('mock'),
    RAMP_CAJA_SECRET: z
      .string()
      .regex(/^S[A-Z2-7]{55}$/, 'RAMP_CAJA_SECRET debe ser una clave secreta S...')
      .or(z.literal(''))
      .default(''),
    RAMP_CAJA_MAX_PER_ORDER_ATOMIC: z
      .string()
      .regex(/^[1-9][0-9]{0,17}$/)
      .default('5000000000'),
    /**
     * Trustless Work (beta, v2 Core API en testnet): motor de escrow alternativo, solo FULL_ESCROW.
     * Se habilita cuando están la API key y las direcciones de plataforma y admin (distintas entre sí).
     */
    TRUSTLESS_WORK_BASE_URL: z.string().url().default('https://beta.api.trustlesswork.com'),
    TRUSTLESS_WORK_API_KEY: z.string().or(z.literal('')).default(''),
    TRUSTLESS_WORK_PLATFORM_ADDRESS: z
      .string()
      .regex(/^G[A-Z2-7]{55}$/)
      .or(z.literal(''))
      .default(''),
    TRUSTLESS_WORK_ADMIN_ADDRESS: z
      .string()
      .regex(/^G[A-Z2-7]{55}$/)
      .or(z.literal(''))
      .default(''),
    MOCK_KYC_AUTO_APPROVE: bool,
    /** Vacío = el webhook de desarrollo /webhooks/mock-ramp queda deshabilitado. */
    MOCK_WEBHOOK_SECRET: secret('MOCK_WEBHOOK_SECRET', 16).or(z.literal('')).default(''),

    OBJECT_STORAGE_PROVIDER: z.enum(['local']).default('local'),
    OBJECT_STORAGE_BUCKET: z.string().default('montuno-dev'),
    OBJECT_STORAGE_LOCAL_DIR: z.string().default('./storage'),
    EVIDENCE_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(10 * 1024 * 1024),

    ADMIN_INITIAL_EMAIL: z.string().email().or(z.literal('')).default(''),
    JOBS_ENABLED: bool,
    JOBS_INDEXER_INTERVAL_MS: z.coerce.number().int().positive().default(15000),
    JOBS_RECONCILE_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
    AUTH_THROTTLE_LIMIT: z.coerce.number().int().positive().default(10),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      // Nunca simular éxito real en producción.
      for (const k of ['ESCROW_GATEWAY'] as const) {
        if (env[k] === 'simulated')
          ctx.addIssue({ code: 'custom', path: [k], message: 'simulated prohibido en production' });
      }
      if (
        env.IDENTITY_PROVIDER === 'mock' ||
        env.POLLAR_RAMP_MODE === 'mock' ||
        env.POLLAR_KYC_MODE === 'mock'
      )
        ctx.addIssue({
          code: 'custom',
          path: ['IDENTITY_PROVIDER'],
          message: 'mocks prohibidos en production',
        });
    }
    if (env.RAMP_PROVIDER === 'caja-testnet') {
      if (env.NODE_ENV === 'production')
        ctx.addIssue({
          code: 'custom',
          path: ['RAMP_PROVIDER'],
          message: 'caja-testnet prohibida en production',
        });
      if (env.ESCROW_GATEWAY !== 'soroban')
        ctx.addIssue({
          code: 'custom',
          path: ['RAMP_PROVIDER'],
          message: 'caja-testnet requiere ESCROW_GATEWAY=soroban',
        });
      if (!env.RAMP_CAJA_SECRET)
        ctx.addIssue({
          code: 'custom',
          path: ['RAMP_CAJA_SECRET'],
          message: 'requerida con RAMP_PROVIDER=caja-testnet',
        });
    }
    if (env.ESCROW_GATEWAY === 'soroban') {
      for (const k of [
        'STELLAR_ESCROW_CONTRACT_ID',
        'STELLAR_ESCROW_TOKEN_CONTRACT_ID',
        'STELLAR_ARBITER_ADDRESS',
      ] as const) {
        if (!env[k])
          ctx.addIssue({
            code: 'custom',
            path: [k],
            message: 'requerido con ESCROW_GATEWAY=soroban',
          });
      }
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuración inválida: ${msg}`);
  }
  return parsed.data;
}

export const ENV = Symbol('ENV');
