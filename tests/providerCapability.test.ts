import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_AXES,
  PROVIDER_CAPABILITIES,
  capabilityOf,
  classifyEvidenceGap,
} from "@/server/fabric/providerCapability";
import { verify } from "@/server/verify/evaluate";
import type { VerificationInput } from "@/server/verify/types";

/**
 * The capability matrix, held to the rule that gives it any value.
 *
 * A matrix assembled from documentation is a restatement of the documentation, and this project
 * has already paid for believing one: `fy` was declared non-nullable and arrives null, the filing
 * list was complete and was 1000 of 2240. The tests below are almost entirely about PROVENANCE
 * rather than content — what a cell is allowed to claim given how the claim was obtained.
 */

describe("what a capability cell is allowed to claim", () => {
  /**
   * The central invariant, and the one worth stating in both directions.
   *
   * SUPPORTED from a document is the mistake everyone expects. NOT_SUPPORTED from a document is
   * the same mistake and is worse in effect, because it closes the question instead of opening
   * it: a provider we have never called cannot be said to withhold anything.
   */
  it("only a live response can establish that a provider does, or does not, supply something", () => {
    for (const profile of PROVIDER_CAPABILITIES) {
      for (const axis of CAPABILITY_AXES) {
        const cell = profile.axes[axis];
        if (cell.state === "SUPPORTED" || cell.state === "NOT_SUPPORTED") {
          expect(
            cell.provenance,
            `${profile.sourceCode}.${axis} claims ${cell.state} without a live response`,
          ).toBe("LIVE_RESPONSE");
        }
      }
    }
  });

  it("every cell says how it knows", () => {
    for (const profile of PROVIDER_CAPABILITIES) {
      for (const axis of CAPABILITY_AXES) {
        expect(profile.axes[axis].basis.length, `${profile.sourceCode}.${axis}`).toBeGreaterThan(
          20,
        );
      }
    }
  });

  /**
   * Verification debt with no owner is not debt, it is a shrug. Every NOT_VERIFIED must name the
   * gate that would clear it, so the matrix doubles as a work list rather than a list of regrets.
   *
   * PRESENCE is no longer this test's job and must not be added back: `CapabilityEvidence` is a
   * discriminated union in which `NOT_VERIFIED` requires `blockedBy` and every other state forbids
   * it, so a cell without a gate does not compile. What is left here is the SHAPE, which the type
   * cannot check.
   */
  it("names the gate behind every unverified capability", () => {
    for (const profile of PROVIDER_CAPABILITIES) {
      for (const axis of CAPABILITY_AXES) {
        const cell = profile.axes[axis];
        if (cell.state === "NOT_VERIFIED") {
          expect(cell.blockedBy, `${profile.sourceCode}.${axis}`).toMatch(/^HG-\d+$/);
        }
      }
    }
  });

  /**
   * And the gate has to be a gate that EXISTS.
   *
   * A well-shaped id is not an owner. `HG-999` passes the shape test above, names nothing, and
   * turns a work list back into the list of regrets the previous test exists to prevent — the same
   * failure as an unowned cell, wearing the format that was supposed to rule it out. The gate
   * register is `docs/HUMAN_GATE_QUEUE.md`, so that is what the cell is checked against rather
   * than against a second copy of the ids kept here.
   */
  it("every gate a cell names is a gate the human-gate queue actually carries", () => {
    const register = readFileSync("docs/HUMAN_GATE_QUEUE.md", "utf8");
    const documented = new Set(register.match(/\bHG-\d{3}\b/g) ?? []);
    expect(documented.size, "no gate ids found in docs/HUMAN_GATE_QUEUE.md").toBeGreaterThan(0);
    for (const profile of PROVIDER_CAPABILITIES) {
      for (const axis of CAPABILITY_AXES) {
        const cell = profile.axes[axis];
        if (cell.state !== "NOT_VERIFIED") continue;
        expect(
          documented.has(cell.blockedBy),
          `${profile.sourceCode}.${axis} names ${cell.blockedBy}, which HUMAN_GATE_QUEUE.md does not carry`,
        ).toBe(true);
      }
    }
  });

  it("covers every axis for every provider, so a gap cannot hide as an absent row", () => {
    expect(CAPABILITY_AXES.length).toBe(14);
    for (const profile of PROVIDER_CAPABILITIES) {
      for (const axis of CAPABILITY_AXES) {
        expect(profile.axes[axis], `${profile.sourceCode} is missing ${axis}`).toBeDefined();
      }
    }
  });
});

describe("what the matrix currently says", () => {
  /**
   * The state of the world as of 2026-08-18, asserted so that a change to it has to be deliberate.
   * Three of four providers have never returned a success response, and no amount of adapter code
   * changes that.
   */
  it("records that only SEC EDGAR has ever been observed returning data", () => {
    for (const profile of PROVIDER_CAPABILITIES) {
      const liveAxes = CAPABILITY_AXES.filter(
        (axis) => profile.axes[axis].provenance === "LIVE_RESPONSE",
      );
      if (profile.sourceCode === "SEC_EDGAR") {
        expect(liveAxes.length).toBe(CAPABILITY_AXES.length);
      } else {
        expect(liveAxes, `${profile.sourceCode} claims live evidence`).toEqual([]);
      }
    }
  });

  it("keeps FRED's realtime_start honest", () => {
    // The most tempting cell in the matrix: exactly the field the vintage contract needs, already
    // declared in fred/types.ts, and never seen in a real response.
    const cell = capabilityOf("FRED", "provider_vintage_time");
    expect(cell?.state).toBe("NOT_VERIFIED");
    expect(cell?.field).toBe("observations[].realtime_start");
    expect(cell?.blockedBy).toBe("HG-002");
  });

  it("distinguishes what SEC can count from what it cannot", () => {
    // Filings are countable because each overflow file states its filingCount. Facts are not,
    // because companyfacts publishes no total - so completeness there is permanently
    // unconfirmable rather than merely unconfirmed, and that is a different claim.
    expect(capabilityOf("SEC_EDGAR", "total_count_evidence")?.state).toBe("CONDITIONAL");
    expect(capabilityOf("SEC_EDGAR", "pagination_evidence")?.state).toBe("SUPPORTED");
  });
});

