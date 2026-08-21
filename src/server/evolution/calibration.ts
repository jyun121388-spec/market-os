/**
 * Whether the autonomous loop is calibrated against outcomes, or merely self-consistent.
 *
 * Evolution proposes, Governance classifies, the scheduler ranks, Claude works, and the result
 * lands back in the ledger. Every stage of that is internally coherent. None of it, until this
 * module, was checked against what the audits it produced actually FOUND — and a loop that ranks
 * proposals by its own confidence in them is a loop grading its own homework.
 *
 * The measurement is deliberately small and refuses to guess. Its inputs are the finding headers
 * in `docs/INTERIM_REVIEW_FINDINGS.md`, which carry an explicit verdict, and the ledger. Where a
 * finding records no verdict, the outcome is `UNKNOWN` and stays that way; a yield computed by
 * assuming unrecorded findings were valid would flatter the loop with numbers it did not earn.
 *
 * **The extraction itself produced a finding, and it is worth reading before trusting anything
 * here.** The first pass scanned finding BODIES for words like "rejected" and reported IR-022..026
 * and IR-029 as rejected. Both were valid — the word appeared in surrounding discussion. The
 * verdict lives in the header, in bold, and nowhere else. A 2-in-35 error rate, in the direction
 * of understating yield, from a script that looked entirely reasonable.
 */

export type FindingOutcome =
  /** Reproduced and fixed, or reproduced and deliberately deferred. The audit found something. */
  | "VALID"
  /** Reproduced as NOT a defect. The audit ran and the claim did not survive it. */
  | "REJECTED"
  /** Valid and consciously not fixed, with a recorded reason. */
  | "DEFERRED"
  /** The audit ran, found nothing, and closed a coverage gap. Positive evidence, not a blank. */
  | "NO_FINDING"
  /** No verdict was recorded. Never inferred, never counted as anything else. */
  | "UNKNOWN";

export interface CalibrationRow {
  id: string;
  outcome: FindingOutcome;
  title: string;
}

/**
 * Reads a verdict from a finding's header line.
 *
 * Header only. The body discusses alternatives, quotes reviewers and describes what was ruled out,
 * so scanning it finds the vocabulary of a verdict without the verdict.
 */
export function outcomeFromHeader(title: string): FindingOutcome {
  const t = title.toLowerCase();
  if (t.includes("no defect") || t.includes("not a product defect")) return "NO_FINDING";
  if (t.includes("rejected") || t.includes("invalid")) return "REJECTED";
  if (t.includes("deferred")) return "DEFERRED";
  if (t.includes("valid") || t.includes("fixed")) return "VALID";
  return "UNKNOWN";
}

export function parseFindings(markdown: string): CalibrationRow[] {
  const headers = markdown.matchAll(
    /^#{2,3} +(IR-\d+(?:\.\.IR-\d+)?(?: *\/ *IR-\d+)?) +[—-] +(.*)$/gm,
  );
  return [...headers].map(([, id, title]) => ({
    id,
    title: title.trim(),
    outcome: outcomeFromHeader(title),
  }));
}

export interface Yield {
  total: number;
  valid: number;
  rejected: number;
  deferred: number;
  noFinding: number;
  unknown: number;
  /** Of findings with a RECORDED outcome, the share that were real defects. */
  confirmedYield: number | null;
  /** Of findings with a recorded outcome, the share that did not survive reproduction. */
  falsePositiveRate: number | null;
  /** How much of the history can be measured at all. The honest denominator. */
  measurableShare: number;
}

export function computeYield(rows: CalibrationRow[]): Yield {
  const count = (outcome: FindingOutcome) => rows.filter((r) => r.outcome === outcome).length;
  const unknown = count("UNKNOWN");
  const measured = rows.length - unknown;
  const valid = count("VALID") + count("DEFERRED");

  return {
    total: rows.length,
    valid: count("VALID"),
    rejected: count("REJECTED"),
    deferred: count("DEFERRED"),
    noFinding: count("NO_FINDING"),
    unknown,
    confirmedYield: measured === 0 ? null : valid / measured,
    falsePositiveRate: measured === 0 ? null : count("REJECTED") / measured,
    measurableShare: rows.length === 0 ? 0 : measured / rows.length,
  };
}

/**
 * How a cluster recurs, which decides what kind of fix can converge on it.
 *
 * The distinction is not cosmetic and the project has one clear instance of each. Reading all
 * recurrence as "the fixes are not working" would be wrong about the more dangerous of the two.
 */
export type RecurrenceType =
  /** Same subsystem keeps breaking. The local fixes are not holding. */
  | "TYPE_A_LOCAL_FIX_FAILING"
  /**
   * Every local fix held, and the same conceptual error appeared somewhere new.
   *
   * Local correctness is high and global invariant coverage is weak, which is the harder problem:
   * nothing is wrong in any of the places that were fixed, so there is nothing to learn by looking
   * at them. Only an invariant spanning all of them can converge.
   */
  | "TYPE_B_INVARIANT_MISSING"
  /** Too few instances or too even a split to call. Says so rather than guessing. */
  | "INDETERMINATE";

export interface ClusterRecurrence {
  category: string;
  instances: number;
  subsystems: number;
  /** subsystems / instances. 1.00 means it has never recurred where it was fixed. */
  spread: number;
  type: RecurrenceType;
}

export function classifyRecurrence(
  entries: { category: string; subsystem: string }[],
): ClusterRecurrence[] {
  const byCategory = new Map<string, Set<string>>();
  const counts = new Map<string, number>();
  for (const entry of entries) {
    byCategory.set(
      entry.category,
      (byCategory.get(entry.category) ?? new Set<string>()).add(entry.subsystem),
    );
    counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([category, instances]) => {
      const subsystems = byCategory.get(category)?.size ?? 0;
      const spread = subsystems / instances;
      // Thresholds stated rather than tuned. Four instances is the fewest that can distinguish a
      // pattern from a coincidence here, and below it the honest answer is that we cannot tell.
      const type: RecurrenceType =
        instances < 4
          ? "INDETERMINATE"
          : spread >= 0.95
            ? "TYPE_B_INVARIANT_MISSING"
            : spread <= 0.7
              ? "TYPE_A_LOCAL_FIX_FAILING"
              : "INDETERMINATE";
      return { category, instances, subsystems, spread, type };
    })
    .sort((a, b) => b.instances - a.instances);
}
