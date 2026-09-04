import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  summariseReviewFindings,
  summariseReviewFindingsJson,
} from "@/server/release/reviewFindings";

/**
 * The release preflight passed three literal zeros — open P0, open P1, unhandled findings — into
 * the verdict those three numbers decide. These tests exist to make each of them a measurement,
 * and the most important ones are the negatives: every way the register can be unreadable has to
 * come back `null`, because the caller turns `null` into EVIDENCE_INSUFFICIENT and turns a number
 * into a verdict.
 *
 * The real file is read rather than mocked in the first block. A parser that only ever sees
 * fixtures its author wrote agrees with its author.
 */

const SCHEMA = "market-os/review-evidence/1";

function register(findings: unknown[]): unknown {
  return { schema: SCHEMA, gates: [{ gate: "A", findings }] };
}

describe("summariseReviewFindings against the real register", () => {
  const real = JSON.parse(readFileSync("reviews/market-os-final-review.json", "utf8"));
  const summary = summariseReviewFindings(real);

  it("reads it", () => {
    expect(summary).not.toBeNull();
  });

  it("finds nothing unhandled, and that zero is now counted rather than declared", () => {
    expect(summary?.unresolvedP0).toBe(0);
    expect(summary?.unresolvedP1).toBe(0);
    expect(summary?.unhandled).toBe(0);
  });

  it("reports the accepted debt instead of hiding it inside those zeros", () => {
    // Nine findings are deliberately open with a recorded reason. The preflight's constant said
    // zero unhandled, which was true, and said nothing at all about these — so the number that
    // was right and the number that was invisible looked identical.
    expect(summary?.acceptedDebt).toBe(9);
  });

  it("accounts for every finding exactly once", () => {
    expect(summary!.resolved + summary!.acceptedDebt + summary!.unhandled).toBe(summary!.findings);
    expect(summary?.gates).toBe(20);
    expect(summary?.findings).toBe(78);
  });
});

describe("counting", () => {
  it("counts an unhandled P0 as a blocker", () => {
    const summary = summariseReviewFindings(
      register([{ severity: "P0", status: "REPRODUCED_NOT_FIXED" }]),
    );
    expect(summary?.unresolvedP0).toBe(1);
    expect(summary?.unhandled).toBe(1);
  });

  it("counts an unhandled P1 as a blocker", () => {
    const summary = summariseReviewFindings(
      register([{ severity: "P1", status: "FILED_NOT_TRIAGED" }]),
    );
    expect(summary?.unresolvedP1).toBe(1);
  });

  it("keeps P1_AS_FILED at P1, so a rename cannot downgrade one", () => {
    const summary = summariseReviewFindings(
      register([{ severity: "P1_AS_FILED", status: "DISPUTED_UNRESOLVED" }]),
    );
    expect(summary?.unresolvedP1).toBe(1);
  });

  it("does not let an unhandled P2 or P3 masquerade as a release blocker", () => {
    const summary = summariseReviewFindings(
      register([
        { severity: "P2", status: "OPEN_NOT_ADDRESSED" },
        { severity: "P3", status: "OPEN_NOT_ADDRESSED" },
      ]),
    );
    expect(summary?.unhandled).toBe(2);
    expect(summary?.unresolvedP0).toBe(0);
    expect(summary?.unresolvedP1).toBe(0);
  });

  it("keeps a DOCUMENTATION correction out of the code-severity counts", () => {
    const summary = summariseReviewFindings(
      register([{ severity: "DOCUMENTATION", status: "OPEN_NOT_ADDRESSED" }]),
    );
    expect(summary?.unhandled).toBe(1);
    expect(summary?.unresolvedP1).toBe(0);
  });

  it("separates accepted debt from resolved work", () => {
    const summary = summariseReviewFindings(
      register([
        { severity: "P1", status: "REPRODUCED_AND_FIXED" },
        { severity: "P1", status: "REPRODUCED_ACCEPTED_AND_PINNED" },
      ]),
    );
    expect(summary?.resolved).toBe(1);
    expect(summary?.acceptedDebt).toBe(1);
    // Accepted debt is open risk and is NOT unresolved work. The authorised stop rule says a
    // reviewer need not return zero comments; it does not say the comments stop existing.
    expect(summary?.unresolvedP1).toBe(0);
  });

  it("reads a register with no findings as zero rather than as unreadable", () => {
    const summary = summariseReviewFindings(register([]));
    expect(summary?.findings).toBe(0);
    expect(summary?.unhandled).toBe(0);
  });
});

describe("unreadable is not clean", () => {
  const unreadable: [string, unknown][] = [
    ["a status nobody has classified", register([{ severity: "P1", status: "PROBABLY_FINE" }])],
    ["a severity nobody has classified", register([{ severity: "SEV1", status: "CORRECTED" }])],
    ["a finding with no status", register([{ severity: "P1" }])],
    ["a finding with no severity", register([{ status: "CORRECTED" }])],
    ["a non-string status", register([{ severity: "P1", status: 3 }])],
    ["a finding that is not an object", register(["RC-007-20 fixed"])],
    ["a gate whose findings key is absent", { schema: SCHEMA, gates: [{ gate: "A" }] }],
    ["a gate whose findings are not a list", { schema: SCHEMA, gates: [{ findings: {} }] }],
    ["a gate that is not an object", { schema: SCHEMA, gates: ["A"] }],
    ["gates that are not a list", { schema: SCHEMA, gates: { A: {} } }],
    ["a schema this does not know", { schema: "market-os/review-evidence/2", gates: [] }],
    ["no schema at all", { gates: [] }],
    ["an array where the record should be", []],
    ["null", null],
    ["a string", "no findings"],
  ];

  for (const [label, input] of unreadable) {
    it(`returns null for ${label}`, () => {
      expect(summariseReviewFindings(input)).toBeNull();
    });
  }

  it("returns null for text that is not JSON", () => {
    expect(summariseReviewFindingsJson("{ not json")).toBeNull();
  });

  it("nulls the whole summary, rather than skipping the finding it could not read", () => {
    // Skipping would be the dangerous repair: twelve readable findings and one unreadable one
    // would report twelve, and the report would look complete. The one that could not be read is
    // exactly the one nobody has decided anything about.
    const mixed = register([
      { severity: "P1", status: "REPRODUCED_AND_FIXED" },
      { severity: "P0", status: "SOMETHING_NEW" },
    ]);
    expect(summariseReviewFindings(mixed)).toBeNull();
  });

  it("parses the real file from text as well as from an object", () => {
    const fromText = summariseReviewFindingsJson(
      readFileSync("reviews/market-os-final-review.json", "utf8"),
    );
    expect(fromText?.findings).toBe(78);
  });
});
