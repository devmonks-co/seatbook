import { execSync } from 'node:child_process';
import { testDatabaseUrl } from './testEnv';

export default function setup() {
  execSync('npx prisma migrate reset --force --skip-seed --skip-generate', {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    stdio: 'pipe',
  });
}
