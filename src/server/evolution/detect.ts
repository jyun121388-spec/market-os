import type { LedgerEntry, WeaknessCategory } from "./ledger";

/**
 * Evolution Engine — OBSERVE → MEASURE → DETECT (docs/EVOLUTION_ENGINE.md).
 *
 * This slice stops at detection. It emits `Weakness` rows and nothing else: no hypotheses, no
 * proposals, no experiments, and no path whatsoever to production. The Engine proposes; Governance
 * decides; a human applies.
 *
 * What it is FOR is worth restating, because it is easy to build the useless version. The valuable
 * output is not "the Apple diff bug was fixed" — git already says that. It is "our fixtures
 * systematically under-represented multiple reporting durations within a single filing", which
 * predicts the NEXT defect. In this project it would have: the same fixture blindness that hid the
 * +233% comparison also hid the discarded facts and the single-provider assumption.
 */

export interface Weakness {
  category: WeaknessCategory;
  /** Ledger ids that led here. */
  instances: string[];
  /** Distinct subsystems affected. */
  subsystems: string[];
  /**
   * Whether the cause has shown up in more than one place.
   *
   * Breadth is informative but NOT a requirement — an earlier draft demanded it and a test caught
   * the overreach. Two different concurrency mistakes in one module are still a recurring cause
   * worth naming; they are just weaker evidence that the whole codebase shares it. Recording the
   * distinction lets a reader weigh the cluster instead of the detector deciding for them.
   */
  scope: "SYSTEMIC" | "LOCALISED";
  /** Worst severity among the instances. */
  worstSeverity: "P0" | "P1" | "P2" | "P3";
  /** The lessons themselves, so a reader can judge the cluster rather than trust the label. */
  lessons: string[];
}

const SEVERITY_ORDER = ["P3", "P2", "P1", "P0"] as const;

/**
 * A weakness needs at least this many instances.
 *
 * One occurrence is an incident. The Engine's entire value is noticing repetition, and a
 * "weakness" derived from a single event is just that event with a grander name.
 */
export const MIN_INSTANCES_FOR_WEAKNESS = 2;

/**
 * Clusters ledger entries into systemic weaknesses.
 *
 * Deliberately clusters on the `category` assigned when each entry was WRITTEN, by whoever
 * understood the defect — not by string-matching the summary afterwards. Inferring categories from
 * prose would make the output a property of how entries happen to be worded, and would quietly
 * reward writing summaries that cluster nicely. The judgement belongs at the moment of
 * understanding; this function only counts.
 */
export function detectWeaknesses(entries: LedgerEntry[]): Weakness[] {
  const byCategory = new Map<WeaknessCategory, LedgerEntry[]>();
  for (const entry of entries) {
    const existing = byCategory.get(entry.category);
    if (existing) existing.push(entry);
    else byCategory.set(entry.category, [entry]);
  }

  const weaknesses: Weakness[] = [];
  for (const [category, group] of byCategory) {
    if (group.length < MIN_INSTANCES_FOR_WEAKNESS) continue;
    const subsystems = [...new Set(group.map((e) => e.subsystem))];
    weaknesses.push({
      category,
      instances: group.map((e) => e.id),
      subsystems,
      scope: subsystems.length > 1 ? "SYSTEMIC" : "LOCALISED",
      worstSeverity: group
        .map((e) => e.severity)
        .reduce((worst, s) =>
          SEVERITY_ORDER.indexOf(s) > SEVERITY_ORDER.indexOf(worst) ? s : worst,
        ),
      lessons: group.map((e) => e.lesson),
    });
  }

  // Most instances first — the cluster that has recurred most is the one most likely to recur
  // again, and severity is already visible per row.
  return weaknesses.sort(
    (a, b) => b.instances.length - a.instances.length || a.category.localeCompare(b.category),
  );
}

/** Entries that have not (yet) recurred. Recorded so single events are not silently dropped. */
export function isolatedIncidents(entries: LedgerEntry[]): LedgerEntry[] {
  const counts = new Map<WeaknessCategory, number>();
  for (const entry of entries) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  return entries.filter((e) => (counts.get(e.category) ?? 0) < MIN_INSTANCES_FOR_WEAKNESS);
}
