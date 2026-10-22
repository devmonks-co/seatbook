import { testDatabaseUrl } from './testEnv';

process.env.DATABASE_URL = testDatabaseUrl();
process.env.JWT_SECRET ||= 'test-secret-that-is-at-least-32-characters-long';
