import { describe, expect, it } from "vitest";
import { findRevisionChainTail, selectCurrentObservation } from "@/server/domain/revisionChain";

/**
 * `findRevisionChainTail` decides which value users see in What Changed, Macro Regime, Ask Market
 * and Today. Its whole purpose is to be structural rather than timestamp-ordered, because an
 * original and its revision written in the same millisecond are indistinguishable by clock.
 *
 * These pin the malformed-input contract. The function's docstring promises it throws on a cycle
 * rather than guessing, and until 2026-08-18 it only did so for a cycle that consumed EVERY row —
 * a cycle sitting alongside an intact original went undetected and the superseded original was
 * returned as current. Found by an independent review (`gpt-5.6-terra`) and reproduced here
 * before the fix.
 */

const row = (id: string, revisionOf: string | null = null) => ({ id, revisionOf });

describe("findRevisionChainTail — well-formed chains", () => {
  it("returns null for no rows", () => {
    expect(findRevisionChainTail([])).toBeNull();
  });

  it("returns the only row when there are no revisions", () => {
    expect(findRevisionChainTail([row("a")])?.id).toBe("a");
  });

  it("returns the tail of a linear chain regardless of input order", () => {
    const rows = [row("c", "b"), row("a"), row("b", "a")];
    expect(findRevisionChainTail(rows)?.id).toBe("c");
    expect(findRevisionChainTail([...rows].reverse())?.id).toBe("c");
  });
});

describe("findRevisionChainTail — malformed chains must fail loudly", () => {
  it("throws on a pure cycle where every row is referenced", () => {
    expect(() => findRevisionChainTail([row("a", "b"), row("b", "a")])).toThrow(/cycle|tail/i);
  });

  it("throws on a cycle that hides behind an intact original", () => {
    // The case the earlier implementation missed. `a` and `b` reference each other, so both are
    // in the referenced set and the original `o` is the only unreferenced row — leaving exactly
    // one tail and no error, while `a` and `b` are silently dropped. The user is then shown the
    // ORIGINAL value as current even though two later revisions exist.
    const rows = [row("o"), row("a", "b"), row("b", "a")];
    expect(() => findRevisionChainTail(rows)).toThrow();
  });

  it("throws when a row's parent is not present in the input", () => {
    // A dangling parent means the caller did not pass a whole chain, so any answer is a guess.
    const rows = [row("a"), row("b", "missing-parent")];
    expect(() => findRevisionChainTail(rows)).toThrow();
  });

  it("throws on two disconnected chains for the same date", () => {
    // Two originals for one (seriesId, observationDate) is not a chain with a tail, it is two
    // chains. Picking the first is picking arbitrarily between two competing values.
    const rows = [row("o1"), row("o2")];
    expect(() => findRevisionChainTail(rows)).toThrow();
  });
});

/**
 * IR-131: an unusable vintage is not evidence.
 *
 * Found by adversarial read-only review of the repair rather than by writing it. Without a validity
 * filter an `Invalid Date` makes every comparison in the selection loop NaN, so `latest` never
 * moves and `tied` is never set, and the FIRST row comes back labelled `PROVIDER_VINTAGE` — the
 * provider appearing to have chosen a row it said nothing about. Prisma and Postgres make the shape
 * unlikely, and `selectCurrentObservation` is exported and decides which number a user sees, so it
 * enforces its own precondition instead of inheriting one.
 *
 * These are unit controls on purpose: an invalid Date cannot be stored through the database, so the
 * integration suite cannot construct this. That is exactly the case for testing the pure function
 * directly, and exactly the case where a helper-only control is the RIGHT tool rather than a
 * surrogate for one.
 */
describe("selectCurrentObservation refuses a vintage it cannot use", () => {
  const row = (id: string, revisionOf: string | null, releaseDate: Date | null) => ({
    id,
    revisionOf,
    releaseDate,
  });

  it("treats an Invalid Date as no vintage at all, and so refuses a mixed chain", () => {
    const selection = selectCurrentObservation([
      row("a", null, new Date("not a date")),
      row("b", "a", new Date("2026-02-13T00:00:00.000Z")),
    ]);
    expect(selection?.kind).toBe("UNVERIFIABLE");
    // And specifically NOT the first row wearing the provider's authority.
    expect(selection).not.toMatchObject({ basis: "PROVIDER_VINTAGE" });
  });

  it("falls back to structure when every vintage is unusable", () => {
    // Indistinguishable from a chain that never had vintages, which is the honest reading: nothing
    // usable was supplied, so the structural answer is the only one available.
    const selection = selectCurrentObservation([
      row("a", null, new Date("not a date")),
      row("b", "a", new Date("also not a date")),
    ]);
    expect(selection).toEqual({
      kind: "CURRENT",
      row: row("b", "a", expect.any(Date)),
      basis: "CHAIN_STRUCTURE",
    });
  });

  it("still answers from the provider when every vintage is usable", () => {
    // The positive control, so "refuse everything" cannot satisfy the two above vacuously.
    const older = new Date("2023-02-14T00:00:00.000Z");
    const newer = new Date("2026-02-13T00:00:00.000Z");
    const selection = selectCurrentObservation([row("a", null, newer), row("b", "a", older)]);
    expect(selection).toEqual({
      kind: "CURRENT",
      row: row("a", null, newer),
      basis: "PROVIDER_VINTAGE",
    });
  });
});