describe("classifying why a piece of evidence is missing", () => {
  /**
   * The three-way distinction the matrix exists to make possible. At the point of use all three
   * look identical - a field is absent - and they call for opposite responses.
   */
  it("a provider that does not publish it is a structural limitation", () => {
    const gap = classifyEvidenceGap("SEC_EDGAR", "provider_vintage_time", false);
    expect(gap.kind).toBe("STRUCTURAL_LIMITATION");
    expect(gap.blockedBy).toBeUndefined();
  });

  it("a provider we have never called is verification debt, with an owner", () => {
    const gap = classifyEvidenceGap("FRED", "provider_vintage_time", false);
    expect(gap.kind).toBe("VERIFICATION_DEBT");
    expect(gap.blockedBy).toBe("HG-002");
  });

  it("a provider that does publish it makes the absence a property of the record", () => {
    const gap = classifyEvidenceGap("SEC_EDGAR", "provider_revision_identity", false);
    expect(gap.kind).toBe("DATA_QUALITY_ISSUE");
  });

  it("a conditional capability is neither a limitation nor a defect", () => {
    // 912 of 1431 stored facts carry a period start and 519 do not, because instants have none.
    // Reporting that as a data-quality issue would raise 519 false alarms.
    expect(classifyEvidenceGap("SEC_EDGAR", "period_start", false).kind).toBe(
      "CONDITIONAL_ABSENCE",
    );
  });

  it("says it does not know rather than guessing for an unprofiled provider", () => {
    const gap = classifyEvidenceGap("BLOOMBERG", "provider_vintage_time", false);
    expect(gap.kind).toBe("CAPABILITY_UNKNOWN");
  });

  it("reports no gap when the record has the evidence", () => {
    expect(classifyEvidenceGap("FRED", "provider_vintage_time", true).kind).toBe("NO_GAP");
  });

  it("always explains itself", () => {
    for (const profile of PROVIDER_CAPABILITIES) {
      for (const axis of CAPABILITY_AXES) {
        const gap = classifyEvidenceGap(profile.sourceCode, axis, false);
        expect(gap.rationale.length, `${profile.sourceCode}.${axis}`).toBeGreaterThan(20);
      }
    }
  });
});

describe("Verify reading the capability matrix", () => {
  const macroFact = (sourceCode: string): VerificationInput => ({
    outputId: `observation:${sourceCode}:X`,
    claimType: "FACT",
    sourceCodes: [sourceCode],
    completeness: { providerTotal: null, fetched: 12, truncated: false },
  });

  /**
   * The reason the matrix is wired into Verify at all. Both outputs below lack a provider vintage
   * and both are INSUFFICIENT_EVIDENCE, and they mean opposite things: one is the ceiling of what
   * SEC can ever supply, the other is a call we have not made.
   */
  it("separates a permanent provider limitation from work nobody has done", () => {
    const fred = verify(macroFact("FRED"));
    expect(fred.dimensions.revision_integrity.evidenceGap).toBe("VERIFICATION_DEBT");
    expect(fred.dimensions.revision_integrity.rationale).toContain("HG-002");

    // SEC reaches revision_integrity only without an accession; a bare FACT is that case, and the
    // gap is structural because SEC publishes no per-figure vintage and never will.
    const sec = verify(macroFact("SEC_EDGAR"));
    expect(sec.dimensions.revision_integrity.evidenceGap).toBe("STRUCTURAL_LIMITATION");
    expect(sec.dimensions.revision_integrity.rationale).not.toContain("HG-");
  });

  it("explains a missing total differently for each provider", () => {
    expect(verify(macroFact("FRED")).dimensions.data_completeness.evidenceGap).toBe(
      "VERIFICATION_DEBT",
    );
    expect(verify(macroFact("SEC_EDGAR")).dimensions.data_completeness.evidenceGap).toBe(
      "CONDITIONAL_ABSENCE",
    );
  });

  /**
   * The matrix describes one provider. Consulting it about an output assembled from two would
   * answer a question nobody asked, and would present a single provider's limitation as though it
   * covered both — the cross-provider conflation IR-001 and IR-002 were about.
   */
  it("declines to explain a gap for an output built from more than one source", () => {
    const mixed = verify({
      outputId: "mixed",
      claimType: "FACT",
      sourceCodes: ["FRED", "ECOS"],
      completeness: { providerTotal: null, fetched: 12, truncated: false },
    });
    expect(mixed.dimensions.revision_integrity.evidenceGap).toBeUndefined();
    expect(mixed.dimensions.data_completeness.evidenceGap).toBeUndefined();
  });

  it("says it cannot explain a provider it has no profile for", () => {
    expect(
      verify(macroFact("TEST_CALENDAR_SOURCE")).dimensions.revision_integrity.evidenceGap,
    ).toBe("CAPABILITY_UNKNOWN");
  });
});
