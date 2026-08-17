import { prisma } from "@/server/db/client";
import { computeFilingDiff, type FilingDiffResult } from "./filingDiff";

/**
 * Company X-Ray (docs/ROADMAP.md M15, M16) — the read model behind `/company/[corpCode]`.
 *
 * M15 and M16 built the EDGAR XBRL adapter, the `FinancialFact` store and the filing-diff
 * calculation, but nothing ever assembled them into something a user could look at. This is that
 * assembly, and no new financial logic: every number here is either a stored fact or the output
 * of `computeFinancialFactDiff`.
 *
 * What it deliberately does NOT do (docs/LEGAL_GUARDRAILS.md): no score, no rating, no valuation
 * verdict, no target, no suggested action. It shows what the company reported and how it changed,
 * and leaves the interpretation to the reader. There is no field on any type below that could
 * carry a judgment, which is the same structural approach `tests/etfSchemaGuardrail.test.ts`
 * takes for ETFs.
 */

export interface CompanySummary {
  corpCode: string;
  corpName: string;
  stockCode: string | null;
  sourceCode: string;
  filingCount: number;
  /** YYYY-MM-DD of the oldest and newest filings held — the span actually covered. */
  earliestFilingDate: string | null;
  latestFilingDate: string | null;
}

export interface ReportedFigure {
  concept: string;
  unit: string;
  value: number;
  /** YYYY-MM-DD. Null start means an instant concept — a balance at a date, not a flow. */
  periodStart: string | null;
  periodEnd: string;
  /** Whole months covered, or null for an instant. Distinguishes a quarter from a year. */
  periodMonths: number | null;
  fiscalPeriod: string | null;
  fiscalYear: number | null;
  form: string;
  accessionNumber: string;
}

export interface RecentFiling {
  reportName: string;
  receiptNo: string;
  receiptDate: string; // YYYY-MM-DD
}

/**
 * Whether the stored data for this company is known to be incomplete.
 *
 * A truncation flag that only reaches an operator dashboard is not much use to the person
 * reading the numbers. Every adapter reports `truncated` because each one silently stored a
 * partial result at some point; if the last run for this company ended PARTIAL or FAILED, the
 * page built from it must say so rather than presenting a subset as the whole history.
 *
 * `null` means no ingest run has been recorded for this company — the runs table only started
 * being written recently, so absence is genuinely "unknown" rather than "complete", and it is
 * reported as such.
 */
export interface CompletenessNote {
  /**
   * `UNCONFIRMED` is deliberately distinct from both COMPLETE and UNKNOWN. The run succeeded and
   * reported no shortfall, but the provider stated no total to compare against — so no shortfall
   * was DETECTED, which is a weaker claim than completeness. UNKNOWN means no run at all.
   */
  status: "COMPLETE" | "UNCONFIRMED" | "KNOWN_INCOMPLETE" | "LAST_RUN_FAILED" | "UNKNOWN";
  detail: string;
}

export interface CompanyXray {
  company: CompanySummary;
  /** Most recent reported figure per (concept, period length). */
  latestFigures: ReportedFigure[];
  /** Period-over-period change per concept, or INSUFFICIENT_DATA where none is comparable. */
  changes: FilingDiffResult[];
  recentFilings: RecentFiling[];
  completeness: CompletenessNote;
}

