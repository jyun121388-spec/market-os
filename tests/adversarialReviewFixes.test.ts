import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assessDecision } from "@/server/controlbus/consumer";
import {
  acquireLock,
  heartbeat,
  readLock,
  releaseLock,
  storePaths,
} from "@/server/controlbus/store";
import { screenPublicComment } from "@/server/escalation/screen";
import { GOVERNED_ACTIONS } from "@/server/governance/policy";
import { preflight } from "@/server/release/preflight";

/**
 * The final Release Candidate adversarial review, and what it found.
 *
 * `gpt-5.6-sol`, read-only, against the eight modules added this session. Ten findings — six P1,
 * four P2 — and every one of the six reproduced exactly as described before anything was changed.
 * This file is the reproduction, kept as the regression.
 *
 * The uncomfortable pattern across them: each defect sat directly beneath a comment asserting the
 * property it broke.
 *
 * - `consumer.ts` opens by saying transport must not become authority, then accepted a decision
 *   from any GitHub account whatsoever, because every gate asked WHICH question and none asked WHO.
 * - `preflight.ts` opens with "missing evidence is never PASS" and then wrote `?? []` and `?? 0`
 *   for three external inputs, so an unsupplied gate list read as no gates.
 * - `store.ts` documented the nonce as what distinguishes a live watcher from a recycled pid, and
 *   never compared it.
 * - `watch.ts` was written to make silent degradation impossible and fetched exactly one page of
 *   an oldest-first endpoint.
 *
 * A stated invariant is not an implemented one, and the gap between them is invisible from inside
 * because the comment reads as though the code does what it says.
 */

const trusted = ["jyun121388-spec"];
const entry = (body: string, author = trusted[0]) => ({
  protocolId: "ESC-009",
  githubCommentId: 1,
  receivedAt: "2026-08-19T00:00:00Z",
  author,
  body,
  status: "RECEIVED_UNVALIDATED" as const,
});
const context = { openEscalationIds: ["ESC-009"], appliedIds: [], trustedAuthors: trusted };

describe("IR-046 — a protocol id is not a credential", () => {
  it("refuses a decision from anyone not designated a decision-maker", () => {
    // Sol's trigger verbatim: read the public [ESCALATION][ESC-009], reply with a matching
    // [CHATGPT_DECISION]. Every existing gate passed it, because none of them asked who wrote it.
    expect(
      assessDecision(entry("Proceed.", "random-internet-person"), context, GOVERNED_ACTIONS)
        .verdict,
    ).toBe("UNTRUSTED_AUTHOR");
  });

  it("trusts nobody when the allowlist is unset", () => {
    // Fails closed, because the alternative is that forgetting to configure it opens the channel
    // to everyone on GitHub.
    const noList = { openEscalationIds: ["ESC-009"], appliedIds: [] };
    expect(assessDecision(entry("Proceed."), noList, GOVERNED_ACTIONS).verdict).toBe(
      "UNTRUSTED_AUTHOR",
    );
  });

  it("still accepts the designated author", () => {
    expect(
      assessDecision(entry("Keep the current lockout."), context, GOVERNED_ACTIONS).verdict,
    ).toBe("APPLICABLE");
  });
});

describe("IR-047 — prose that describes an action authorises nothing", () => {
  it("sends back a decision that describes an action without naming it", () => {
    // The original reasoning was right and its conclusion was wrong. Paraphrase detection IS
    // unsafe in the permissive direction — but the answer to "we cannot read intent from prose"
    // is to refuse the prose, not to approve it. This body named neither enum token, so
    // Governance was never consulted at all and the result was APPLICABLE.
    const assessment = assessDecision(
      entry("Purchase the required API credits and deploy to production."),
      context,
      GOVERNED_ACTIONS,
    );
    expect(assessment.verdict).toBe("ACTIONS_NOT_DECLARED");
  });

  it("evaluates a decision that names its action, and refuses a forbidden one", () => {
    expect(
      assessDecision(entry("Proceed with DEPLOY_PRODUCTION."), context, GOVERNED_ACTIONS).verdict,
    ).toBe("FORBIDDEN_BY_GOVERNANCE");
  });

  it("does not send back an ordinary answer that requires no action", () => {
    // The over-blocking failure. Most decisions are a choice between options and name no action
    // at all; a gate that bounced those would make the channel useless.
    expect(
      assessDecision(
        entry("Keep the current lockout; it is the safer default."),
        context,
        GOVERNED_ACTIONS,
      ).verdict,
    ).toBe("APPLICABLE");
  });
});

describe("IR-048 — the screen missed the commonest shape a pasted secret takes", () => {
  it("catches a lowercase quoted credential key", () => {
    // The rule required an uppercase unquoted name, so a JSON snippet — the single most common
    // way a key actually appears in a paste — matched nothing.
    expect(
      screenPublicComment('"aws_secret_access_key": "wJalrXUtnFEMI7K7MDENGbPxRfiCYEXAMPLEKEY"'),
    ).not.toHaveLength(0);
    expect(screenPublicComment("client_secret: 8f3a9c2b7e1d4f6a0b5c9d2e")).not.toHaveLength(0);
  });

  it("still lets an escalation talk about a variable it does not have", () => {
    for (const safe of [
      "FRED_API_KEY=your-key-here",
      "ECOS_API_KEY=$MY_VAR",
      "set the api_key to <your key> in .env.local",
      "OPENDART_API_KEY is absent, which is why the live run cannot start",
    ]) {
      expect(screenPublicComment(safe), safe).toHaveLength(0);
    }
  });
});

