import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assessDecision,
  controlEvents,
  startableDecisionCount,
} from "@/server/controlbus/consumer";
import type { ConsumerContext } from "@/server/controlbus/consumer";
import { emptyState, ingestComments, resolveInboxEntry } from "@/server/controlbus/state";
import type { InboxEntry } from "@/server/controlbus/state";
import {
  PRE_CUTOVER_DIRECTIVE_IDS,
  isPreCutoverDirective,
  reconcilePreCutoverDirective,
} from "@/server/controlbus/reconcile";
import { mayAutoApply } from "@/server/controlbus/application";
import { GOVERNED_ACTIONS } from "@/server/governance/policy";
import { matchProject, parseProtocolMessage, reconcile } from "@/server/escalation/transport";
import { LOCAL_PROJECT_ID } from "@/server/controlbus/identity";

/**
 * `[CHATGPT_DECISION][ESC-012]`, comment 5364810128, Option A.
 *
 * The consumer modelled issue #2 as request/response and rejected everything else as
 * `NO_MATCHING_ESCALATION` — "answers no question we asked". The channel is not request/response.
 * Seven trusted directives had been received, acted on, and left unresolved in the durable inbox,
 * including RC-GATES-001, which authorised the twenty-gate review chain the release rests on. A
 * model that calls its most consequential inputs invalid is describing something else.
 *
 * What the decision authorises is narrow, and these tests exist to keep it narrow. Provenance
 * becomes a LABEL rather than a verdict. Every other gate is unchanged, and the one property that
 * matters most is asserted from several directions:
 *
 *     VALIDATED is not APPLIED.
 *
 * A directive that passes every gate has earned a work item, not an effect.
 */

const TRUSTED = "chatgpt-operator";

const entry = (protocolId: string, body: string, author = TRUSTED): InboxEntry => ({
  protocolId,
  githubCommentId: 1,
  receivedAt: "2026-08-21T00:00:00.000Z",
  author,
  body,
  status: "RECEIVED_UNVALIDATED",
});

const context: ConsumerContext = {
  openEscalationIds: ["ESC-009"],
  appliedIds: [],
  trustedAuthors: [TRUSTED],
  preCutoverProtocolIds: [...PRE_CUTOVER_DIRECTIVE_IDS],
};

const assess = (e: InboxEntry, overrides: Partial<ConsumerContext> = {}) =>
  assessDecision(e, { ...context, ...overrides }, GOVERNED_ACTIONS);

describe("provenance is a label, not a verdict", () => {
  it("validates a trusted directive that answers nothing we asked", () => {
    const a = assess(entry("MARKET-RESUME-099", "Status: RESUME_SAFE_RUN. Continue safe work."));
    expect(a.verdict).toBe("DIRECTIVE_VALIDATED");
    expect(a.provenance).toBe("UNSOLICITED_DIRECTIVE");
  });

  it("keeps a matched decision applicable and marks it solicited", () => {
    const a = assess(entry("ESC-009", "Keep the current lockout."));
    expect(a.verdict).toBe("APPLICABLE");
    expect(a.provenance).toBe("SOLICITED_DECISION");
  });

  it("makes both classes startable work, because a directive is work", () => {
    const entries = [entry("ESC-009", "Keep it."), entry("MARKET-RESUME-099", "Continue.")];
    expect(startableDecisionCount(entries, context, GOVERNED_ACTIONS)).toBe(2);
    const events = controlEvents(entries, context, GOVERNED_ACTIONS);
    expect(events.map((e) => e.provenance)).toEqual([
      "SOLICITED_DECISION",
      "UNSOLICITED_DIRECTIVE",
    ]);
  });

  it("records the provenance on the inbox entry, not only in the verdict", () => {
    // Six months later a VALIDATED entry with no provenance cannot say whether anyone asked for
    // it. The status and the provenance answer different questions and are stored separately.
    const row = entry("MARKET-RESUME-099", "Continue.");
    const state = { ...emptyState(2), inbox: [row] };
    const after = resolveInboxEntry(
      state,
      { protocolId: "MARKET-RESUME-099", githubCommentId: row.githubCommentId },
      "VALIDATED",
      "validated",
      "UNSOLICITED_DIRECTIVE",
    );
    expect(after.resolved).toBe(true);
    if (!after.resolved) return;
    expect(after.state.inbox[0].provenance).toBe("UNSOLICITED_DIRECTIVE");
    expect(after.state.inbox[0].status).toBe("VALIDATED");
  });
});

