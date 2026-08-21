import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `IngestRun.target` is a join key that five scripts write and one reader parses, and nothing
 * connects them.
 *
 * From the `IDENTITY_MODELLING` enumeration the scheduler ranked first. The orderings pass was the
 * first half; this is the join half, and the join it found is the one with no shared constructor.
 *
 * Each ingest script builds the target with its own string literal:
 *
 *     edgar        padCik(company.cik)
 *     edgar-xbrl   `xbrl:${padCik(company.cik)}`
 *     dart         company.corpCode
 *     ecos         `${series.statCode}:${series.itemCode1}`
 *     fred         series.seriesId
 *
 * and `assessCompleteness` reconstructs two of those five to find a company's runs:
 * `target: { in: [corpCode, "xbrl:" + corpCode] }`.
 *
 * It works today — 37 Apple runs resolve, 19 filings and 18 XBRL. It works because five separate
 * literals happen to agree with one reader's guess about two of them, which is exactly the shape of
 * `RF-02`: a join key written in display form on one side and storage form on the other, costing a
 * completeness lookup that returned UNKNOWN forever and looked like missing data rather than a
 * mismatched key.
 *
 * Under the freeze the right move is not to refactor five scripts. It is to make the convention
 * CHECKED, so a sixth script with a new shape, or a change to an existing one, fails here instead
 * of silently detaching a page from its evidence.
 */

const SCRIPTS_DIR = join(process.cwd(), "scripts");

/** The shapes an ingest target is allowed to take, and who writes each. */
const KNOWN_TARGET_SHAPES: { script: string; expression: string; note: string }[] = [
  {
    script: "ingest-edgar.ts",
    expression: "target: padCik(company.cik)",
    note: "padded CIK — the canonical form, matching Filing.corpCode",
  },
  {
    script: "ingest-edgar-xbrl.ts",
    expression: "target: `xbrl:${padCik(company.cik)}`",
    note: "the same padded CIK behind an `xbrl:` prefix, so the two EDGAR ingests are distinct runs",
  },
  {
    script: "ingest-dart.ts",
    expression: "target: company.corpCode",
    note: "DART's own corp_code, already the form stored on Filing.corpCode",
  },
  {
    script: "ingest-ecos.ts",
    expression: "target: `${series.statCode}:${series.itemCode1}`",
    note: "a series identity, not a company — no completeness reader consumes it",
  },
  {
    script: "ingest-fred.ts",
    expression: "target: series.seriesId",
    note: "a series identity, not a company — no completeness reader consumes it",
  },
];

/** Normalised so an added line break or a changed quote style is not reported as a drift. */
const squash = (text: string) => text.replace(/\s+/g, " ").replace(/"/g, "`").trim();

function targetExpressionIn(script: string): string | null {
  const source = readFileSync(join(SCRIPTS_DIR, script), "utf8");
  const match = /target:\s*(`[^`]*`|[A-Za-z0-9_.()]+)/.exec(source);
  return match ? squash(`target: ${match[1]}`) : null;
}

describe("the IngestRun.target convention", () => {
  it("has an entry for every ingest script, so a new one cannot slip in unrecorded", () => {
    const scripts = readdirSync(SCRIPTS_DIR).filter((n) => /^ingest-.*\.ts$/.test(n));
    expect(scripts.sort()).toEqual(KNOWN_TARGET_SHAPES.map((s) => s.script).sort());
  });

  it("still writes the shape each script is recorded as writing", () => {
    for (const shape of KNOWN_TARGET_SHAPES) {
      expect(targetExpressionIn(shape.script), `${shape.script} — ${shape.note}`).toBe(
        squash(shape.expression),
      );
    }
  });

  /**
   * The half that actually bites. `assessCompleteness` reconstructs the EDGAR target forms to find
   * a company's runs, and if either side changes independently the lookup returns nothing — which
   * renders as "no run recorded" rather than as a broken join, so the page reports honestly about
   * the wrong thing.
   */
  it("is reconstructed by the completeness reader in exactly the forms EDGAR writes", () => {
    const reader = readFileSync(join(process.cwd(), "src/server/domain/companyXray.ts"), "utf8");
    const lookup = /target:\s*\{\s*in:\s*\[([^\]]+)\]/.exec(reader);
    expect(
      lookup,
      "the completeness lookup on IngestRun.target has moved or changed shape",
    ).not.toBeNull();

    const accepted = squash(lookup![1]);
    // The plain padded CIK, and the same value behind the xbrl: prefix. Both EDGAR scripts must be
    // findable, or a company's completeness is assembled from half its runs.
    expect(accepted).toContain("corpCode");
    expect(accepted).toContain("xbrl:${corpCode}");
  });

  it("does not have a company-completeness reader for the series-shaped targets", () => {
    // ECOS and FRED targets identify a series, not a company, so nothing should be trying to find
    // them by corp code. If that ever changes, the two shapes are incompatible and this is where
    // the mismatch should surface.
    const reader = readFileSync(join(process.cwd(), "src/server/domain/companyXray.ts"), "utf8");
    expect(reader).not.toContain("statCode");
    expect(reader).not.toContain("seriesId");
  });
});
