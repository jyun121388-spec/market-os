import { prisma } from "@/server/db/client";
import { computeCompanyXray } from "@/server/domain/companyXray";
import { verify } from "./evaluate";
import { verificationInputFromFilingDiff } from "./fromFilingDiff";
import type { DimensionName, Verdict } from "./types";

/**
 * Verify — SHADOW RUN over real v1 output (docs/VERIFY_ARCHITECTURE.md).
 *
 * Takes what Market OS actually produces for a company, runs it through the evaluators, and
 * records the verdicts. It changes nothing: no writes, no v1 imports of this module, no path by
 * which a verdict can reach a rendered page.
 *
 * **A failure inside the verifier must never become a v1 failure.** Every observation is produced
 * inside a try/catch that degrades to `SHADOW_VERIFY_ERROR`. A shadow layer that can crash the
 * thing it observes is not a shadow layer — and this one runs over financial data where the
 * temptation to "just let it throw" is exactly wrong.
 */

export interface ShadowObservation {
  outputType: "FILING_DIFF";
  outputId: string;
  entityRef: string;
  sourceCode: string;
  verdict: Verdict | "SHADOW_VERIFY_ERROR";
  /** Dimensions that failed. A verdict must always be traceable to a cause. */
  failed: DimensionName[];
  /** Disclosed caveats — present even on a passing verdict. */
  limitations: string[];
  /** Completeness state of the data underneath, as the Fabric reports it. */
  completeness: "COMPLETE" | "UNCONFIRMED" | "KNOWN_INCOMPLETE" | "LAST_RUN_FAILED" | "UNKNOWN";
  /**
   * Every dimension's status, not just the failures.
   *
   * The first shadow run returned one verdict for all eight outputs and there was no way to see
   * why from the observation alone. A uniform verdict with no breakdown is indistinguishable from
   * a broken verifier, so the breakdown travels with it.
   */
  dimensions: Record<string, string>;
  /** Non-null only when the verifier itself failed. */
  error?: string;
}

export interface ShadowRunResult {
  /** Stamped by the caller, not here — `Date.now()` inside the run would make it untestable. */
  observations: ShadowObservation[];
  byVerdict: Record<string, number>;
}

/**
 * A stable identifier for the evaluator behind a set of observations.
 *
 * Bumped by hand when evaluator semantics change. Without it a ledger of verdicts is
 * uninterpretable later: "REJECTED" means nothing unless you know which rules produced it.
 */
export const VERIFIER_VERSION = "verify-shadow-1";

/**
 * Runs Verify over one company's real Filing Diff output.
 *
 * Returns observations rather than persisting them. Keeping the write decision with the caller is
 * what makes this safe to run against `market_os_dev`, which holds real ingested SEC data.
 */
export async function shadowVerifyCompany(corpCode: string): Promise<ShadowRunResult> {
  const observations: ShadowObservation[] = [];

  const xray = await computeCompanyXray(corpCode);
  if (!xray) return { observations, byVerdict: {} };

  // The same completeness evidence the page shows its reader, so the verifier is judging the
  // output as presented rather than a more favourable version of it.
  const completeness = xray.completeness.status;
  const truncated = completeness === "KNOWN_INCOMPLETE";
  const providerTotal = completeness === "COMPLETE" ? xray.company.filingCount : null;

  for (const diff of xray.changes) {
    try {
      const input = verificationInputFromFilingDiff(diff, {
        completeness: {
          providerTotal,
          fetched: xray.company.filingCount,
          truncated,
        },
      });
      // INSUFFICIENT_DATA diffs produce no claim. Skipping them is correct: there is nothing to
      // verify, and emitting a verdict would imply one was evaluated.
      if (!input) continue;

      const result = verify(input);
      observations.push({
        outputType: "FILING_DIFF",
        outputId: result.outputId,
        entityRef: corpCode,
        sourceCode: diff.sourceCode ?? "",
        verdict: result.verdict,
        failed: result.failed,
        limitations: result.limitations,
        dimensions: Object.fromEntries(
          Object.entries(result.dimensions).map(([name, d]) => [name, d.status]),
        ),
        completeness,
      });
    } catch (error) {
      // Degrade, never propagate. A defect in the verifier must cost an observation, not a page.
      observations.push({
        outputType: "FILING_DIFF",
        outputId: `filingDiff:${corpCode}:${diff.concept}:${diff.unit}`,
        entityRef: corpCode,
        sourceCode: diff.sourceCode ?? "",
        verdict: "SHADOW_VERIFY_ERROR",
        failed: [],
        limitations: [],
        dimensions: {},
        completeness,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const byVerdict: Record<string, number> = {};
  for (const o of observations) byVerdict[o.verdict] = (byVerdict[o.verdict] ?? 0) + 1;

  return { observations, byVerdict };
}

/** Every company with stored filings, so a shadow run needs no hard-coded list. */
export async function companiesWithFilings(): Promise<string[]> {
  const rows = await prisma.filing.findMany({
    distinct: ["corpCode"],
    select: { corpCode: true },
    orderBy: { corpCode: "asc" },
  });
  return rows.map((r) => r.corpCode);
}
