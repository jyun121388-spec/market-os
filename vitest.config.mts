import { defineConfig } from "vitest/config";

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
  },
});
