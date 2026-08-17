import { defineConfig } from "vitest/config";
import { resolveTestDatabase } from "./tests/support/testDatabaseGuard";

/**
 * The integration tests are destructive. Which database they are allowed to touch is decided
 * fail-closed by `resolveTestDatabase` — see that module for the rules and why each exists.
 *
 * Applied here rather than inside a setup file so an unsafe configuration stops the run before
 * a single test opens a connection.
 */
const decision = resolveTestDatabase({
  DATABASE_URL: process.env.DATABASE_URL,
  TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
});

if (!decision.ok) {
  throw new Error(`\n\nRefusing to run tests.\n\n${decision.reason}\n`);
}

// Point every worker at the resolved database, and make sure a stray DATABASE_URL inherited
// from the shell cannot reach a test process by another route.
if (decision.databaseUrl) {
  process.env.DATABASE_URL = decision.databaseUrl;
} else {
  delete process.env.DATABASE_URL;
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
    env: decision.databaseUrl ? { DATABASE_URL: decision.databaseUrl } : {},
  },
});
