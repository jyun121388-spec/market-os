import { prisma } from "@/server/db/client";
import { selectCurrentObservation } from "@/server/domain/revisionChain";
import type { Observation } from "@/generated/prisma/client";

export interface ObservationPair {
  current: Observation;
  previous: Observation;
}

/**
 * Shared read logic for "the two most recent distinct observation dates for a series, respecting
 * revisions" — used by whatChanged.ts (M10), macroRegime.ts (M11) and askMarket.ts (M21).
 *
 * This decides which number a user is shown, so picking the wrong row within a date means
 * displaying a superseded value as if it were current.
 *
 * It used to do that. The query was
 * `orderBy: [{ observationDate: "desc" }, { retrievedAt: "desc" }], distinct: ["observationDate"]`,
 * on the theory that the most recently retrieved value for a date wins. `retrievedAt` is a
 * `timestamp(3)`, so an original and its revision written in the same millisecond are
 * indistinguishable and Postgres may return either first — after which `distinct` keeps whichever
 * happened to come first. Ingesting a revision right after its original is the normal path, so
 * this was not a rare edge case, and the wrong answer was non-deterministic rather than
 * consistently wrong. Found on 2026-08-17 as the read-path twin of the same bug in the ingest.
 *
 * Now resolved structurally: take the two most recent distinct dates, then pick each date's
 * revision-chain tail (see revisionChain.ts). Independent of timestamp resolution.
 */
