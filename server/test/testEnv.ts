import 'dotenv/config';

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('Set TEST_DATABASE_URL (see .env.example). The tests wipe that database.');
  }
  if (url === process.env.DATABASE_URL || !/test/i.test(new URL(url).pathname)) {
    throw new Error(`Refusing to run tests against ${url}: TEST_DATABASE_URL must be a separate database with "test" in its name`);
  }
  return url;
}
