import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADVISORY_INBOUND_KINDS,
  ALL_PROTOCOL_KINDS,
  AUTHORITATIVE_KINDS,
  isAuthorityBearing,
  isKnownProtocolKind,
} from "@/server/escalation/transport";

/**
 * IR-122. The engineering ledger may not contradict the protocol it documents.
 *
 * `docs/REVIEW_DEBT.md` said, in a commit of mine, that `CHATGPT_VERIFIED` is a kind `ProtocolKind`
 * does not know, that the durable inbox drops it, and that ESC-014 was still unanswered. Every
 * clause was false against the tree it was committed to. ESC-014 was answered — issue #2 comment
 * `5498489070`, Option B — and applied at `4aca09ce`, which is why `ADVISORY_INBOUND_KINDS` exists
 * at all. I did not check the code. I copied a sentence out of the operating rules, which were
 * stale, and the copy read exactly like evidence. That is `EVIDENCE_FABRICATION` with me as author.
 *
 * The fix is not to reword the paragraph. A reworded paragraph is a second normative source waiting
 * to drift again. These controls DERIVE what may not be said from the code:
 *
 *   - kind names come from `ALL_PROTOCOL_KINDS`, so a kind added later is covered without anyone
 *     remembering to extend a list here;
 *   - "ESC-014 was answered" is not asserted but DERIVED: advisory kinds exist in the code only
 *     because the ESC-014 decision widened ingestion, so while that list is non-empty the ledger
 *     may not say the question is unasked.
 *
 * What is deliberately NOT claimed: that ESC-014 is review-closed. It is not. There is no
 * `[CHATGPT_VERIFIED][ESC-014]` verdict, and an application is not a verification — the same
 * distinction the decision insists on between `INGESTED`, `AUTHORITATIVE` and `APPLIED`.
 */

const DOCS = ["docs/REVIEW_DEBT.md", "CLAUDE.md"];

/** Normalised so a CRLF checkout of the same commit cannot answer differently (EN-05). */
function readDoc(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");
}

/**
 * PROSE only: fenced and indented blocks are dropped first.
 *
 * A ledger has to be able to quote the defect it records. This entry sets the stale claim beside
 * the tree's answer in a two-column block and lists the mutants that restore it — and the first
 * draft of this guard failed on its own entry, which is the correct instinct applied one step too
 * far. Normative claims live in prose; a block is a quotation or a table.
 *
 * The limitation, stated rather than papered over: a future stale claim written INSIDE a block
 * would not be caught. The one this exists for was prose, both mutants restore prose, and widening
 * to cover blocks would mean the ledger could no longer show what it is correcting.
 *
 * Sentences, roughly. Prose here wraps at 100 columns, so a line-based check would split a claim in
 * half and see neither. Newlines collapse to spaces, then a split on terminal punctuation — enough
 * to keep a subject with its verb, which is all this needs.
 */
