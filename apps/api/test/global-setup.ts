import { execSync } from 'child_process';

export default async function globalSetup() {
  const url =
    process.env.TEST_DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:5432/montuno_test?schema=public';
  execSync('npx prisma migrate deploy', {
    cwd: __dirname + '/..',
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'ignore',
  });
}
