import { defineConfig } from "vitest/config";

/**
 * Integration tests are destructive. They `deleteMany` by corpCode, sourceId and email to keep
 * themselves isolated, which means running the suite wipes whatever real ingested data happens
 * to share those keys.
 *
 * That is fine against a scratch database and actively confusing against the one you have just
 * ingested 2240 real filings into — it happened three times in one session on 2026-08-17, each
 * time presenting as "the page suddenly shows nothing" rather than as anything test-related.
 *
 * So: if `TEST_DATABASE_URL` is set, tests run against THAT and leave `DATABASE_URL` alone. The
 * dev database keeps its real data, and `npm run dev` keeps working while the suite runs. If it
 * is unset, behaviour is exactly as before — tests use `DATABASE_URL` — so nothing breaks for
 * CI or for anyone who has not set it.
 */
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl) {
  process.env.DATABASE_URL = testDatabaseUrl;
}

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration tests share one live Postgres instance and mutate global tables;
    // running test files in parallel causes cross-file races. See docs/TEST_STRATEGY.md.
    fileParallelism: false,
    env: testDatabaseUrl ? { DATABASE_URL: testDatabaseUrl } : {},
  },
});
