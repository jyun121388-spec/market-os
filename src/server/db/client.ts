import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Single shared Prisma client for the app, using the Postgres driver adapter required by
 * Prisma 7 (no `url` in schema.prisma — see prisma.config.ts and docs/DECISIONS.md). Reused
 * across hot-reloads in dev to avoid exhausting connections.
 *
 * Constructed LAZILY, on first use rather than at import. It used to be built at module scope,
 * which made `DATABASE_URL` a requirement for merely importing any module that touches the
 * database — including transitively. That is why `tests/askMarket.test.ts` and three others
 * failed outright with no database configured: they exercise pure functions like
 * `detectPersonalizedAdviceRequest`, but importing the module they live in reached this file and
 * threw before a single test ran.
 *
 * It also made the failure mode worse than it needed to be. A missing connection string should
 * surface when something tries to query, with the query in the stack, rather than as an import
 * error in an unrelated file.
 */
declare global {
  var __prisma: PrismaClient | undefined;
}

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — copy .env.example to .env and configure it.");
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

let cached: PrismaClient | undefined;

function getClient(): PrismaClient {
  if (cached) return cached;
  cached = globalThis.__prisma ?? createClient();
  if (process.env.NODE_ENV !== "production") {
    globalThis.__prisma = cached;
  }
  return cached;
}

/**
 * Behaves exactly like a `PrismaClient` — `prisma.observation.findMany(...)`,
 * `prisma.$transaction(...)` and the rest are unchanged at every call site. The proxy exists
 * only so that the client is built on first property access instead of at import.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const client = getClient();
    const value = Reflect.get(client, property, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
  has(_target, property) {
    return property in getClient();
  },
});
