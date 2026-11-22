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