export async function getRecentObservationPair(seriesId: string): Promise<ObservationPair | null> {
  const recentDates = await prisma.observation.findMany({
    where: { seriesId },
    // ORDERING_WAIVER: distinct on observationDate and ordered by the same column, so the two rows returned differ on the ordering key by construction. Which ROW wins within a date is decided structurally afterwards, by walking the revision chain.
    orderBy: { observationDate: "desc" },
    distinct: ["observationDate"],
    select: { observationDate: true },
    take: 2,
  });

  if (recentDates.length < 2) {
    return null;
  }

  const rows = await prisma.observation.findMany({
    where: { seriesId, observationDate: { in: recentDates.map((d) => d.observationDate) } },
    // Only a tiebreaker for a chain that should be impossible (see revisionChain.ts) — keeps a
    // malformed chain answering the same way twice instead of flickering between requests.
    orderBy: [{ retrievedAt: "desc" }, { id: "desc" }],
  });

  // `selectCurrentObservation` throws on a malformed chain, which is right — refusing to guess
  // which value is current beats presenting a superseded one. But the THROW must not escape this
  // function. Every caller loops over many series, and an uncaught error here takes down Morning
  // Brief, Macro Regime and Ask Market in their entirety over one corrupt row: a whole page lost
  // to a defect in a single series (independent review, `gpt-5.6-terra`, 2026-08-18).
  //
  // Degrading to "no reading for this series" is what every caller already handles, since that is
  // what a series with too little history returns. The error is logged rather than swallowed, so
  // an operator can still see that something is structurally wrong — silence here would trade one
  // failure mode for the quieter one this project keeps finding.
  //
  // IR-131 adds a second way to get nothing back, and it lands in the same place on purpose: a
  // chain the provider's own vintages cannot order is UNVERIFIABLE, and an unverifiable current
  // value is exactly as unusable as a malformed one. It is logged distinctly, because the two have
  // different causes and only one of them is corruption.
  const forDate = (date: Date) => {
    const chain = rows.filter((r) => r.observationDate.getTime() === date.getTime());
    try {
      const selection = selectCurrentObservation(chain);
      if (selection === null) return null;
      if (selection.kind === "UNVERIFIABLE") {
        console.error(
          `[seriesReadings] series ${seriesId} cannot prove which value is current on ` +
            `${date.toISOString().slice(0, 10)}; treating the series as unreadable rather than ` +
            `serving a value that may be superseded: ${selection.because}`,
        );
        return null;
      }
      return selection.row;
    } catch (error) {
      console.error(
        `[seriesReadings] series ${seriesId} has a malformed revision chain on ` +
          `${date.toISOString().slice(0, 10)}; treating the series as unreadable rather than ` +
          `failing the whole request: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  };

  const current = forDate(recentDates[0].observationDate);
  const previous = forDate(recentDates[1].observationDate);
  if (!current || !previous) {
    return null;
  }

  return { current, previous };
}

/**
 * Every observation date for a series, oldest first, with exactly one row per date: the current
 * value, resolved through the revision chain.
 *
 * The natural-looking query for this is
 * `orderBy: [{ observationDate: "asc" }, { retrievedAt: "desc" }], distinct: ["observationDate"]`,
 * and it is wrong for the reason described in revisionChain.ts — `retrievedAt` is a
 * `timestamp(3)`, so it cannot separate an original from a revision written in the same
 * millisecond. Both `economicCalendar.ts` and `historicalAnalog.ts` had written that query
 * independently, and both display or compute on the resulting VALUE, so both could have used a
 * superseded number.
 *
 * Exists so there is one correct way to ask this question, rather than three call sites each
 * getting it subtly wrong in their own file.
 */
/**
 * A series' history, WITH the dates this repository declined to answer about.
 *
 * IR-133. `getObservationsOneRowPerDate` omits a date whose current value cannot be proven, and
 * omitting is right — the alternative is serving a superseded number. But the omission leaves no
 * trace in the array, and a consumer that reads array positions as periods then treats the two
 * dates either side of the hole as adjacent. Measured through the real consumers on 2026-09-08:
 * `historicalAnalog` reported `subsequentChange3 = 4` and `subsequentChange6 = 7` on a ramp whose
 * every one-period step is exactly 1.
 *
 * The knowledge that a date was refused exists HERE and nowhere downstream, so this is the lowest
 * boundary that can hand it on. It is offered rather than imposed: `unresolvedDates` is evidence a
 * consumer may use to refuse, not an instruction, and consumers that read dates rather than
 * positions need nothing from it.
 *
 * `unresolvedDates` carries ONLY dates that are stored and unprovable. A date the provider never
 * published is simply absent and appears nowhere here — that distinction is the reason an
 * irregular series is not penalised for being irregular.
 */
export interface ObservationHistory {
  /** One row per answerable date, oldest first. Exactly what `getObservationsOneRowPerDate` returns. */
  rows: Observation[];
  /** Dates that ARE stored but whose current value could not be proven, so they were withheld. */
  unresolvedDates: Date[];
}

export async function getObservationHistory(seriesId: string): Promise<ObservationHistory> {
  const rows = await prisma.observation.findMany({
    where: { seriesId },
    // Deterministic tiebreak only, for a forked chain that should be impossible.
    orderBy: [{ observationDate: "asc" }, { retrievedAt: "desc" }, { id: "desc" }],
  });

  const byDate = new Map<number, Observation[]>();
  for (const row of rows) {
    const key = row.observationDate.getTime();
    const bucket = byDate.get(key);
    if (bucket) bucket.push(row);
    else byDate.set(key, [row]);
  }

  // Same containment as above, and here it matters more: this builds a full history, so one
  // malformed date would otherwise discard every other date in the series as well. Skipping the
  // affected date loses one point instead of all of them.
  const resolved: Observation[] = [];
  const unresolvedDates: Date[] = [];
  for (const [dateKey, bucket] of byDate) {
    try {
      const selection = selectCurrentObservation(bucket);
      if (selection === null) continue;
      if (selection.kind === "UNVERIFIABLE") {
        // IR-131: omitting the date is the same degradation a malformed chain already produced,
        // and it is the honest one. A history point whose current value cannot be proven would
        // otherwise be plotted and compared against as though it were settled.
        //
        // IR-133 records WHICH date, because the omission is invisible in the array and a consumer
        // reading positions as periods would otherwise span it silently.
        unresolvedDates.push(new Date(dateKey));
        console.error(
          `[seriesReadings] series ${seriesId} cannot prove which value is current on ` +
            `${new Date(dateKey).toISOString().slice(0, 10)}; omitting that date from the ` +
            `history: ${selection.because}`,
        );
        continue;
      }
      resolved.push(selection.row);
    } catch (error) {
      // A malformed chain is also a stored date this repository cannot answer about, so it is
      // recorded the same way. The CAUSE differs and is logged differently; the consequence for a
      // consumer counting periods is identical.
      unresolvedDates.push(new Date(dateKey));
      console.error(
        `[seriesReadings] series ${seriesId} has a malformed revision chain on ` +
          `${new Date(dateKey).toISOString().slice(0, 10)}; omitting that date from the history: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    rows: resolved.sort((a, b) => a.observationDate.getTime() - b.observationDate.getTime()),
    unresolvedDates: unresolvedDates.sort((a, b) => a.getTime() - b.getTime()),
  };
}

/**
 * One row per answerable date, oldest first.
 *
 * The long-standing shape, kept exactly as it was so every date-reading consumer is untouched. A
 * consumer that counts PERIODS wants `getObservationHistory` instead — see IR-133 for why the
 * difference matters.
 */
export async function getObservationsOneRowPerDate(seriesId: string): Promise<Observation[]> {
  return (await getObservationHistory(seriesId)).rows;
}

export interface DeterministicChange {
  absoluteChange: number;
  percentChange: number | null; // null when previous value is 0 (percent change undefined)
  bpsChange: number | null; // only meaningful when unit === "percent"
}

/** Pure, deterministic change calculation — no DB access, no LLM. */
export function computeChange(pair: ObservationPair, unit: string): DeterministicChange {
  const currentValue = Number(pair.current.value.toString());
  const previousValue = Number(pair.previous.value.toString());

  const absoluteChange = round(currentValue - previousValue, 6);
  const percentChange =
    previousValue === 0 ? null : round((absoluteChange / previousValue) * 100, 4);
  const bpsChange = unit === "percent" ? round(absoluteChange * 100, 2) : null;

  return { absoluteChange, percentChange, bpsChange };
}

export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