const DAYS_PER_MONTH = 30.436875;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function periodLengthMonths(periodStart: Date | null, periodEnd: Date): number | null {
  if (!periodStart) return null;
  return Math.round((periodEnd.getTime() - periodStart.getTime()) / MS_PER_DAY / DAYS_PER_MONTH);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Every company with at least one stored filing, for the index page. */
export async function listCompanies(): Promise<CompanySummary[]> {
  const grouped = await prisma.filing.groupBy({
    by: ["corpCode", "corpName", "sourceId"],
    _count: { _all: true },
    _min: { receiptDate: true },
    _max: { receiptDate: true },
  });

  const sources = await prisma.source.findMany({ select: { id: true, code: true } });
  const sourceCode = new Map(sources.map((s) => [s.id, s.code]));

  const summaries = await Promise.all(
    grouped.map(async (g) => {
      const withTicker = await prisma.filing.findFirst({
        where: { corpCode: g.corpCode, sourceId: g.sourceId, stockCode: { not: null } },
        select: { stockCode: true },
      });
      return {
        corpCode: g.corpCode,
        corpName: g.corpName,
        stockCode: withTicker?.stockCode ?? null,
        sourceCode: sourceCode.get(g.sourceId) ?? "UNKNOWN",
        filingCount: g._count._all,
        earliestFilingDate: g._min.receiptDate ? iso(g._min.receiptDate) : null,
        latestFilingDate: g._max.receiptDate ? iso(g._max.receiptDate) : null,
      };
    }),
  );

  return summaries.sort((a, b) => a.corpName.localeCompare(b.corpName));
}

/**
 * Of the given references, the ones that identify a company with stored filings.
 *
 * Used by the watchlist to link only the entries that actually resolve. A watchlist `itemRef` is
 * free text — a user may type "AAPL", a padded CIK, or something that matches nothing — so
 * linking every entry unconditionally would produce dead links for most of them, which is worse
 * than plain text.
 */
export async function findKnownCorpCodes(refs: string[]): Promise<Set<string>> {
  if (refs.length === 0) return new Set();
  const rows = await prisma.filing.findMany({
    where: { corpCode: { in: refs } },
    distinct: ["corpCode"],
    select: { corpCode: true },
  });
  return new Set(rows.map((r) => r.corpCode));
}

/**
 * Assembles one company's X-Ray, or null when nothing is stored for that corpCode.
 *
 * `latestFigures` keeps one row per (concept, period length) rather than per concept. A filing
 * reports the same concept over several spans — nine months and three months ending on the same
 * date — and collapsing those to "the latest" would silently pick one of two very different
 * numbers (docs/DECISIONS.md, 2026-08-17). Both are shown, each labelled with what it covers.
 */
export async function computeCompanyXray(corpCode: string): Promise<CompanyXray | null> {
  const anyFiling = await prisma.filing.findFirst({
    where: { corpCode },
    orderBy: { receiptDate: "desc" },
    include: { source: { select: { code: true } } },
  });
  if (!anyFiling) return null;

  // Every query below is scoped to the source of the filing that named the company, because the
  // page presents ONE `sourceCode` for everything it shows. Keyed on corpCode alone, the header
  // said one provider while the filing count, ticker, figures and filing list were pooled across
  // all of them — a merged entity presented as a single sourced record. `listCompanies` already
  // groups by (corpCode, sourceId) and would have listed those as two companies, so the index
  // and the detail page did not agree on how many companies existed.
  //
  // `changes` and `completeness` below were already scoped this way; these four were not.
  const scope = { sourceId: anyFiling.sourceId, corpCode };

  const [aggregate, tickerRow, facts, recentFilings] = await Promise.all([
    prisma.filing.aggregate({
      where: scope,
      _count: { _all: true },
      _min: { receiptDate: true },
      _max: { receiptDate: true },
    }),
    prisma.filing.findFirst({
      where: { ...scope, stockCode: { not: null } },
      select: { stockCode: true },
    }),
    prisma.financialFact.findMany({
      where: scope,
      orderBy: [{ periodEnd: "desc" }, { filedDate: "desc" }],
    }),
    prisma.filing.findMany({
      where: scope,
      orderBy: { receiptDate: "desc" },
      take: 10,
      select: { reportName: true, receiptNo: true, receiptDate: true },
    }),
  ]);

  // One figure per (concept, period length). Rows arrive newest-first, so the first of each key
  // is the most recent.
  const seen = new Set<string>();
  const latestFigures: ReportedFigure[] = [];
  for (const f of facts) {
    const months = periodLengthMonths(f.periodStart, f.periodEnd);
    const key = `${f.concept}|${f.unit}|${months ?? "instant"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    latestFigures.push({
      concept: f.concept,
      unit: f.unit,
      value: Number(f.value.toString()),
      periodStart: f.periodStart ? iso(f.periodStart) : null,
      periodEnd: iso(f.periodEnd),
      periodMonths: months,
      fiscalPeriod: f.fiscalPeriod,
      fiscalYear: f.fiscalYear,
      form: f.form,
      accessionNumber: f.accessionNumber,
    });
  }
  latestFigures.sort(
    (a, b) => a.concept.localeCompare(b.concept) || (a.periodMonths ?? 0) - (b.periodMonths ?? 0),
  );

  const conceptUnits = [...new Set(facts.map((f) => `${f.concept}|${f.unit}`))].map((k) => {
    const [concept, unit] = k.split("|");
    return { concept, unit };
  });
  const changes = await computeFilingDiff(anyFiling.sourceId, corpCode, conceptUnits);
  const completeness = await assessCompleteness(anyFiling.sourceId, corpCode);

  return {
    company: {
      corpCode,
      corpName: anyFiling.corpName,
      stockCode: tickerRow?.stockCode ?? null,
      sourceCode: anyFiling.source.code,
      filingCount: aggregate._count._all,
      earliestFilingDate: aggregate._min.receiptDate ? iso(aggregate._min.receiptDate) : null,
      latestFilingDate: aggregate._max.receiptDate ? iso(aggregate._max.receiptDate) : null,
    },
    latestFigures,
    changes: changes.sort((a, b) => a.concept.localeCompare(b.concept)),
    recentFilings: recentFilings.map((f) => ({
      reportName: f.reportName,
      receiptNo: f.receiptNo,
      receiptDate: iso(f.receiptDate),
    })),
    completeness,
  };
}

/**
 * Looks at the most recent ingest run per target for this company and reports whether the data
 * on the page can be trusted as the whole history.
 *
 * Targets are the canonical padded CIK and its `xbrl:` counterpart — the same identifier the
 * filings and facts are stored under. They were recorded unpadded until the
 * `20260818090000_canonical_ingest_run_target` migration, which is why that migration exists:
 * a lookup keyed on the wrong representation returns nothing and reports UNKNOWN forever, which
 * looks like a missing feature rather than a broken join.
 */
export async function assessCompleteness(
  sourceId: string,
  corpCode: string,
): Promise<CompletenessNote> {
  const runs = await prisma.ingestRun.findMany({
    where: { sourceId, target: { in: [corpCode, `xbrl:${corpCode}`] } },
    orderBy: { startedAt: "desc" },
  });

  if (runs.length === 0) {
    return {
      status: "UNKNOWN",
      detail:
        "No ingest run has been recorded for this company, so whether the stored history is " +
        "complete is not known. Absence of a record is not evidence of completeness.",
    };
  }

  // Newest run per target — older ones are history, not current state.
  const seen = new Set<string>();
  const latest = runs.filter((r) => !seen.has(r.target) && seen.add(r.target));

  const failed = latest.filter((r) => r.status === "FAILED");
  if (failed.length > 0) {
    return {
      status: "LAST_RUN_FAILED",
      detail:
        `The most recent ingest for ${failed.map((r) => r.target).join(", ")} failed, so the ` +
        "figures below may be missing anything that run would have added.",
    };
  }

  const partial = latest.filter((r) => r.truncated || r.status === "PARTIAL");
  if (partial.length > 0) {
    const worst = partial[0];
    const shortfall =
      worst.providerTotal !== null && worst.fetched !== null
        ? ` (${worst.fetched} of ${worst.providerTotal} records)`
        : "";
    return {
      status: "KNOWN_INCOMPLETE",
      detail:
        `The most recent ingest stored less than the provider reported${shortfall}. This page ` +
        "shows a subset of this company's history, not all of it.",
    };
  }

  // A successful run proves no shortfall was DETECTED. It only proves completeness if the
  // provider actually stated a total to check against. EDGAR states none, so every real run in
  // this database has providerTotal NULL — and the old wording told readers the ingest "retrieved
  // everything the provider reported" on evidence that did not exist. This function already
  // refuses that inference for the no-run case; refusing it here too is the same rule.
  const withoutTotal = latest.filter((r) => r.providerTotal === null);
  if (withoutTotal.length > 0) {
    return {
      status: "UNCONFIRMED",
      detail:
        `The most recent ingest for ${withoutTotal.map((r) => r.target).join(", ")} completed ` +
        "without error, but the provider did not state a total, so there is nothing to check the " +
        "stored count against. No shortfall was detected — which is not the same as knowing the " +
        "history is complete.",
    };
  }

  return {
    status: "COMPLETE",
    detail: "The most recent ingest retrieved everything the provider reported.",
  };
}
