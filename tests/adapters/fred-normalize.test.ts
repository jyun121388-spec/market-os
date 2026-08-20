import { describe, expect, it } from "vitest";
import { normalizeFredObservations } from "@/server/adapters/fred/normalize";
import fixture from "@/server/adapters/fred/__fixtures__/dgs10.json";
import type { FredObservationsResponse } from "@/server/adapters/fred/types";

const response = fixture as FredObservationsResponse;

describe("normalizeFredObservations", () => {
  it('skips missing (".") values instead of coercing them to 0', () => {
    const { observations, skippedMissing } = normalizeFredObservations(response);
    expect(skippedMissing).toHaveLength(1);
    expect(skippedMissing[0].date).toBe("2026-08-12");
    expect(observations.some((o) => o.observationDate.toISOString().startsWith("2026-08-12"))).toBe(
      false,
    );
  });

  it("parses dates as UTC midnight regardless of local timezone", () => {
    const { observations } = normalizeFredObservations(response);
    const first = observations[0];
    expect(first.observationDate.toISOString()).toBe("2026-08-10T00:00:00.000Z");
  });

  it("preserves the exact decimal string value (no float rounding)", () => {
    const { observations } = normalizeFredObservations(response);
    const last = observations[observations.length - 1];
    expect(last.value).toBe("4.25");
  });

  it("retains the raw source payload for auditability", () => {
    const { observations } = normalizeFredObservations(response);
    expect(observations[0].raw).toEqual(response.observations[0]);
  });

  it("throws on a genuinely non-numeric, non-missing value rather than silently dropping it", () => {
    const malformed: FredObservationsResponse = {
      ...response,
      observations: [{ date: "2026-08-10", realtime_start: "x", realtime_end: "y", value: "N/A" }],
    };
    expect(() => normalizeFredObservations(malformed)).toThrow();
  });

  it("P1: throws on an impossible calendar date instead of silently rolling it over", () => {
    const impossibleDay: FredObservationsResponse = {
      ...response,
      observations: [{ date: "2026-02-30", realtime_start: "x", realtime_end: "y", value: "1.23" }],
    };
    expect(() => normalizeFredObservations(impossibleDay)).toThrow(/does not exist/);

    const impossibleMonth: FredObservationsResponse = {
      ...response,
      observations: [{ date: "2026-13-01", realtime_start: "x", realtime_end: "y", value: "1.23" }],
    };
    expect(() => normalizeFredObservations(impossibleMonth)).toThrow(/does not exist/);
  });
});

/**
 * Gate D, RC4-INGEST-1 — `Number.isFinite(Number(raw))` is not a test for "this is a decimal".
 *
 * `Number("0x10")` is 16, and `0b10` and `0o10` read the same way. A hexadecimal value passed this
 * normalizer, was stored by Prisma as 16, and then made the identity comparator throw on the NEXT
 * ingest of the same series — accepted once, fatal the second time, which is the worst of both
 * available behaviours.
 *
 * The adapter is where a value that is not a decimal should stop, and it now validates with the
 * same rule the comparator uses.
 */
describe("values that read as numbers but are not decimals", () => {
  function normalizeOne(value: string) {
    return normalizeFredObservations({
      observation_start: "2026-01-01",
      observation_end: "2026-01-01",
      units: "lin",
      count: 1,
      observations: [{ realtime_start: "", realtime_end: "", date: "2026-01-01", value }],
    } as never);
  }

  it.each(["0x10", "0b10", "0o10", "0xFF"])("rejects %s rather than storing it", (value) => {
    expect(() => normalizeOne(value)).toThrow(/non-decimal FRED value/);
  });

  it("still accepts every decimal spelling a provider legitimately sends", () => {
    for (const value of ["1", "-1", "+1", ".5", "1e5", "1.234567", "0"]) {
      expect(normalizeOne(value).observations, value).toHaveLength(1);
    }
  });
});