describe("every gate the old rejection was hiding behind still holds", () => {
  it("rejects the same body from an author nobody designated", () => {
    const a = assess(entry("MARKET-RESUME-099", "Continue.", "a-passer-by"));
    expect(a.verdict).toBe("UNTRUSTED_AUTHOR");
    expect(a.provenance).toBeUndefined();
  });

  it("trusts nobody when the allowlist is absent", () => {
    // The issue is publicly commentable. An unset allowlist that trusted everyone would make
    // forgetting to configure it equivalent to opening the channel to the internet — and under
    // ESC-012 that now reaches VALIDATED rather than a rejection, which raises the cost of the
    // old fail-open behaviour rather than lowering it.
    const a = assess(entry("MARKET-RESUME-099", "Continue."), { trustedAuthors: undefined });
    expect(a.verdict).toBe("UNTRUSTED_AUTHOR");
  });

  it("treats an unmatched TEST id as transport exercise, never as a directive", () => {
    const a = assess(entry("TEST-042", "Connection test."));
    expect(a.verdict).toBe("TEST_MESSAGE_NOT_A_DECISION");
    expect(
      startableDecisionCount([entry("TEST-042", "Connection test.")], context, GOVERNED_ACTIONS),
    ).toBe(0);
  });

  it("refuses a directive naming an action policy denies", () => {
    const a = assess(entry("MARKET-RESUME-099", "Proceed with PURCHASE_AI_CREDITS."));
    expect(a.verdict).toBe("FORBIDDEN_BY_GOVERNANCE");
  });

  it("refuses a directive naming a Human Gate action", () => {
    const a = assess(entry("MARKET-RESUME-099", "Run DEPLOY_PRODUCTION now."));
    expect(a.verdict).toBe("FORBIDDEN_BY_GOVERNANCE");
  });

  it("refuses a directive whose prose describes an action it did not declare", () => {
    const a = assess(entry("MARKET-RESUME-099", "CONTROL_BUS_READ; also deploy to production."));
    expect(a.verdict).toBe("ACTIONS_NOT_DECLARED");
  });

  it("refuses a directive written against a HEAD that has moved", () => {
    const a = assess(entry("MARKET-RESUME-099", "Against HEAD: abc1234, continue."), {
      currentHead: "def5678901234567890",
    });
    expect(a.verdict).toBe("STALE_AGAINST_HEAD");
  });

  it("refuses to produce a second work item for an id already applied", () => {
    const a = assess(entry("MARKET-RESUME-099", "Continue."), {
      appliedIds: ["MARKET-RESUME-099"],
    });
    expect(a.verdict).toBe("ALREADY_APPLIED");
    expect(
      startableDecisionCount(
        [entry("MARKET-RESUME-099", "Continue.")],
        {
          ...context,
          appliedIds: ["MARKET-RESUME-099"],
        },
        GOVERNED_ACTIONS,
      ),
    ).toBe(0);
  });
});

