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

export interface CompanyXray {
  company: CompanySummary;
  /** Most recent reported figure per (concept, period length). */
  latestFigures: ReportedFigure[];
  /** Period-over-period change per concept, or INSUFFICIENT_DATA where none is comparable. */
  changes: FilingDiffResult[];
  recentFilings: RecentFiling[];
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

  const [aggregate, tickerRow, facts, recentFilings] = await Promise.all([
    prisma.filing.aggregate({
      where: { corpCode },
      _count: { _all: true },
      _min: { receiptDate: true },
      _max: { receiptDate: true },
    }),
    prisma.filing.findFirst({
      where: { corpCode, stockCode: { not: null } },
      select: { stockCode: true },
    }),
    prisma.financialFact.findMany({
      where: { corpCode },
      orderBy: [{ periodEnd: "desc" }, { filedDate: "desc" }],
    }),
    prisma.filing.findMany({
      where: { corpCode },
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
  };
}
