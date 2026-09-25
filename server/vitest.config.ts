/**
 * The server's tests run against their own database, never the development one
 * (tests/support/test-db.ts). Every worker gets the rewritten database URLs before any
 * test reads the settings; the one-time setup creates and migrates that database.
 */
import { defineConfig } from 'vitest/config';
import { testDatabaseEnv } from './tests/support/test-db.js';

export default defineConfig({
  test: {
    env: testDatabaseEnv(),
    globalSetup: ['./tests/support/global-setup.ts'],
  },
});