describe("IR-049 — a lock nobody checks is not a lock", () => {
  let root: string;
  let paths: ReturnType<typeof storePaths>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lock-"));
    paths = storePaths(root);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const record = (nonce: string) => ({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    nonce,
  });

  it("refuses a heartbeat from a watcher whose lock was taken over", () => {
    // Sol's sequence: A pauses past three heartbeats, B takes the lock, A resumes and blindly
    // rewrote it. Two live watchers, each believing it held the lock, overwriting each other's
    // cursor snapshots. The nonce was written from the start and never compared.
    const a = record("watcher-a");
    acquireLock(paths, a, 45_000);
    writeFileSync(paths.lock, JSON.stringify(record("watcher-b")), "utf8");
    expect(heartbeat(paths, a, new Date().toISOString())).toBe(false);
    expect(readLock(paths)?.nonce).toBe("watcher-b");
  });

  it("refuses to release a lock it no longer owns", () => {
    // The worse half: deleting the replacement's lock leaves the field clear while a live process
    // is still polling, so the next start admits a third watcher.
    const a = record("watcher-a");
    acquireLock(paths, a, 45_000);
    writeFileSync(paths.lock, JSON.stringify(record("watcher-b")), "utf8");
    releaseLock(paths, a);
    expect(readLock(paths)?.nonce).toBe("watcher-b");
  });

  it("still lets the owner heartbeat and release", () => {
    const a = record("watcher-a");
    acquireLock(paths, a, 45_000);
    expect(heartbeat(paths, a, new Date().toISOString())).toBe(true);
    releaseLock(paths, a);
    expect(readLock(paths)).toBeNull();
  });
});

describe("IR-053, IR-054, IR-055 — the preflight overstated readiness three ways", () => {
  const green = (commit: string) => ({ commit, state: "PASS" as const });
  const at = (head: string) => ({
    head,
    changesSinceEvidence: [],
    treeClean: true,
    pushedToRemote: true,
    tests: green(head),
    typecheck: green(head),
    lint: green(head),
    format: green(head),
    build: green(head),
    e2e: green(head),
    migrations: green(head),
    verifyCoverage: green(head),
    openP0: 0,
    openP1: 0,
    unhandledReviewFindings: 0,
    finalReviewDone: true,
    finalReviewCommit: head,
    openHumanGates: [],
    unverifiedProviders: [],
    queuedEscalations: 0,
    controlBusWatcher: "ALIVE" as const,
  });

  it("does not pass evidence from another commit merely because no change was declared", () => {
    // An empty change list was read as "nothing changed" when it equally means "nobody said".
    // Keeping those two apart is the entire purpose of the module, and it had them backwards on
    // its own input.
    const stale = { ...at("AAAA"), head: "BBBB", finalReviewCommit: "BBBB" };
    expect(preflight(stale).verdict).toBe("EVIDENCE_STALE");
  });

  it.each(["openHumanGates", "unverifiedProviders", "queuedEscalations"] as const)(
    "refuses to treat an unsupplied %s as satisfied",
    (field) => {
      // The file says "missing evidence is never PASS" in its opening paragraph and then wrote
      // `?? []` for exactly these three.
      const input: Record<string, unknown> = { ...at("AAAA") };
      delete input[field];
      expect(preflight(input as never).verdict).toBe("EVIDENCE_INSUFFICIENT");
    },
  );

  it("does not carry a review of an earlier commit forward as a review of this one", () => {
    const report = preflight({ ...at("BBBB"), finalReviewCommit: "AAAA" });
    expect(report.verdict).toBe("EVIDENCE_STALE");
    expect(report.checks.find((c) => c.name === "final independent review")?.state).toBe("STALE");
  });

  it("still reports READY when everything genuinely holds at this HEAD", () => {
    expect(preflight(at("CCCC")).verdict).toBe("RELEASE_CANDIDATE_READY");
  });
});

describe("IR-050 — the watcher fetched one page of an oldest-first endpoint", () => {
  it("pages until the endpoint runs out", async () => {
    // Silent and total: GitHub returns issue comments oldest first, so a single per_page=100 call
    // returns the same hundred forever. Past a hundred comments every new decision is invisible,
    // and anyone able to comment could have pushed the issue past that line on purpose. Nothing
    // errors, nothing logs, the watcher reports a healthy quiet poll.
    const source = readFileSync(join(process.cwd(), "src/server/controlbus/watch.ts"), "utf8");
    expect(source).toContain("page=${page}");
    expect(source).toMatch(/batch\.length < 100/);
    // Bounded, so a paging bug cannot become a loop against a public endpoint.
    expect(source).toMatch(/page <= 50/);
  });
});
