/**
 * Migration configuration for the PACKAGED runtime, and deliberately not the repository's
 * `prisma.config.ts`.
 *
 * Two differences, both of which are the point. It is plain JavaScript, because a package has no
 * TypeScript loader; and it does not `import "dotenv/config"`, because a package has no `.env` and
 * must never acquire the habit of looking for one — the URL arrives from the launcher through the
 * environment, or from `market-os.json`, and `first-run.mjs` is the only thing that decides which.
 *
 * It is staged into `migrate-tools/`, NOT the package root, and the `../` in the paths below is
 * the reason. The first version put it at the root and the first real run failed with
 * `Cannot find module 'prisma/config'`: the CLI is installed under `migrate-tools/node_modules`,
 * so the package root cannot resolve `prisma/config` at all. A config file that imports from the
 * toolchain has to live where the toolchain does. The schema and the migrations are then one
 * directory up.
 *
 * Prisma resolves these relative to the config file, and `first-run.mjs` also runs the CLI with
 * this directory as its working directory, so the two interpretations cannot disagree.
 */
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "../prisma/schema.prisma",
  migrations: {
    path: "../prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