function sentences(text: string): string[] {
  const prose = text
    .replace(/^```[\s\S]*?^```/gm, "")
    .split("\n")
    .filter((line) => !/^ {4,}\S/.test(line))
    .join("\n");
  return prose
    .replace(/\n+/g, " ")
    .split(/(?<=[.;:])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Present-tense claims of non-delivery — the only tense that says anything about this tree. */
const DROPPED_NOW =
  /\b(is dropped|are dropped|gets dropped|drops it|drops them|does not know|do not know|is not known|are not known|is unknown to|never reaches|cannot carry)\b/i;

/** Present-tense claims that the question was never put. */
const UNASKED_NOW =
  /\b(not posted|has not been asked|still unasked|still unanswered|not yet asked)\b/i;

/**
 * What makes a sentence a statement about the PAST rather than about this tree.
 *
 * A ledger's whole value is that it records what was true and what was believed, so history and
 * reported speech must both survive. The reported-speech markers are deliberately narrow: a bare
 * "said" would exempt almost anything, and the exemption would become the hiding place.
 */
const HISTORICAL =
  /\b(was dropped|were dropped|used to|before ESC-014|pre-ESC-014|until ESC-014|then in force said|previously said|formerly said|at the time of this measurement)\b/i;

/** ONE detector, used on the real documents and on the canary below. */
function staleClaims(text: string): string[] {
  const found: string[] = [];
  for (const sentence of sentences(text)) {
    if (HISTORICAL.test(sentence)) continue;
    const dropClaim =
      DROPPED_NOW.test(sentence) && ALL_PROTOCOL_KINDS.some((k) => sentence.includes(k));
    const unaskedClaim = UNASKED_NOW.test(sentence) && sentence.includes("ESC-014");
    if (dropClaim || unaskedClaim) found.push(sentence.slice(0, 180));
  }
  return found;
}

describe("the ledger cannot contradict the kind model it describes", () => {
  it("recognises every advisory kind, which is the premise the rest of this rests on", () => {
    // If this ever fails, the controls below are checking a rule that no longer holds rather than
    // passing because there is nothing left to compare against.
    expect(ADVISORY_INBOUND_KINDS.length).toBeGreaterThan(0);
    for (const kind of ALL_PROTOCOL_KINDS) expect(isKnownProtocolKind(kind), kind).toBe(true);
  });

  it("actually reads the documents it claims to scan", () => {
    // The other half of "a guard that can skip itself proves nothing". The canary below exercises
    // the DETECTOR; this exercises the INPUT. Emptying the document list would otherwise turn both
    // scans green while checking nothing at all.
    expect(DOCS).toContain("docs/REVIEW_DEBT.md");
    expect(DOCS).toContain("CLAUDE.md");
    for (const doc of DOCS) expect(readDoc(doc).length, doc).toBeGreaterThan(1000);
  });

  it("makes exactly one inbound kind authority-bearing, and it is CHATGPT_DECISION", () => {
    expect([...AUTHORITATIVE_KINDS]).toEqual(["CHATGPT_DECISION"]);
    expect(isAuthorityBearing("CHATGPT_DECISION")).toBe(true);
    for (const kind of ADVISORY_INBOUND_KINDS) expect(isAuthorityBearing(kind), kind).toBe(false);
    // Failing closed is why this takes a string rather than the union.
    expect(isAuthorityBearing("CHATGPT_SOMETHING_NEW")).toBe(false);
  });

  /**
   * The detector, exercised on text this file controls.
   *
   * Without this, every mutant that makes the scan see nothing — an emptied document list, a
   * sentence splitter that returns nothing, a pattern that matches nothing — would turn the two
   * controls below GREEN, and a guard that can skip itself proves nothing.
   */
  it("detects the exact claim it was written for, and leaves history alone", () => {
    expect(
      staleClaims("`CHATGPT_VERIFIED` is one of the kinds `ProtocolKind` does not know."),
    ).toHaveLength(1);
    expect(staleClaims("ESC-014 is still unanswered.")).toHaveLength(1);
    // Past tense and reported speech survive, because the ledger's job is to record them.
    expect(staleClaims("Eleven kinds including `CHATGPT_VERIFIED` were dropped.")).toEqual([]);
    expect(staleClaims('The rules then in force said ESC-014 was "not posted".')).toEqual([]);
    // And an unrelated sentence is not swept up by either pattern.
    expect(staleClaims("The watcher polls from this machine only.")).toEqual([]);
  });

  it("says nowhere that a kind the code recognises is dropped today", () => {
    const offences = DOCS.flatMap((doc) =>
      staleClaims(readDoc(doc))
        .filter((s) => DROPPED_NOW.test(s))
        .map((s) => `${doc}: ${s}`),
    );
    expect(
      offences,
      `These say a RECOGNISED kind is dropped, in the present tense:\n  ${offences.join("\n  ")}\n` +
        "ESC-014 widened durable ingestion to nine kinds. Past tense is fine and true; present " +
        "tense is the stale claim IR-122 was raised for.",
    ).toEqual([]);
  });

  it("says nowhere that ESC-014 is unasked, while the code carries its answer", () => {
    // The derivation: advisory kinds exist because the ESC-014 decision said they should. Their
    // presence is therefore evidence the question was answered, and no prose may say otherwise.
    // Widened to `readonly string[]` on purpose: the tuple's literal length makes `=== 0` a
    // typecheck error, and the guard clause is the point — it says WHY the rule applies.
    if ((ADVISORY_INBOUND_KINDS as readonly string[]).length === 0) return;

    const offences = DOCS.flatMap((doc) =>
      staleClaims(readDoc(doc))
        .filter((s) => UNASKED_NOW.test(s))
        .map((s) => `${doc}: ${s}`),
    );
    expect(
      offences,
      `ESC-014 was answered by issue #2 comment 5498489070 and applied at 4aca09ce; these say ` +
        `otherwise:\n  ${offences.join("\n  ")}`,
    ).toEqual([]);
  });

  it("does not promote the IR-120 verification beyond the SHA it names", () => {
    // `[CHATGPT_VERIFIED][MARKET-IR120-...]` comment 5508217382 is bounded to exact 5056d779. The
    // ledger may record it; what it must not do is let it read as approval of anything after it.
    const ledger = readDoc("docs/REVIEW_DEBT.md");
    if (!ledger.includes("MARKET-IR120-TS-CONFIG-AUTHORITY-20260902-1612")) return;
    expect(ledger, "the bounding SHA must appear wherever that verification is cited").toContain(
      "5056d779",
    );
  });

  /**
   * MARKET-STATE-TRUTH-RECONCILIATION. `docs/PROJECT_STATE.md` carried a `WAITING_DECISION` row for
   * ESC-015 twelve days after the decision had landed, been applied and been verified. The row was
   * a current-status claim that nobody re-read, and it looked exactly like evidence.
   *
   * Derived, not listed: an escalation is provably no longer waiting once this repository has
   * RECORDED its own `[CLAUDE_APPLIED][<id>]` in `docs/escalation/TRANSPORT_STATE.md` — you cannot
   * apply a decision you are still waiting for. So every id with such a section is an id that
   * `PROJECT_STATE.md` may not describe as waiting, and adding the next one extends the rule.
   */
  it("does not leave a WAITING_DECISION row for an escalation this repository has already applied", () => {
    const transport = readDoc("docs/escalation/TRANSPORT_STATE.md");
    const applied = new Set(
      [...transport.matchAll(/^## .*`\[CLAUDE_APPLIED\]\[([A-Z0-9-]+)\]`/gm)].map((m) => m[1]),
    );
    expect(applied.size, "the derivation must have something to derive from").toBeGreaterThan(0);

    const state = readDoc("docs/PROJECT_STATE.md");
    const offences: string[] = [];
    for (const line of state.split("\n")) {
      if (!/^\s+WAITING_DECISION\s/.test(line)) continue;
      for (const id of applied) {
        if (line.includes(id)) offences.push(`${id}: ${line.trim().slice(0, 120)}`);
      }
    }
    expect(
      offences,
      `PROJECT_STATE.md says these are waiting; TRANSPORT_STATE.md records them as APPLIED:\n  ` +
        offences.join("\n  "),
    ).toEqual([]);
  });
});
