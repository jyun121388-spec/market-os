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
import { parseProtocolMessage, reconcile } from "@/server/escalation/transport";

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
    const state = { ...emptyState(2), inbox: [entry("MARKET-RESUME-099", "Continue.")] };
    const after = resolveInboxEntry(
      state,
      "MARKET-RESUME-099",
      "VALIDATED",
      "validated",
      "UNSOLICITED_DIRECTIVE",
    );
    expect(after.inbox[0].provenance).toBe("UNSOLICITED_DIRECTIVE");
    expect(after.inbox[0].status).toBe("VALIDATED");
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
