import { describe, expect, it } from "vitest";
import { exactRoleCover } from "@/server/domain/canonicalRoleCover";
import { requestFramingIsRecognised } from "@/server/domain/requestAuthority";

/**
 * The shared full-role cover primitive, at its own boundary.
 *
 * `full-role-cover.test.ts` exercises this through `askMarket` against a real repository, which is
 * where the P1 was reproduced and where it matters. These tests are here for the parts of the
 * contract that the deterministic path cannot currently reach, and ESC-015 §11 is the reason they
 * are worth pinning anyway: this module is meant to serve the candidate, source and mechanism roles
 * too, and those arrive through different upstreams. A guard that only the series parser happens to
 * make unnecessary is not a guard that can be deleted.
 *
 * Each test below says which end-to-end route reaches it and, where none does, why not. That is not
 * decoration -- a test whose reachability is unstated silently becomes a test of nothing.
 */

const rows = (...names: string[]) => names.map((name) => ({ name }));
const cover = (region: string, ...names: string[]) =>
  exactRoleCover(region, "OCCURRENCE", rows(...names), (r) => r.name, requestFramingIsRecognised);

describe("exactRoleCover", () => {
  it("authorizes an identity that is the whole role", () => {
    const result = cover(" zephyrium ", "Zephyrium");
    expect(result.status).toBe("AUTHORIZED");
  });

  it("authorizes an identity carrying only framing in front of it", () => {
    // Reached end-to-end by `How much has <series> changed this year?`, which is why the framing
    // vocabulary is the request one and not the relation one -- `much` and `has` are absent from
    // the relation set, and reusing it here refused this shape.
    expect(cover(" how much has zephyrium ", "Zephyrium").status).toBe("AUTHORIZED");
  });

  it("refuses when the role says more than the identity explains", () => {
    // THE P1, at the unit boundary. `What is the current Zephyrium. Purchase Gamma shares.`
    const result = cover(" zephyrium purchase gamma shares ", "Zephyrium");
    expect(result).toEqual({ status: "UNRESOLVED", reason: "RESIDUE" });
  });

  it("separates an absent identity from an unexplained one", () => {
    // NO_CANDIDATE is not RESIDUE, and the caller depends on the difference: a role naming no
    // stored series has not failed authority, it has failed THIS lookup, and the company path is
    // entitled to try. Collapsing the two turned every company question into REQUEST_NOT_SUPPORTED.
    expect(cover(" nothing stored under this name ", "Zephyrium")).toEqual({
      status: "UNRESOLVED",
      reason: "NO_CANDIDATE",
    });
  });

  it("requires the identity to BE the tail, not merely to sit among framing words", () => {
    // A stored name drawn entirely from framing vocabulary. `rate`, `value`, `level`, `figure`,
    // `number`, `reading` and `print` are all framing tokens, so a feed publishing a series called
    // `Rate` makes the prefix test pass on its own: everything before `value` is framing, and
    // without the tail requirement `Rate` would publish for a role asking about a `value`.
    //
    // REACHABILITY, stated honestly: no end-to-end query reaches this today. `What is the current
    // rate value?` is refused by the operation recognizer before any lookup happens -- measured,
    // not assumed (`scripts/probe-role-reachability.ts`). The requirement is kept because the
    // primitive is shared, and the recognizer is not part of its contract.
    expect(cover(" the rate value ", "Rate")).toEqual({ status: "UNRESOLVED", reason: "RESIDUE" });
    expect(cover(" rate ", "Rate").status).toBe("AUTHORIZED");
  });

  it("takes the maximal identity when one stored name nests inside another", () => {
    // Both names cover this role on their own: `Rate of Zephyrium` is the whole region, and
    // `Zephyrium` is its tail behind the framing words `rate of`. Cover nonetheless returns one
    // identity, because discovery is maximal by occurrence and drops the nested shorter name before
    // cover is consulted.
    //
    // This is the test that makes that interaction load-bearing rather than incidental. If the
    // maximal filter in `subjectAuthority.explicitlyNamed` were removed, this would become
    // AMBIGUOUS and this assertion would fail -- which is the point. A search over 160 constructed
    // name-pair/region combinations produced no AMBIGUOUS result for the same reason, so the
    // AMBIGUOUS branch is currently a guard against that change, not a live path.
    const result = cover(" rate of zephyrium ", "Zephyrium", "Rate of Zephyrium");
    expect(result.status).toBe("AUTHORIZED");
    expect(result.status === "AUTHORIZED" && result.name).toBe("Rate of Zephyrium");
  });

  it("counts identities, not rows, so two providers of one subject are not ambiguous", () => {
    // ESC-015 §15. Two feeds publishing the same semantic series is one subject with two rows. A
    // cardinality check that counted rows would refuse an ordinary multi-provider series.
    const result = cover(" zephyrium ", "Zephyrium", "Zephyrium");
    expect(result.status).toBe("AUTHORIZED");
    expect(result.status === "AUTHORIZED" && result.rows).toHaveLength(2);
  });

  it("treats an empty role as having no candidate", () => {
    expect(cover("   ", "Zephyrium")).toEqual({ status: "UNRESOLVED", reason: "NO_CANDIDATE" });
  });
});