describe("the project segment, which nothing had ever read (IR-086)", () => {
  it("reads the exchange id from the LAST segment of a three-part tag", () => {
    // Reproduced against the real pair. `[ESCALATION][MARKET-OS][ESC-012]` was parsed as an
    // exchange whose id was MARKET-OS, so the decision answering it — tagged
    // `[CHATGPT_DECISION][ESC-012]` — matched nothing, and under ESC-012's new rule would have
    // been mislabelled UNSOLICITED when it was the most solicited message on the issue.
    const m = parseProtocolMessage({
      id: 1,
      user: { login: TRUSTED },
      body: "[ESCALATION][MARKET-OS][ESC-012] One decision.",
      created_at: "",
    });
    expect(m?.id).toBe("ESC-012");
    expect(m?.project).toBe("MARKET-OS");
  });

  it("leaves a two-segment tag exactly as it was", () => {
    // Most of this channel's history is two-segment. A fix that changed their ids would silently
    // orphan every past exchange.
    const m = parseProtocolMessage({
      id: 1,
      user: { login: TRUSTED },
      body: "[CHATGPT_DECISION][ESC-009] Keep it.",
      created_at: "",
    });
    expect(m?.id).toBe("ESC-009");
    expect(m?.project).toBeUndefined();
  });

  it("matches an escalation to its own decision once the project segment is understood", () => {
    const channel = reconcile(
      [
        {
          id: 1,
          user: { login: TRUSTED },
          body: "[ESCALATION][MARKET-OS][ESC-012] One decision.",
          created_at: "",
        },
        {
          id: 2,
          user: { login: TRUSTED },
          body: "[CHATGPT_DECISION][ESC-012] Option A.",
          created_at: "",
        },
      ],
      { appliedIds: [], pendingAckIds: [], pendingEscalationIds: [], trustedAuthors: [TRUSTED] },
    );
    expect(channel.exchanges).toHaveLength(1);
    expect(channel.exchanges[0].id).toBe("ESC-012");
    expect(channel.exchanges[0].state).toBe("DECISION_RECEIVED");
  });

  it("refuses a directive tagged for another project", () => {
    const foreign = { ...entry("ESC-500", "Proceed."), project: "OTHER-REPO" };
    expect(assess(foreign, { project: "MARKET-OS" }).verdict).toBe("WRONG_PROJECT");
  });

  it("refuses a project-tagged directive when this consumer has no identity to compare", () => {
    // Unknown is not a match. Without a configured project id there is no way to tell an
    // instruction for this repository from one for any other, and waving it through would make
    // forgetting a configuration line into an authorisation.
    const tagged = { ...entry("ESC-500", "Proceed."), project: "MARKET-OS" };
    expect(assess(tagged, { project: undefined }).verdict).toBe("WRONG_PROJECT");
  });

  it("accepts a matching project", () => {
    const tagged = { ...entry("ESC-500", "Proceed."), project: "MARKET-OS" };
    expect(assess(tagged, { project: "MARKET-OS" }).verdict).toBe("DIRECTIVE_VALIDATED");
  });

  it("still accepts an untagged directive, because that is most of the history", () => {
    expect(assess(entry("ESC-500", "Proceed."), { project: "MARKET-OS" }).verdict).toBe(
      "DIRECTIVE_VALIDATED",
    );
  });

  it("carries the project from the tag onto the inbox entry, unjudged", () => {
    const { admitted } = ingestComments(
      emptyState(2),
      [
        {
          id: 9,
          user: { login: TRUSTED },
          body: "[CHATGPT_DECISION][MARKET-OS][ESC-500] Proceed.",
          created_at: "",
        },
      ],
      "2026-08-22T00:00:00.000Z",
    );
    expect(admitted[0].protocolId).toBe("ESC-500");
    expect(admitted[0].project).toBe("MARKET-OS");
    // The watcher observes; it does not judge.
    expect(admitted[0].status).toBe("RECEIVED_UNVALIDATED");
  });
});

