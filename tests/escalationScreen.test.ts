import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mayPostPublicly, screenPublicComment } from "@/server/escalation/screen";
import { queuePendingComment } from "@/server/escalation/transport";
import { GOVERNED_ACTIONS, evaluateAction } from "@/server/governance/policy";

/**
 * PHASE — GOVERNANCE ACTION CLASSIFICATION COVERAGE.
 *
 * The coverage question has two halves and only one of them was being asked. `RULES` is typed
 * `Record<ActionKind, Rule>`, so the compiler proves every KIND has a rule. Nothing proved that
 * every action the system actually performs has a kind — and an action with no kind is not an
 * uncovered rule, it is an invisible one.
 *
 * Enumerating what this system can do turned up exactly one such action: the escalation channel
 * posts to an issue on a publicly readable repository. It is the only thing here that sends data
 * off this machine. It had no `ActionKind`, consulted no policy, and screened no content; the
 * prohibition on posting credentials to it existed as prose in an operator's instructions, which
 * is to say it was enforced by whoever was reading at the time.
 *
 * This file covers both halves: the action is now classified, and the classification's stated
 * verification is a real check rather than a sentence.
 */

describe("every governed action is classified, and every action performed is governed", () => {
  it("gives each action kind a decision with a citation", () => {
    for (const kind of GOVERNED_ACTIONS) {
      const evaluation = evaluateAction({ kind });
      expect(evaluation.decision, kind).toBeTruthy();
      // A decision with no citation is an opinion — the module's own words.
      expect(evaluation.citations.length, `${kind} decides with no cited source`).toBeGreaterThan(
        0,
      );
      expect(evaluation.rationale.length, `${kind} decides with no rationale`).toBeGreaterThan(20);
    }
  });

  it("classifies posting to the public escalation channel", () => {
    const evaluation = evaluateAction({ kind: "POST_PUBLIC_ISSUE_COMMENT" });
    // Not a human gate: an asynchronous decision channel that stops for approval on every message
    // is not asynchronous. The risk is the content, and content is checkable.
    expect(evaluation.decision).toBe("AUTO_ALLOWED_WITH_VERIFY");
    expect(evaluation.requiredVerification.join(" ")).toContain("screenPublicComment");
  });

  it("reports the missing credential as an execution blocker, not as a refusal", () => {
    // HG-001. Policy permits the post; the machine cannot make it. Collapsing those two into one
    // state is what makes a blocked queue look like a denied one.
    const blocked = evaluateAction({
      kind: "POST_PUBLIC_ISSUE_COMMENT",
      context: { credentialsAvailable: false },
    });
    expect(blocked.decision).toBe("AUTO_ALLOWED_WITH_VERIFY");
    expect(blocked.execution).toBe("BLOCKED_MISSING_CREDENTIAL");
  });

  it("keeps the escalation module the only writer to an external surface", () => {
    // The enumeration that produced this finding, pinned so it stays true. If a second module
    // learns to post outward, it needs its own classification and this is where that surfaces.
    const serverDir = join(process.cwd(), "src/server");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith(".ts")) {
          const source = readFileSync(path, "utf8");
          if (/\bfetch\(\s*["'`]https:\/\/api\.github\.com/.test(source)) offenders.push(path);
        }
      }
    };
    walk(serverDir);
    for (const path of offenders) {
      expect(path, `${path} posts to GitHub without going through the escalation module`).toContain(
        "escalation",
      );
    }
  });
});

describe("the screen refuses what must never be published", () => {
  it.each([
    ["Authorization: Bearer abcdefghijklmnop", "AUTHORIZATION_HEADER"],
    ["token is ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345", "CREDENTIAL"],
    ["export OPENAI_KEY=sk-abcdefghijklmnopqrstuvwxyz01", "CREDENTIAL"],
    ["postgresql://postgres:realpassword@db.example.net:5432/prod", "CONNECTION_STRING"],
    ["DATABASE_PASSWORD=hunter2hunter2", "ENVIRONMENT_SECRET"],
    ["contact me at someone@gmail.com", "PRIVATE_CONTACT"],
  ])("refuses %s", (body, category) => {
    const { allowed, findings } = mayPostPublicly(body);
    expect(allowed).toBe(false);
    expect(findings.map((f) => f.category)).toContain(category);
  });

  it("never repeats the matched text in the finding", () => {
    // A screen that logs what it caught has copied the secret into the log, which is where the
    // next reader finds it. The finding names the shape and the line, and stops there.
    const secret = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";
    const findings = screenPublicComment(`the token is ${secret}`);
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(JSON.stringify(finding)).not.toContain(secret);
      expect(finding.line).toBe(1);
    }
  });

  it("still allows the escalation to describe the problem it is escalating", () => {
    // The failure that would kill this check: over-blocking until people route around it. Talking
    // ABOUT a variable, a provider or a placeholder is the normal content of an escalation.
    for (const body of [
      "[ESCALATION][TEST-002] FRED_API_KEY is absent, so the live capability run cannot start.",
      "Set DATABASE_URL=<your connection string> in .env.local before running the suite.",
      "The .env.example line reads ECOS_API_KEY=your-key-here and no real key exists on this box.",
      "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>",
      "See https://api.stlouisfed.org/fred/series for the documented response shape.",
      // The staged queue's own worked example of how to post the comment. Describing the shape of
      // a request is how a transport problem gets explained at all.
      'curl -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/repos/o/r/issues/2',
      'curl -H "Authorization: Bearer <your token>" https://api.github.com',
    ]) {
      expect(mayPostPublicly(body).allowed, body).toBe(true);
    }
  });

  it("refuses to even queue a comment that would leak, rather than refusing to post it", () => {
    // The queue is durable — it is written to a committed markdown file — so a credential that
    // reaches it is published to the repository whether or not the post ever happens. Screening
    // at the post would be screening after the leak.
    expect(() =>
      queuePendingComment(
        [],
        {
          kind: "ESCALATION",
          id: "LEAK-001",
          body: "auth fails even with ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345",
          createdAt: "2026-08-19T00:00:00.000Z",
          reasonNotPosted: "no credential",
          retryCondition: "CREDENTIAL_STATE_CHANGED",
        },
        { exchanges: [], transport: "WRITE_PENDING_AUTH" } as never,
      ),
    ).toThrow(/Refusing to queue ESCALATION\[LEAK-001\]/);
  });

  it("still queues an ordinary escalation", () => {
    const queued = queuePendingComment(
      [],
      {
        kind: "ESCALATION",
        id: "TEST-003",
        body: "[ESCALATION][TEST-003] FRED_API_KEY is absent; the live run cannot start.",
        createdAt: "2026-08-19T00:00:00.000Z",
        reasonNotPosted: "no credential",
        retryCondition: "CREDENTIAL_STATE_CHANGED",
      },
      { exchanges: [], transport: "WRITE_PENDING_AUTH" } as never,
    );
    expect(queued.length).toBe(1);
  });

  it("clears the comments already staged for posting", () => {
    // The staged queue is real and will be posted the moment a credential appears. Screening it
    // after the fact is the point — a check written now that never runs against the backlog would
    // only protect messages nobody has written yet.
    const staged = readFileSync(join(process.cwd(), "docs/escalation/PENDING_COMMENTS.md"), "utf8");
    const { allowed, findings } = mayPostPublicly(staged);
    expect(
      allowed,
      `staged comments would publish: ${findings.map((f) => `line ${f.line} ${f.reason}`).join("; ")}`,
    ).toBe(true);
  });
});
