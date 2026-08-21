import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Work a document names as next must be in the queue, or say why it is not.
 *
 * This exists because the contradiction actually shipped. `SESSION_HANDOFF.md` said financial
 * semantics — fiscal versus calendar, cross-currency — were unworked and were where the next pass
 * should start, while the scheduler reported zero startable and the stop sentinel reported
 * `mayStop: true`. Both statements were written in the same session, and nothing connected them.
 *
 * That is orphan work: a task recorded in prose, absent from the mechanism that decides what to do
 * next, with no record of why. It is the same failure as an unread review finding, and it is worse
 * in one respect — the document makes it look handled.
 *
 * The check is deliberately shallow. It looks for the phrases a handoff uses to name future work
 * and requires each to resolve, rather than trying to parse intent out of English. A shallow check
 * that runs is worth more than a clever one that gets deleted for being noisy.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

/** Phrases that promise future work in this repository's documents. */
const PROMISES = [
  /\bnext pass\b/i,
  /\bnot (?:yet )?worked\b/i,
  /\bthe next (?:phase|item|step) (?:should|is)\b/i,
  /\bstill (?:to be|needs to be) (?:done|worked|audited)\b/i,
];

/**
 * A named promise resolves if the same document, or the debt register, says what became of it —
 * scheduled, deferred with a reason, or done.
 */
const RESOLUTIONS = [
  /\bdeferred\b/i,
  /\bblocked\b/i,
  /\bHG-\d+\b/,
  /\bIR-\d+\b/,
  /\bgated\b/i,
  /\bdone\b/i,
  /\bcomplete[d]?\b/i,
  /\brecorded in\b/i,
];

describe("documented next-work is not orphaned", () => {
  it.each(["docs/SESSION_HANDOFF.md", "docs/CURRENT_TASK.md", "docs/REVIEW_DEBT.md"])(
    "%s resolves every promise it makes",
    (path) => {
      const doc = read(path);
      const lines = doc.split("\n");
      const promises = lines.filter((line) => PROMISES.some((p) => p.test(line)));

      for (const line of promises) {
        // The promise itself, or the paragraph around it, must say what became of the work.
        const index = lines.indexOf(line);
        const context = lines.slice(Math.max(0, index - 3), index + 6).join(" ");
        expect(
          RESOLUTIONS.some((r) => r.test(context)),
          `${path} promises work with no recorded disposition:\n  ${line.trim()}`,
        ).toBe(true);
      }
    },
  );

  /**
   * The specific pair that caused this. Both were named as unworked in the handoff while the queue
   * was empty; both are now audited, with the audit itself as the evidence. If either is ever
   * described as unworked again, it needs a disposition beside it.
   */
  it("has actually worked the financial-semantics areas the handoff named", () => {
    const audit = read("tests/financialSemanticCompatibility.test.ts");
    expect(audit).toContain("fiscal");
    expect(audit).toContain("currenc");
    // And the audit records its outcome rather than merely existing.
    expect(audit).toMatch(/no defect|safe by construction/i);
  });

  it("keeps the deferred findings visible with their reasons", () => {
    // Every deferred P2 must remain findable with a reason attached, or "deferred" becomes
    // indistinguishable from "forgotten".
    const debt = read("docs/REVIEW_DEBT.md");
    for (const id of ["IR-028", "IR-033", "IR-036", "IR-037"]) {
      expect(debt, `${id} has fallen out of the debt register`).toContain(id);
    }
  });
});