describe("validated is not applied", () => {
  it("gives a validated directive no authority over the application gate", () => {
    // The consumer's verdict and the idempotency prerequisite are independent questions, and this
    // is the case where conflating them would be expensive: a directive that passed every gate
    // still cannot auto-apply a non-idempotent or human-gated action.
    const a = assess(entry("MARKET-RESUME-099", "Proceed with REFACTOR."));
    expect(a.verdict).toBe("DIRECTIVE_VALIDATED");
    expect(mayAutoApply("REFACTOR").allowed).toBe(false);
    expect(mayAutoApply("DEPLOY_PRODUCTION").allowed).toBe(false);
    expect(mayAutoApply("EDIT_GOVERNING_DOCUMENT").allowed).toBe(false);
  });

  it("leaves an unclassified action unrunnable, however it arrived", () => {
    expect(mayAutoApply("NOT_A_REAL_ACTION" as never).class).toBe("UNKNOWN");
    expect(mayAutoApply("NOT_A_REAL_ACTION" as never).allowed).toBe(false);
  });

  it("never returns APPLIED from the consumer at all", () => {
    // Structural. The consumer has no vocabulary for having done something, which is a stronger
    // guarantee than any individual case: it cannot report an effect because it cannot describe one.
    const source = readFileSync(join(process.cwd(), "src/server/controlbus/consumer.ts"), "utf8");
    expect(source).not.toMatch(/verdict:\s*"APPLIED"/);
  });
});

