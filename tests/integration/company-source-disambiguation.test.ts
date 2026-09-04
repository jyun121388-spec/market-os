import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

/**
 * IR-032 — two providers, one corp code, and a page that picked between them silently.
 *
 * `computeCompanyXray` resolved the provider by taking the most recent filing carrying the code,
 * whichever provider that was. The company index lists `(sourceCode, corpCode)` rows and linked
 * every one to `/company/${corpCode}`, so the second company was unreachable — and with equal
 * receipt dates the choice was not even stable between requests.
 *
 * Latent while only SEC data is ingested, and structurally the IR-001/IR-002 precondition rebuilt
 * at the routing layer: a business identifier that is unique only within a provider, used as if it
 * were global. Found by independent review (`gpt-5.6-terra`, packet target A11).
 *
 * The fix is a refusal rather than a better guess. Where the code is ambiguous and no provider is
 * named, `computeCompanyXray` returns null and the page asks. Rendering a company under a header
 * that names one provider while the figures came from another is the failure both earlier findings
 * were about, and it reads as correct from every angle except the one that matters.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const SOURCE_A = "TEST_DISAMBIG_A";
const SOURCE_B = "TEST_DISAMBIG_B";
const SHARED_CORP_CODE = "00700700";

describeIfDb("one corp code, two providers (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let computeCompanyXray: typeof import("@/server/domain/companyXray").computeCompanyXray;
  let listCompanySources: typeof import("@/server/domain/companyXray").listCompanySources;
  const sourceIds: string[] = [];

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ computeCompanyXray, listCompanySources } = await import("@/server/domain/companyXray"));

    // Identical receipt dates on purpose. Different dates would let an ordering decide the winner
    // consistently, which hides that there was never a principled winner to pick.
    const sameDate = new Date("2026-07-30T00:00:00.000Z");

    for (const [code, corpName] of [
      [SOURCE_A, "Northwind Traders Inc."],
      [SOURCE_B, "노스윈드 주식회사"],
    ] as const) {
      const source = await prisma.source.upsert({
        where: { code },
        update: {},
        create: { code, name: `${code} disambiguation test`, tier: "TIER_S" },
      });
      sourceIds.push(source.id);
      await prisma.filing.deleteMany({ where: { sourceId: source.id } });
      await prisma.filing.create({
        data: {
          sourceId: source.id,
          corpCode: SHARED_CORP_CODE,
          corpName,
          reportName: "10-Q",
          receiptNo: `${code}-0001`,
          receiptDate: sameDate,
          raw: {},
        },
      });
    }
  });

  afterAll(async () => {
    for (const sourceId of sourceIds) {
      await prisma.filing.deleteMany({ where: { sourceId } });
      await prisma.source.delete({ where: { id: sourceId } });
    }
    await prisma.$disconnect();
  });

  it("reports both providers for the shared code", async () => {
    expect(await listCompanySources(SHARED_CORP_CODE)).toEqual([SOURCE_A, SOURCE_B].sort());
  });

  it("refuses to pick a provider when the code is ambiguous and none is named", async () => {
    // Null, not an arbitrary company. The page turns this into a question; a caller that cannot
    // ask gets an explicit nothing rather than a plausible wrong answer.
    expect(await computeCompanyXray(SHARED_CORP_CODE)).toBeNull();
  });

  it("returns each provider's company when the provider is named", async () => {
    const a = await computeCompanyXray(SHARED_CORP_CODE, SOURCE_A);
    const b = await computeCompanyXray(SHARED_CORP_CODE, SOURCE_B);

    expect(a?.company.sourceCode).toBe(SOURCE_A);
    expect(b?.company.sourceCode).toBe(SOURCE_B);
    // Both reachable, and distinguishable. Before the fix one of these was unreachable entirely.
    expect(a?.company.corpName).not.toBe(b?.company.corpName);
  });

  it("still resolves without a provider when the code is unambiguous", async () => {
    // The control. Every real company today has exactly one provider, and turning that into a
    // disambiguation prompt would make the fix worse than the defect.
    await prisma.filing.deleteMany({ where: { sourceId: sourceIds[1] } });
    const only = await computeCompanyXray(SHARED_CORP_CODE);
    expect(only?.company.sourceCode).toBe(SOURCE_A);
  });

  it("returns null for a code no provider reports", async () => {
    expect(await computeCompanyXray("NO_SUCH_CORP_CODE_AT_ALL")).toBeNull();
  });
});
