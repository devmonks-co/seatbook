import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['test/globalSetup.ts'],
    setupFiles: ['test/setup.ts'],
    // Integration tests share one database.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
