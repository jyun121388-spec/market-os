import { describe, expect, it } from "vitest";
import { auditOrderReach } from "../scripts/order-reaches-output";
import { auditPresentationOrder } from "../scripts/presentation-order";

/**
 * A RATCHET, because four audits that nobody runs describe a codebase rather than protecting it.
 *
 * `recency-audit`, `recency-cardinality`, `presentation-order` and `order-reaches-output` are
 * invoked by nothing — not `package.json`, not CI. Their findings are pinned only at named anchor
 * sites, so a `findMany` added tomorrow with no `orderBy` fails nothing at all. Every one of those
 * audits found something real, and none of them would notice the same thing arriving again.
 *
 * ## WHY A CEILING RATHER THAN AN INVENTORY
 *
 * A list of known-bad sites is a hand-maintained parallel copy, which is the shape this project
 * keeps paying for. A ceiling is one DERIVED number: it cannot drift out of step with the code
 * because it is recomputed on every run, and the only way to pass is to be no worse than the day
 * it was written.
 *
 * ## WHY `<=` AND NOT `===`
 *
 * Equality would fail the moment somebody FIXED one of these, which is a test that punishes
 * improvement. Under `<=`, a fix passes — and then the ceiling should be LOWERED in the same
 * commit, so the ground gained is held. That is the whole point of a ratchet and it is the one
 * thing a reader of this file has to remember.
 *
 * ## WHAT THIS IS NOT
 *
 * It is not a claim that the current counts are acceptable. They are recorded debt: the
 * `findSeriesFactors` ordering is IR-113 and stays P2 under the V1 freeze, and the other sites are
 * reported rather than judged. The ratchet says only "no worse than this", which is a different
 * and much weaker statement than "this is fine".
 */

/**
 * Measured 2026-09-01 at `68c81e8`. LOWER THESE when a site is fixed; never raise them without
 * saying why in the commit that does it.
 */
const CEILING = {
  /** `findMany` with no `orderBy` at all — the sequence is whatever the database returned. */
  noOrder: 21,
  /** Non-total-order sites whose nondeterminism demonstrably reaches a caller. */
  orderSurvives: 16,
};

describe("the order ratchet", () => {
  const sites = auditPresentationOrder();
  const reach = auditOrderReach();

  it("does not add a findMany with no ordering at all", () => {
    const noOrder = sites.filter((s) => s.determinism === "NO_ORDER");
    expect(
      noOrder.length,
      `${noOrder.length} findMany sites have no \`orderBy\`; the ceiling is ${CEILING.noOrder}. ` +
        "A new one means an added query whose row order is whatever Postgres returned. Give it a " +
        "deterministic order, or raise this ceiling deliberately and say why.\n" +
        noOrder.map((s) => `  ${s.file}:${s.line} ${s.enclosing}()`).join("\n"),
    ).toBeLessThanOrEqual(CEILING.noOrder);
  });

  it("does not add a nondeterministic order that reaches a caller", () => {
    const survives = reach.filter((r) => r.reach === "ORDER_SURVIVES");
    expect(
      survives.length,
      `${survives.length} non-total-order sites let arrival order reach a caller; the ceiling is ` +
        `${CEILING.orderSurvives}.\n` +
        survives.map((r) => `  ${r.file}:${r.line} ${r.enclosing}()`).join("\n"),
    ).toBeLessThanOrEqual(CEILING.orderSurvives);
  });

  /**
   * The ceiling must stay reachable evidence, not a number someone typed.
   *
   * If the audit ever returns nothing — a broken program load, a moved source root, a checker that
   * was not created — every ceiling above passes vacuously and the ratchet silently stops
   * ratcheting. That is the same silent-zero this project has been bitten by more than once, so it
   * is asserted rather than assumed.
   */
  it("is measuring something, so an empty audit cannot satisfy it", () => {
    expect(sites.length).toBeGreaterThan(30);
    expect(reach.length).toBeGreaterThan(20);
    expect(new Set(sites.map((s) => s.determinism)).size).toBeGreaterThan(1);
  });
});
