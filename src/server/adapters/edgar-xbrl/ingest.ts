import { prisma } from "@/server/db/client";
import { insertIfAbsent } from "@/server/domain/idempotentInsert";
import { fetchCompanyFacts } from "./client";
import { normalizeCompanyFacts } from "./normalize";
import type { XbrlCompanyDefinition } from "./types";

export interface IngestResult {
  cik: string;
  inserted: number;
  unchanged: number;
  /** Tracked concepts that yielded nothing, with the reason — never a silent zero. */
  skippedConcepts: number;
  /** Individual fact rows dropped for a non-finite value. Never coerced to 0. */
  skippedNonNumeric: number;
}

/**
 * Fetches, normalizes, and persists XBRL financial facts for one company. Idempotent upsert
 * keyed on (sourceId, corpCode, concept, unit, periodEnd, accessionNumber) — a later filing
 * restating an earlier period arrives with its own accession number and is preserved as a
 * distinct row (real history), not overwritten in place.
 */
export async function ingestCompanyFacts(company: XbrlCompanyDefinition): Promise<IngestResult> {
  const source = await prisma.source.upsert({
    where: { code: "SEC_EDGAR" },
    update: {},
    create: { code: "SEC_EDGAR", name: "SEC EDGAR", tier: "TIER_S" },
  });

  const raw = await fetchCompanyFacts(company.cik);
  const { facts, skippedConcepts, skippedNonNumeric, noUsGaapTaxonomy } = normalizeCompanyFacts(
    raw,
    company.cik,
  );

  if (noUsGaapTaxonomy) {
    console.warn(
      `[EDGAR XBRL] ${company.cik}: filer reports no us-gaap taxonomy at all — zero facts ` +
        "ingested. This is a scope limit of the adapter, not an empty filing.",
    );
  }
  for (const skipped of skippedConcepts) {
    if (skipped.reason === "NO_USD_UNIT") {
      console.warn(
        `[EDGAR XBRL] ${company.cik}: concept ${skipped.concept} is reported but not in USD ` +
          `(units: ${skipped.unitsAvailable?.join(", ") || "none"}) — skipped. A non-USD filer ` +
          "would otherwise ingest silently as zero.",
      );
    }
  }

  let inserted = 0;
  let unchanged = 0;

  for (const fact of facts) {
    const existing = await prisma.financialFact.findUnique({
      where: {
        sourceId_corpCode_concept_unit_periodEnd_accessionNumber: {
          sourceId: source.id,
          corpCode: fact.corpCode,
          concept: fact.concept,
          unit: fact.unit,
          periodEnd: fact.periodEnd,
          accessionNumber: fact.accessionNumber,
        },
      },
    });

    if (existing) {
      unchanged++;
      continue;
    }

    const didInsert = await insertIfAbsent(() =>
      prisma.financialFact.create({
        data: {
          sourceId: source.id,
          corpCode: fact.corpCode,
          taxonomy: fact.taxonomy,
          concept: fact.concept,
          unit: fact.unit,
          periodStart: fact.periodStart,
          periodEnd: fact.periodEnd,
          fiscalYear: fact.fiscalYear,
          fiscalPeriod: fact.fiscalPeriod,
          form: fact.form,
          accessionNumber: fact.accessionNumber,
          filedDate: fact.filedDate,
          value: fact.value,
          raw: fact.raw,
        },
      }),
    );
    if (didInsert) inserted++;
    else unchanged++;
  }

  return {
    cik: company.cik,
    inserted,
    unchanged,
    skippedConcepts: skippedConcepts.length,
    skippedNonNumeric: skippedNonNumeric.length,
  };
}
