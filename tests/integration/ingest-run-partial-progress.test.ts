import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

/**
 * A failed ingest must not report that nothing landed when something did.
 *
 * `recordIngestRun` writes `outcome: {}` on failure, so every count becomes 0. Rows are written
 * one at a time and are NOT rolled back, so an exception partway through leaves real rows behind
 * an audit row claiming `inserted: 0`. An operator reading /admin sees "FAILED, nothing inserted"
 * and reasonably concludes the database is untouched (independent review, `gpt-5.6-terra`).
 *
 * The fix is deliberately NOT a transaction. Wrapping a 2240-row EDGAR ingest in one would change
 * ingest behaviour materially — discarding two thousand good rows because the last one failed —
 * and risks long-transaction timeouts. The defect Terra named is a lying AUDIT, not a lying
 * database, so the audit is what gets fixed: the run reports what it actually managed.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const SOURCE_CODE = "TEST_PARTIAL_PROGRESS_SOURCE";

describeIfDb("recordIngestRun reports partial progress on failure", () => {
  let prisma: typeof PrismaClientInstance;
  let recordIngestRun: typeof import("@/server/domain/ingestRun").recordIngestRun;
  let sourceId: string;

  async function cleanup() {
    const existing = await prisma.source.findUnique({ where: { code: SOURCE_CODE } });
    if (!existing) return;
    await prisma.ingestRun.deleteMany({ where: { sourceId: existing.id } });
    await prisma.source.delete({ where: { id: existing.id } });
  }

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ recordIngestRun } = await import("@/server/domain/ingestRun"));
    await cleanup();
    const source = await prisma.source.create({
      data: { code: SOURCE_CODE, name: "Partial progress test source", tier: "TIER_S" },
    });
    sourceId = source.id;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("records what actually landed when the run throws partway through", async () => {
    await prisma.ingestRun.deleteMany({ where: { sourceId } });

    await expect(
      recordIngestRun(
        { sourceCode: SOURCE_CODE, target: "PARTIAL", mode: "FULL" },
        async (progress) => {
          // Simulates 50 rows written, then a malformed 51st.
          progress.inserted = 50;
          progress.fetched = 51;
          throw new Error("row 51 was malformed");
        },
      ),
    ).rejects.toThrow(/row 51/);

    const run = await prisma.ingestRun.findFirst({
      where: { sourceId, target: "PARTIAL" },
      orderBy: { startedAt: "desc" },
    });

    expect(run).not.toBeNull();
    expect(run!.status).toBe("FAILED");
    // The point: 50, not 0.
    expect(run!.inserted).toBe(50);
    expect(run!.fetched).toBe(51);
    expect(run!.error).toMatch(/row 51/);
  });

  it("still records zeros when the run genuinely wrote nothing before failing", async () => {
    // The negative control. Reporting progress must reflect reality in both directions, or the
    // number is decoration.
    await prisma.ingestRun.deleteMany({ where: { sourceId } });

    await expect(
      recordIngestRun({ sourceCode: SOURCE_CODE, target: "NOTHING", mode: "FULL" }, async () => {
        throw new Error("failed before writing anything");
      }),
    ).rejects.toThrow();

    const run = await prisma.ingestRun.findFirst({
      where: { sourceId, target: "NOTHING" },
      orderBy: { startedAt: "desc" },
    });
    expect(run!.status).toBe("FAILED");
    expect(run!.inserted).toBe(0);
  });

  it("does not disturb the success path, which reports its own returned outcome", async () => {
    await prisma.ingestRun.deleteMany({ where: { sourceId } });

    await recordIngestRun(
      { sourceCode: SOURCE_CODE, target: "OK", mode: "FULL" },
      async (progress) => {
        // A run may report progress AND return a final outcome. The returned value wins: it is
        // the authoritative account, and progress is only a fallback for the path that has none.
        progress.inserted = 1;
        return { inserted: 7, fetched: 7, providerTotal: 7, truncated: false };
      },
    );

    const run = await prisma.ingestRun.findFirst({
      where: { sourceId, target: "OK" },
      orderBy: { startedAt: "desc" },
    });
    expect(run!.status).toBe("SUCCESS");
    expect(run!.inserted).toBe(7);
  });

  it("accepts a run function that ignores the progress parameter entirely", async () => {
    // Backward compatibility, checked rather than assumed: every existing caller is a zero-arg
    // arrow, and none of them should need touching.
    await prisma.ingestRun.deleteMany({ where: { sourceId } });
    await recordIngestRun({ sourceCode: SOURCE_CODE, target: "LEGACY" }, async () => ({
      inserted: 3,
    }));
    const run = await prisma.ingestRun.findFirst({
      where: { sourceId, target: "LEGACY" },
      orderBy: { startedAt: "desc" },
    });
    expect(run!.inserted).toBe(3);
    expect(run!.status).toBe("SUCCESS");
  });
});
