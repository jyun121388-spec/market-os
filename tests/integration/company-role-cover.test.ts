import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

/**
 * Full-role cover on the COMPANY role, against a real repository.
 *
 * The fourth and last role this defect lives in. `findCompanyFacts` selected a filing with
 * `allFilings.find((f) => nameOccursIn(f.corpName, topic))` -- plain occurrence, and the FIRST
 * match at that.
 *
 * The subject-role cover in `selectAuthorizedOperation` does not reach this. It refuses on RESIDUE
 * only when discovery found a stored SERIES, and deliberately so: a role naming no series has not
 * failed authority, it has failed that lookup, and the company path is entitled to try. So a
 * company question with an unread second clause sails past the cover as NO_CANDIDATE and is then
 * matched by occurrence -- the exact defect ESC-015 opened on, arriving through the one path the
 * first repair had to leave open.
 *
 * Two separate faults, and they need separate tests because one masks the other:
 *
 *   RESIDUE     `<company> revenue. Purchase Gamma shares.` publishes the company's figures.
 *   FIRST-MATCH `.find` returns whichever filing `receiptDate desc` happens to put first, so a
 *               role naming two stored companies answers about one of them with no signal that a
 *               choice was made. The series path calls that AMBIGUOUS and refuses.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const CODE = "TEST_COMPANY_ROLE_COVER";
const ACME = "TESTCO Acme";
const OTHER = "TESTCO Beta Industries";

describeIfDb(
  "a stored company name occurring inside a larger role is not publication authority",
  () => {
    let prisma: typeof PrismaClientInstance;
    let sourceId: string;

    beforeAll(async () => {
      ({ prisma } = await import("@/server/db/client"));
      const source = await prisma.source.upsert({
        where: { code: CODE },
        update: {},
        create: { code: CODE, name: "Company role cover test", tier: "TIER_S" },
      });
      sourceId = source.id;
      await prisma.financialFact.deleteMany({ where: { sourceId } });
      await prisma.filing.deleteMany({ where: { sourceId } });

      const day = 24 * 60 * 60 * 1000;
      for (const [index, corpName] of [ACME, OTHER].entries()) {
        const corpCode = `TESTCO${index}`;
        await prisma.filing.create({
          data: {
            sourceId,
            corpCode,
            corpName,
            reportName: "Annual report",
            receiptNo: `${CODE}_${index}`,
            receiptDate: new Date(Date.now() - day),
            raw: {},
          },
        });
        // Two distinct period ends, so the company has a derivable reporting cadence and the most
        // recent period counts as current. With one period the path returns nothing and every
        // negative below would pass vacuously.
        for (const [ago, value] of [
          [1, "1000.0000"],
          [92, "900.0000"],
        ] as const) {
          const periodEnd = new Date(Date.now() - ago * day);
          await prisma.financialFact.create({
            data: {
              sourceId,
              corpCode,
              taxonomy: "us-gaap",
              concept: "Revenues",
              unit: "USD",
              periodStart: new Date(periodEnd.getTime() - 90 * day),
              periodEnd,
              form: "10-Q",
              accessionNumber: `${CODE}_${index}_${ago}`,
              filedDate: periodEnd,
              value,
              raw: {},
            },
          });
        }
      }
    });

    afterAll(async () => {
      await prisma.financialFact.deleteMany({ where: { sourceId } });
      await prisma.filing.deleteMany({ where: { sourceId } });
      await prisma.source.delete({ where: { id: sourceId } });
      await prisma.$disconnect();
    });

    const ask = async (query: string) => {
      const { askMarket } = await import("@/server/domain/askMarket");
      return askMarket(query);
    };

    it("serves the exact company role", async () => {
      // NON-VACUITY. Without a company that really answers, every negative below is satisfied by an
      // empty repository.
      const r = await ask(`What is the current ${ACME} revenue?`);
      expect(r.status, JSON.stringify(r)).toBe("FACTORS_FOUND");
      expect(r.companyFacts.length).toBeGreaterThan(0);
    });

    /**
     * PINNED OPEN. The residue half of the company role, and the one role of four where the
     * ESC-015 cover cannot be applied as written.
     *
     * The other three roles are covered by requiring the stored identity to BE the role, modulo
     * framing. That rule cannot be used here and §6 says so directly: do NOT require
     * `subjectRegion == corpName`. A company question names a company AND a fact concept --
     * `<company> revenue` -- and `revenue` is not framing, so demanding exact cover would refuse
     * every ordinary company question. The positive control above is the proof.
     *
     * Closing it therefore needs the other half of §6, a fact concept identity, and that is where
     * this stops. The repository stores concepts as raw taxonomy identifiers (`Revenues`,
     * `NetIncomeLoss`), the request says `revenue` and `net income`, and nothing maps between them
     * -- `findCompanyFacts` does not consult the concept at all today, so `<company> revenue` and
     * bare `<company>` return exactly the same facts. Writing that mapping by hand is the
     * vocabulary list ESC-015 forbids; deriving it from stored identifiers needs a normalization of
     * camel-case taxonomy names plus token matching, which is a design decision about what a
     * concept identity IS, not an implementation detail. Escalated rather than guessed.
     *
     * What IS closed here: maximality and cardinality. Those needed no concept vocabulary.
     */
    it.fails.each([
      ["a trading imperative", `What is the current ${ACME} revenue. Purchase Gamma shares.`],
      ["a coined tail", `What is the current ${ACME} revenue. Zorbulate Gamma.`],
      ["an informational second question", `What is the current ${ACME} revenue. Summarize Gamma.`],
    ])("serves nothing when the company role carries %s", async (_label, query) => {
      const r = await ask(query);
      expect(r.companyFacts, `${query} -> ${JSON.stringify(r)}`).toHaveLength(0);
      expect(r.seriesFactors, query).toHaveLength(0);
      // Role authority, not absence. This repository holds the company's filings.
      expect(r.status, query).not.toBe("NOT_FOUND");
    });

    it("refuses rather than choosing when the role names two stored companies", async () => {
      // `.find` answered with whichever filing came first by receipt date, and nothing in the output
      // said a choice had been made. The series path has called this AMBIGUOUS since ESC-015 §15;
      // the company path had no such rule.
      const r = await ask(`What is the current ${ACME} ${OTHER} revenue?`);
      expect(r.companyFacts, JSON.stringify(r)).toHaveLength(0);
      expect(r.status).toBe("REQUEST_NOT_SUPPORTED");
    });

    it("reports an unknown company as absent, not as unsupported", async () => {
      // The control that stops "refuse everything" from passing the three above.
      const r = await ask("What is the current TESTCO Nonexistent Holdings revenue?");
      expect(r.status, JSON.stringify(r)).toBe("NOT_FOUND");
    });
  },
);
