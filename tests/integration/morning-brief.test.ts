import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb("buildMorningBrief (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let buildMorningBrief: typeof import("@/server/domain/morningBrief").buildMorningBrief;

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ buildMorningBrief } = await import("@/server/domain/morningBrief"));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("composes without throwing and returns well-shaped sections", async () => {
    const brief = await buildMorningBrief();

    expect(typeof brief.generatedAt).toBe("string");
    expect(Array.isArray(brief.recentEvents)).toBe(true);
    expect(Array.isArray(brief.recentFilings)).toBe(true);
    expect(Array.isArray(brief.whatChanged)).toBe(true);
    expect(Array.isArray(brief.regime.axes)).toBe(true);
    expect(brief.regime.axes).toHaveLength(8);
    expect(Array.isArray(brief.calendar)).toBe(true);
  });

  it("does not persist any new Claim rows (read-only, safe to call repeatedly)", async () => {
    const before = await prisma.claim.count();
    await buildMorningBrief();
    await buildMorningBrief();
    const after = await prisma.claim.count();
    expect(after).toBe(before);
  });

  it("only includes PROJECTED calendar entries, never NOT_TRACKED/INSUFFICIENT_DATA noise", async () => {
    const brief = await buildMorningBrief();
    for (const entry of brief.calendar) {
      expect(entry.status).toBe("PROJECTED");
    }
  });
});
