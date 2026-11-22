// Variables para tests: gateway SIMULADO + Postgres real de test. Nunca Mainnet.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/montuno_test?schema=public';
process.env.SESSION_SECRET = 'test-session-secret-0123456789-abcdefghijklmnop';
process.env.STELLAR_NETWORK = 'testnet';
process.env.STELLAR_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
process.env.ESCROW_GATEWAY = 'simulated';
process.env.ADMIN_INITIAL_EMAIL = 'admin@test.local';
process.env.MOCK_KYC_AUTO_APPROVE = 'true';
process.env.MOCK_WEBHOOK_SECRET = 'test-mock-webhook-secret-123456';
process.env.OBJECT_STORAGE_LOCAL_DIR = require('os').tmpdir() + '/montuno-test-storage';
process.env.JOBS_ENABLED = 'false';
process.env.LOG_LEVEL = 'error';
process.env.AUTH_THROTTLE_LIMIT = '100000';
// Trustless Work habilitado contra un servidor FALSO local (test/fake-trustless-work.ts).
process.env.TRUSTLESS_WORK_BASE_URL = 'http://127.0.0.1:47811';
process.env.TRUSTLESS_WORK_API_KEY = 'test-tw-key.secret';
process.env.TRUSTLESS_WORK_PLATFORM_ADDRESS =
  'GDR7STD577P3IKUGVODMV3FVYOMLVOEJU5FMZHGSXBFJD5ZXKESDEKC4';
process.env.TRUSTLESS_WORK_ADMIN_ADDRESS =
  'GBFYOTOKVEY6YFSKIJLA3FB2EB42B6OZBVGYNTUEBE3XRWCBM7O7UW3B';
// Aísla los tests del apps/api/.env local (Prisma lo carga en process.env, pero no pisa lo ya definido).
process.env.POLLAR_API_KEY = '';
process.env.RAMP_PROVIDER = 'mock';
process.env.RAMP_CAJA_SECRET = '';
process.env.STELLAR_ESCROW_CONTRACT_ID = '';
process.env.STELLAR_ESCROW_TOKEN_CONTRACT_ID = '';
process.env.STELLAR_ARBITER_ADDRESS = '';
