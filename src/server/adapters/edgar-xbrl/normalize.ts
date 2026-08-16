import { assertValidCalendarDate } from "../dateValidation";
import type { XbrlCompanyFacts, XbrlFactValue } from "./types";
import { TRACKED_XBRL_CONCEPTS } from "./types";

export interface NormalizedFinancialFact {
  corpCode: string;
  taxonomy: string;
  concept: string;
  unit: string;
  periodStart: Date | null;
  periodEnd: Date;
  // Null when SEC itself reports no fiscal label for the row (see XbrlFactValue.fy). The fact
  // is still fully sourced — value, period, form and accession number are all real — so it is
  // kept rather than dropped; only the label is missing.
  fiscalYear: number | null;
  fiscalPeriod: string | null;
  form: string;
  accessionNumber: string;
  filedDate: Date;
  value: string; // decimal string, safe for Prisma's Decimal field
  raw: XbrlFactValue;
}

/**
 * Why a tracked concept produced no facts. Reported rather than silently dropped — see
 * `NormalizeCompanyFactsResult`.
 */
export interface SkippedConcept {
  concept: string;
  reason: "CONCEPT_NOT_REPORTED" | "NO_USD_UNIT";
  /** For NO_USD_UNIT: the units the filer actually used, so the gap is diagnosable. */
  unitsAvailable?: string[];
}

export interface NormalizeCompanyFactsResult {
  facts: NormalizedFinancialFact[];
  /** Tracked concepts that yielded nothing, with the reason. Never silently omitted. */
  skippedConcepts: SkippedConcept[];
  /** Individual rows dropped for a non-finite `val`. Never coerced to 0. */
  skippedNonNumeric: XbrlFactValue[];
  /** True when the filer reports no us-gaap taxonomy at all (e.g. a foreign-form filer). */
  noUsGaapTaxonomy: boolean;
}

/**
 * Extracts the tracked us-gaap concepts (TRACKED_XBRL_CONCEPTS) in USD from a raw XBRL
 * companyfacts response. Concepts/units outside the tracked set are not extracted — this
 * adapter's scope is deliberately a small starter set (docs/DECISIONS.md).
 *
 * Everything skipped is REPORTED, which is the part that changed on 2026-08-17. This function
 * used to `return []` for a filer with no us-gaap taxonomy and `continue` past any concept
 * lacking a USD unit, both without a word — so a non-USD or foreign-form filer would ingest
 * zero facts and look indistinguishable from one that simply had nothing new. FRED and ECOS
 * already return `skippedMissing` for exactly this reason; this brings the XBRL adapter in
 * line rather than inventing a second convention. It matters here more than most places: this
 * is the adapter whose silent 1000-filing cap and non-nullable fiscal label both went unnoticed
 * because nothing was counting what did not arrive.
 */
export function normalizeCompanyFacts(
  response: XbrlCompanyFacts,
  cik: string,
): NormalizeCompanyFactsResult {
  const usGaap = response.facts["us-gaap"];
  if (!usGaap) {
    return {
      facts: [],
      skippedConcepts: TRACKED_XBRL_CONCEPTS.map((concept) => ({
        concept,
        reason: "CONCEPT_NOT_REPORTED" as const,
      })),
      skippedNonNumeric: [],
      noUsGaapTaxonomy: true,
    };
  }

  const facts: NormalizedFinancialFact[] = [];
  const skippedConcepts: SkippedConcept[] = [];
  const skippedNonNumeric: XbrlFactValue[] = [];

  for (const concept of TRACKED_XBRL_CONCEPTS) {
    const conceptData = usGaap[concept];
    if (!conceptData) {
      // A filer genuinely not tagging a concept is normal, not an error — Apple reports
      // RevenueFromContractWithCustomer... rather than Revenues, for instance.
      skippedConcepts.push({ concept, reason: "CONCEPT_NOT_REPORTED" });
      continue;
    }

    const usdValues = conceptData.units?.USD;
    if (!usdValues) {
      skippedConcepts.push({
        concept,
        reason: "NO_USD_UNIT",
        unitsAvailable: Object.keys(conceptData.units ?? {}),
      });
      continue;
    }

    for (const raw of usdValues) {
      if (!Number.isFinite(raw.val)) {
        skippedNonNumeric.push(raw);
        continue;
      }

      facts.push({
        corpCode: cik,
        taxonomy: "us-gaap",
        concept,
        unit: "USD",
        periodStart: raw.start ? parseXbrlDateAsUtc(raw.start) : null,
        periodEnd: parseXbrlDateAsUtc(raw.end),
        fiscalYear: raw.fy ?? null,
        fiscalPeriod: raw.fp ?? null,
        form: raw.form,
        accessionNumber: raw.accn,
        filedDate: parseXbrlDateAsUtc(raw.filed),
        value: String(raw.val),
        raw,
      });
    }
  }

  return { facts, skippedConcepts, skippedNonNumeric, noUsGaapTaxonomy: false };
}

function parseXbrlDateAsUtc(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Unrecognized XBRL date format: "${date}"`);
  }
  const [year, month, day] = date.split("-").map(Number);
  // Shape is not validity: "2026-02-30" passes the regex and Date.UTC would roll it to Mar 2,
  // filing a financial fact under a period end SEC never reported. Last of the four adapters to
  // get this guard (FRED/ECOS 2026-08-16, DART and EDGAR submissions earlier on 2026-08-17).
  assertValidCalendarDate(year, month, day, date);
  return new Date(Date.UTC(year, month - 1, day));
}
