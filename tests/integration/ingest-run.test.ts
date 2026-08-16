import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

/**
 * IngestRun recording and its surfacing in system health.
 *
 * The point of this table is to answer "is the stored data complete?" after the fact. Every
 * adapter returns a `truncated` flag now because each was at some point silently storing a
 * partial result; a flag nothing persists is barely better than no flag. These tests cover the
 * three outcomes an operator needs to be able to tell apart — complete, knowably incomplete,
 * and failed — and that a failure is recorded rather than swallowed.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const SOURCE_CODE = "TEST_INGEST_RUN_SOURCE";

describeIfDb("ingest run recording (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let recordIngestRun: typeof import("@/server/domain/ingestRun").recordIngestRun;
  let computeSystemHealth: typeof import("@/server/domain/systemHealth").computeSystemHealth;
  let clearSystemHealthCache: typeof import("@/server/domain/systemHealth").clearSystemHealthCache;
  let sourceId: string;

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ recordIngestRun } = await import("@/server/domain/ingestRun"));
    ({ computeSystemHealth, clearSystemHealthCache } =
      await import("@/server/domain/systemHealth"));

    const source = await prisma.source.upsert({
      where: { code: SOURCE_CODE },
      update: {},
      create: { code: SOURCE_CODE, name: "Ingest run test source", tier: "TIER_S" },
    });
    sourceId = source.id;
    await prisma.ingestRun.deleteMany({ where: { sourceId } });
  });

  afterEach(async () => {
    await prisma.ingestRun.deleteMany({ where: { sourceId } });
    clearSystemHealthCache();
  });

  afterAll(async () => {
    await prisma.ingestRun.deleteMany({ where: { sourceId } });
    await prisma.source.delete({ where: { id: sourceId } });
    await prisma.$disconnect();
  });

  it("records a complete run as SUCCESS with the provider total alongside what was fetched", async () => {
    const result = await recordIngestRun(
      { sourceCode: SOURCE_CODE, target: "series-a" },
      async () => ({
        inserted: 10,
        unchanged: 2,
        providerTotal: 12,
        fetched: 12,
        requestsMade: 3,
        truncated: false,
      }),
    );
    expect(result.inserted).toBe(10);

    const run = await prisma.ingestRun.findFirstOrThrow({ where: { sourceId } });
    expect(run.status).toBe("SUCCESS");
    expect(run.truncated).toBe(false);
    expect(run.providerTotal).toBe(12);
    expect(run.fetched).toBe(12);
    expect(run.requestsMade).toBe(3);
    expect(run.finishedAt).not.toBeNull();
    expect(run.error).toBeNull();
  });

  it("records a truncated run as PARTIAL, not SUCCESS", async () => {
    // The distinction that matters: the run did not fail, but the data it stored is knowably
    // incomplete. Calling that SUCCESS is how a partial dataset comes to read as a whole one.
    await recordIngestRun({ sourceCode: SOURCE_CODE, target: "series-b" }, async () => ({
      inserted: 100,
      providerTotal: 5000,
      fetched: 100,
      truncated: true,
    }));

    const run = await prisma.ingestRun.findFirstOrThrow({ where: { sourceId } });
    expect(run.status).toBe("PARTIAL");
    expect(run.truncated).toBe(true);
    expect(run.fetched).toBe(100);
    expect(run.providerTotal).toBe(5000);
  });

  it("records a failure and re-throws rather than swallowing it", async () => {
    await expect(
      recordIngestRun({ sourceCode: SOURCE_CODE, target: "series-c" }, async () => {
        throw new Error("provider returned 503");
      }),
    ).rejects.toThrow("provider returned 503");

    const run = await prisma.ingestRun.findFirstOrThrow({ where: { sourceId } });
    expect(run.status).toBe("FAILED");
    expect(run.error).toBe("provider returned 503");
    // A run that died is exactly the run an operator most wants to see afterwards.
    expect(run.finishedAt).not.toBeNull();
  });

  it("stores only the error message, never a stack trace", async () => {
    // A stack trace would put local filesystem paths — and potentially a connection string —
    // into a table rendered on an authenticated page.
    await expect(
      recordIngestRun({ sourceCode: SOURCE_CODE, target: "series-d" }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow();

    const run = await prisma.ingestRun.findFirstOrThrow({ where: { sourceId } });
    expect(run.error).toBe("boom");
    expect(run.error).not.toContain("at ");
    expect(run.error).not.toContain("\\");
  });

  it("surfaces the newest run per target in system health, and counts the ones needing attention", async () => {
    await recordIngestRun({ sourceCode: SOURCE_CODE, target: "series-a" }, async () => ({
      inserted: 1,
      truncated: false,
    }));
    await recordIngestRun({ sourceCode: SOURCE_CODE, target: "series-b" }, async () => ({
      inserted: 1,
      truncated: true,
    }));
    // A second, newer run for series-a — the older one must not shadow it.
    await recordIngestRun({ sourceCode: SOURCE_CODE, target: "series-a" }, async () => ({
      inserted: 99,
      truncated: false,
    }));

    clearSystemHealthCache();
    const health = await computeSystemHealth();
    const mine = health.recentRuns.filter((r) => r.sourceCode === SOURCE_CODE);

    expect(mine).toHaveLength(2); // one per target, not one per run
    expect(mine.find((r) => r.target === "series-a")?.inserted).toBe(99);
    expect(mine.find((r) => r.target === "series-b")?.truncated).toBe(true);
    expect(health.incompleteRuns).toBeGreaterThanOrEqual(1);
  });
});