describe("historical directives are reconciled, never replayed", () => {
  it("routes a pre-cutover id away from judgement before anything can create work", () => {
    for (const id of PRE_CUTOVER_DIRECTIVE_IDS) {
      const a = assess(entry(id, "Status: EXECUTE NOW. Proceed."));
      expect(a.verdict, id).toBe("PRE_CUTOVER_RECONCILE_ONLY");
    }
  });

  it("counts no pre-cutover directive as startable", () => {
    const entries = PRE_CUTOVER_DIRECTIVE_IDS.map((id) => entry(id, "Proceed."));
    expect(startableDecisionCount(entries, context, GOVERNED_ACTIONS)).toBe(0);
  });

  it("checks the pre-cutover list ahead of governance, so an id cannot be re-judged at all", () => {
    // Ordering matters more than it looks. If governance ran first, a pre-cutover directive naming
    // a permitted action would come back FORBIDDEN or APPLICABLE depending on its body, and the
    // second of those is a work item for something already done.
    const a = assess(entry("RC-GATES-001", "Proceed with CONTROL_BUS_READ."));
    expect(a.verdict).toBe("PRE_CUTOVER_RECONCILE_ONLY");
  });

  it("marks a reconciled directive APPLIED only when the effect is proven", () => {
    const outcome = reconcilePreCutoverDirective(entry("RC-GATES-001", "..."), {
      kind: "PROVEN",
      detail: "twenty gate entries in reviews/market-os-final-review.json",
    });
    expect(outcome.status).toBe("APPLIED");
    expect(outcome.provenance).toBe("UNSOLICITED_DIRECTIVE");
    expect(outcome.executorCalls).toBe(0);
  });

  it("leaves it VALIDATED when the effect is absent or was never checked", () => {
    for (const kind of ["NOT_FOUND", "NOT_CHECKED"] as const) {
      const outcome = reconcilePreCutoverDirective(entry("MARKET-RESUME-002", "..."), {
        kind,
        detail: "no observable artefact names this directive",
      });
      expect(outcome.status, kind).toBe("VALIDATED");
      expect(outcome.executorCalls, kind).toBe(0);
      expect(outcome.note).toContain("Not replayed");
    }
  });

  it("refuses to reconcile an id that never had a judgement to bypass", () => {
    // The path exists to skip the consumer. Letting it accept an arbitrary id would make it a way
    // to mark anything APPLIED without judgement — the hole it was written to close.
    expect(() =>
      reconcilePreCutoverDirective(entry("ESC-999", "..."), { kind: "PROVEN", detail: "x" }),
    ).toThrow(/not a pre-cutover directive/);
    expect(isPreCutoverDirective("ESC-999")).toBe(false);
  });

  it("cannot reach an executor", () => {
    // Shallow on purpose, and it runs. The module must not import or name anything that acts.
    const source = readFileSync(join(process.cwd(), "src/server/controlbus/reconcile.ts"), "utf8");
    expect(source).not.toMatch(
      /child_process|spawn|exec\(|execFile|fetch\(|writeFileSync|appendFileSync/,
    );
    // Its only import is a type import, so nothing it depends on can act either.
    const imports = [...source.matchAll(/^import .*$/gm)].map((m) => m[0]);
    for (const line of imports) expect(line, line).toMatch(/^import type /);
  });
});

/**
 * Both production paths, driven from a raw comment body rather than from a hand-built entry.
 *
 * The first ESC-012 application was verified REWORK_REQUIRED for exactly the gap a helper-level
 * test could not see: `consumer.ts` had a project gate and `reconcile()` did not, so the same
 * `[CHATGPT_DECISION][OTHER-REPO][ESC-X]` was WRONG_PROJECT to one machine and a valid
 * UNSOLICITED_DIRECTIVE to the other. Nothing was wrong with either module read on its own.
 *
 * So these go end to end — parse -> reconcile, and parse -> ingest -> assess — and assert the two
 * agree. A boundary that two callers define differently is not a boundary.
 */
describe("both state machines, end to end, agree about the same comment", () => {
  const raw = (body: string, login = TRUSTED) => ({
    id: 1,
    user: { login },
    body,
    created_at: "2026-08-22T00:00:00Z",
  });

  /** Runs one comment through BOTH production paths and reports what each concluded. */
  const both = (body: string, localProject: string | undefined, login = TRUSTED) => {
    const comment = raw(body, login);
    const channel = reconcile([comment], {
      appliedIds: [],
      pendingAckIds: [],
      pendingEscalationIds: [],
      trustedAuthors: [TRUSTED],
      project: localProject,
    });
    const { admitted } = ingestComments(emptyState(2), [comment], "2026-08-22T00:00:00.000Z");
    const assessment = assessDecision(
      admitted[0],
      { openEscalationIds: [], appliedIds: [], trustedAuthors: [TRUSTED], project: localProject },
      GOVERNED_ACTIONS,
    );
    return { transport: channel.exchanges[0].state, consumer: assessment.verdict };
  };

  it("A: a matching project is a valid directive to both", () => {
    expect(both("[CHATGPT_DECISION][MARKET-OS][ESC-X] Proceed.", LOCAL_PROJECT_ID)).toEqual({
      transport: "UNSOLICITED_DIRECTIVE",
      consumer: "DIRECTIVE_VALIDATED",
    });
  });

  it("B: a foreign project from a trusted author is refused by both", () => {
    // The reproduced defect. Before the repair this returned UNSOLICITED_DIRECTIVE from transport
    // and WRONG_PROJECT from the consumer — a trusted author was enough for one of them.
    expect(both("[CHATGPT_DECISION][OTHER-REPO][ESC-X] Proceed.", LOCAL_PROJECT_ID)).toEqual({
      transport: "DECISION_INVALID",
      consumer: "WRONG_PROJECT",
    });
  });

  it("C: a project-tagged message with no local identity fails closed in both", () => {
    expect(both("[CHATGPT_DECISION][MARKET-OS][ESC-X] Proceed.", undefined)).toEqual({
      transport: "DECISION_INVALID",
      consumer: "WRONG_PROJECT",
    });
  });

  it("D: legacy two-segment traffic keeps working in both", () => {
    // Most of this channel's history. A project gate that orphaned it would be a worse defect
    // than the one being fixed.
    expect(both("[CHATGPT_DECISION][ESC-X] Proceed.", LOCAL_PROJECT_ID)).toEqual({
      transport: "UNSOLICITED_DIRECTIVE",
      consumer: "DIRECTIVE_VALIDATED",
    });
  });

  it("keeps the real ESC-012 pair as one exchange, with the local identity enforced", () => {
    // IR-086 compatibility, re-asserted through the repaired path: the three-segment escalation
    // and its two-segment answer are still one logical exchange, and the project now checks out
    // rather than merely being parsed.
    const channel = reconcile(
      [
        raw("[ESCALATION][MARKET-OS][ESC-012] One decision."),
        { ...raw("[CHATGPT_DECISION][ESC-012] Option A."), id: 2 },
      ],
      {
        appliedIds: [],
        pendingAckIds: [],
        pendingEscalationIds: [],
        trustedAuthors: [TRUSTED],
        project: LOCAL_PROJECT_ID,
      },
    );
    expect(channel.exchanges).toHaveLength(1);
    expect(channel.exchanges[0].id).toBe("ESC-012");
    expect(channel.exchanges[0].state).toBe("DECISION_RECEIVED");
  });

  it("refuses a foreign project before it asks who sent it", () => {
    // Ordering, asserted. If trust ran first, an untrusted foreign-project message would report
    // the author problem and hide the addressing one — and the reverse mistake, trusting an author
    // into a foreign project, is the defect this repair exists to close.
    expect(
      both("[CHATGPT_DECISION][OTHER-REPO][ESC-X] Proceed.", LOCAL_PROJECT_ID, "a-passer-by")
        .transport,
    ).toBe("DECISION_INVALID");
  });
});

/**
 * The tag grammar, at its boundary.
 *
 * The pattern matched a PREFIX of the tag and ignored whatever followed, which did not merely
 * accept a malformed message — it silently reassigned identity. `[CHATGPT_DECISION][MARKET-OS]
 * [ESC-X` parsed with id `MARKET-OS`: IR-086's exact failure mode, reachable through a typo,
 * after IR-086 was fixed.
 *
 * Every case below is checked at all three production levels, because a parser test alone is what
 * missed the last two defects in this file.
 */
describe("a tag this parser cannot read exactly is not one it may read approximately", () => {
  const raw = (body: string) => ({
    id: 1,
    user: { login: TRUSTED },
    body,
    created_at: "2026-08-22T00:00:00Z",
  });

  /** Parser, transport reconciliation, and consumer assessment, from one raw body. */
  const levels = (body: string) => {
    const comment = raw(body);
    const local = {
      appliedIds: [],
      pendingAckIds: [],
      pendingEscalationIds: [],
      trustedAuthors: [TRUSTED],
      project: LOCAL_PROJECT_ID,
    };
    const channel = reconcile([comment], local);
    const { admitted } = ingestComments(emptyState(2), [comment], "2026-08-22T00:00:00.000Z");
    const context = {
      openEscalationIds: [],
      appliedIds: [],
      trustedAuthors: [TRUSTED],
      project: LOCAL_PROJECT_ID,
    };
    return {
      parsed: parseProtocolMessage(comment),
      exchange: channel.exchanges[0],
      malformed: channel.malformed.length,
      admitted: admitted.length,
      verdict: admitted.length
        ? assessDecision(admitted[0], context, GOVERNED_ACTIONS).verdict
        : null,
      startable: startableDecisionCount(admitted, context, GOVERNED_ACTIONS),
    };
  };

  describe("valid", () => {
    it.each([
      ["two segments, no prose", "[CHATGPT_DECISION][ESC-X]", undefined],
      ["two segments and prose", "[CHATGPT_DECISION][ESC-X] Proceed.", undefined],
      ["three segments, no prose", "[CHATGPT_DECISION][MARKET-OS][ESC-X]", "MARKET-OS"],
      ["three segments and prose", "[CHATGPT_DECISION][MARKET-OS][ESC-X] Proceed.", "MARKET-OS"],
    ])("%s", (_label, body, project) => {
      const r = levels(body);
      expect(r.parsed?.id).toBe("ESC-X");
      expect(r.parsed?.project).toBe(project);
      expect(r.exchange.state).toBe("UNSOLICITED_DIRECTIVE");
      expect(r.verdict).toBe("DIRECTIVE_VALIDATED");
      expect(r.startable).toBe(1);
    });

    it("accepts a tag followed by a newline and a body, which is what real messages look like", () => {
      const r = levels("[CHATGPT_DECISION][MARKET-OS][ESC-X]\n\nStatus: PROCEED.\n\nDetail.");
      expect(r.parsed?.id).toBe("ESC-X");
      expect(r.verdict).toBe("DIRECTIVE_VALIDATED");
    });
  });

  describe("malformed — no valid directive at any level", () => {
    it.each([
      ["an immediate fourth segment", "[CHATGPT_DECISION][MARKET-OS][ESC-X][EXTRA] Proceed."],
      ["a truncated final bracket", "[CHATGPT_DECISION][MARKET-OS][ESC-X Proceed."],
      ["an empty final segment", "[CHATGPT_DECISION][MARKET-OS][] Proceed."],
    ])("rejects %s", (_label, body) => {
      const r = levels(body);
      expect(r.parsed).toBeNull();
      // Reported as malformed rather than dropped: it opens with a bracket and does not match, so
      // it is a typo in a tag and somebody should see it.
      expect(r.malformed).toBe(1);
      expect(r.exchange).toBeUndefined();
      expect(r.admitted).toBe(0);
      expect(r.verdict).toBeNull();
      expect(r.startable).toBe(0);
    });

    it("does not let a truncated tag promote the project segment to an exchange id", () => {
      // The specific harm. Before the boundary check this parsed with id MARKET-OS — a directive
      // ADDRESSED to the project filed as an exchange NAMED after it, with no project left for the
      // project gate to check.
      expect(parseProtocolMessage(raw("[CHATGPT_DECISION][MARKET-OS][ESC-X"))).toBeNull();
      expect(parseProtocolMessage(raw("[CHATGPT_DECISION][MARKET-OS][]"))).toBeNull();
    });
  });

  describe("the one malformed shape the grammar cannot see, stopped by the next gate", () => {
    it("refuses [KIND][ESC-X][EXTRA] at both machines, though it parses", () => {
      // Stated plainly rather than claimed fixed. `[CHATGPT_DECISION][ESC-X][EXTRA]` is a
      // syntactically perfect three-segment tag: two segments matching the id charset, correctly
      // bounded. Nothing in the GRAMMAR distinguishes it from `[MARKET-OS][ESC-012]`, and the only
      // thing that could is knowing which values are project ids — which belongs in
      // `identity.ts`, downstream, not in a parser that must also be able to SEE foreign-project
      // messages in order to report them as such.
      //
      // So it parses as project=ESC-X, id=EXTRA, and the project gate refuses it at both
      // machines. No valid directive, no work item, which is the property that matters.
      const r = levels("[CHATGPT_DECISION][ESC-X][EXTRA] Proceed.");
      expect(r.parsed?.project).toBe("ESC-X");
      expect(r.exchange.state).toBe("DECISION_INVALID");
      expect(r.verdict).toBe("WRONG_PROJECT");
      expect(r.startable).toBe(0);
      expect(r.exchange.applied).toBe(false);
    });
  });

  it("keeps the real ESC-012 pair parsing exactly as before", () => {
    // IR-086 compatibility under the tighter grammar. Both real messages, both shapes.
    expect(
      parseProtocolMessage(raw("[ESCALATION][MARKET-OS][ESC-012] One decision.")),
    ).toMatchObject({ kind: "ESCALATION", id: "ESC-012", project: "MARKET-OS" });
    expect(parseProtocolMessage(raw("[CHATGPT_DECISION][ESC-012] Option A."))).toMatchObject({
      kind: "CHATGPT_DECISION",
      id: "ESC-012",
    });
  });
});

describe("matchProject is the single definition", () => {
  it.each([
    [undefined, "MARKET-OS", "UNTAGGED"],
    ["MARKET-OS", undefined, "LOCAL_IDENTITY_UNKNOWN"],
    ["MARKET-OS", "MARKET-OS", "MATCHES"],
    ["market-os", "MARKET-OS", "MATCHES"],
    [" MARKET-OS ", "MARKET-OS", "MATCHES"],
    ["OTHER-REPO", "MARKET-OS", "FOREIGN"],
    [undefined, undefined, "UNTAGGED"],
  ])("%s against %s is %s", (message, local, expected) => {
    expect(matchProject(message, local)).toBe(expected);
  });

  it("is imported by both machines rather than reimplemented in either", () => {
    // The defect was two comparisons, not a wrong one. A test that only checked behaviour would
    // pass again the next time someone inlines a third.
    const consumerSource = readFileSync(
      join(process.cwd(), "src/server/controlbus/consumer.ts"),
      "utf8",
    );
    expect(consumerSource).toContain("matchProject");
    expect(consumerSource).not.toMatch(/entry\.project\s*!==\s*context\.project/);
    const transportSource = readFileSync(
      join(process.cwd(), "src/server/escalation/transport.ts"),
      "utf8",
    );
    expect(transportSource).toContain("matchProject(decision.project, local.project)");
  });
});

describe("the two state machines agree about the same message", () => {
  const remote = (id: number, body: string, login = TRUSTED) => ({
    id,
    body,
    created_at: "2026-08-21T00:00:00Z",
    user: { login },
  });

  it("reports a trusted unmatched directive as unsolicited rather than invalid", () => {
    const channel = reconcile([remote(1, "[CHATGPT_DECISION][MARKET-RESUME-099] Continue.")], {
      appliedIds: [],
      pendingAckIds: [],
      pendingEscalationIds: [],
      trustedAuthors: [TRUSTED],
    });
    expect(channel.exchanges[0].state).toBe("UNSOLICITED_DIRECTIVE");
    // Reporting where it has got to, never moving it.
    expect(channel.exchanges[0].applied).toBe(false);
  });

  it("still reports an untrusted unmatched decision as invalid", () => {
    const channel = reconcile(
      [remote(1, "[CHATGPT_DECISION][MARKET-RESUME-099] Continue.", "a-passer-by")],
      { appliedIds: [], pendingAckIds: [], pendingEscalationIds: [], trustedAuthors: [TRUSTED] },
    );
    expect(channel.exchanges[0].state).toBe("DECISION_INVALID");
  });

  it("fails closed with no allowlist", () => {
    const channel = reconcile([remote(1, "[CHATGPT_DECISION][MARKET-RESUME-099] Continue.")], {
      appliedIds: [],
      pendingAckIds: [],
      pendingEscalationIds: [],
    });
    expect(channel.exchanges[0].state).toBe("DECISION_INVALID");
  });

  it("does not dress an unmatched TEST id as a directive", () => {
    const channel = reconcile([remote(1, "[CHATGPT_DECISION][TEST-042] ping")], {
      appliedIds: [],
      pendingAckIds: [],
      pendingEscalationIds: [],
      trustedAuthors: [TRUSTED],
    });
    expect(channel.exchanges[0].state).toBe("DECISION_INVALID");
  });
});

describe("governance records the widening, and only the widening", () => {
  it("names both provenance classes in the control-bus apply rule", () => {
    const source = readFileSync(join(process.cwd(), "src/server/governance/policy.ts"), "utf8");
    const rule = source.slice(source.indexOf("CONTROL_BUS_DECISION_APPLY"));
    expect(rule).toContain("trusted unsolicited directive");
    // The other requirements are still requirements. A widening that quietly dropped one of these
    // would pass a test that only checked the new clause was present.
    expect(rule).toContain("has not already been applied");
    expect(rule).toContain("evaluated by this table");
    expect(rule).toContain("fails closed when unset");
  });
});
