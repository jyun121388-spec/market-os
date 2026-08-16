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
 * Extracts the tracked us-gaap concepts (TRACKED_XBRL_CONCEPTS) in USD from a raw XBRL
 * companyfacts response. Concepts/units not in the tracked set are simply not extracted (not
 * an error) — this adapter's scope is deliberately a small starter set (docs/DECISIONS.md).
 * A malformed value (non-finite `val`) is skipped, not coerced to 0 — same discipline as every
 * other adapter's missing-value handling.
 */
export function normalizeCompanyFacts(
  response: XbrlCompanyFacts,
  cik: string,
): NormalizedFinancialFact[] {
  const usGaap = response.facts["us-gaap"];
  if (!usGaap) return [];

  const facts: NormalizedFinancialFact[] = [];

  for (const concept of TRACKED_XBRL_CONCEPTS) {
    const conceptData = usGaap[concept];
    const usdValues = conceptData?.units.USD;
    if (!usdValues) continue;

    for (const raw of usdValues) {
      if (!Number.isFinite(raw.val)) continue;

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

  return facts;
}

function parseXbrlDateAsUtc(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Unrecognized XBRL date format: "${date}"`);
  }
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}
