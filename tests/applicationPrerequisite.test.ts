import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  idempotencyClass,
  idempotencyKey,
  mayAutoApply,
  recoverFrom,
} from "@/server/controlbus/application";
import type { ApplicationRecord } from "@/server/controlbus/application";
import { GOVERNED_ACTIONS, evaluateAction } from "@/server/governance/policy";

/**
 * IR-051 and IR-052 as a machine-enforced prerequisite, not a note.
 *
 * Both were recorded and deliberately not fixed, and the reasoning was sound: nothing applies
 * decisions automatically, the consumer is a pure function taking `appliedIds` from its caller, so
 * nothing today can double-apply. Recording a latent defect honestly is right.
 *
 * What is not right is leaving the door open for someone — including a later session of me — to
 * wire execution up without meeting it. A finding in a document has never stopped anyone, and the
 * whole GUARDRAIL_COVERAGE cluster is twelve instances of a rule that existed somewhere other than
 * in the code.
 *
 * So this file is the door. It fails if an automatic application path appears that does not go
 * through `application.ts`, and it pins the semantics that path must have.
 *
 * **The distinction the module exists to hold.** Delivery may repeat; the transport is at-least-once
 * and deduplication absorbs that. The EFFECT must happen once. Those are conflated constantly, and
 * the conflation is invisible until a crash lands in the window between them.
 */

describe("nothing applies a decision automatically without the prerequisite", () => {
  /**
   * The guard. It looks for a module that both consumes control-bus decisions and performs an
   * effect, and requires it to import the application journal.
   *
   * Deliberately shallow. A precise call-graph analysis would be better and would also be the kind
   * of test that gets deleted when it breaks for an unrelated reason; a shallow check that runs is
   * worth more than a clever one that does not.
   */
  it("has no execution path that skips the application journal", () => {
    const serverDir = join(process.cwd(), "src/server");
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        if (path.includes("application.ts")) continue;

        const source = readFileSync(path, "utf8");
        // Reads a decision from the bus...
        const consumesDecisions =
          /unprocessedDecisions|controlEvents|assessDecision|InboxEntry/.test(source);
        // ...and carries something out.
        const performsEffect =
          /\bexecFileSync\b|\bexecSync\b|\bspawn\b|prisma\.\w+\.(create|update|upsert|delete)|method:\s*["'`](POST|PATCH|PUT|DELETE)/.test(
            source,
          );
        if (consumesDecisions && performsEffect && !source.includes("controlbus/application")) {
          offenders.push(path);
        }
      }
    };
    walk(serverDir);

    expect(
      offenders,
      `These consume control-bus decisions AND perform effects without importing the application ` +
        `journal:\n  ${offenders.join("\n  ")}\n` +
        "IR-051/IR-052: exactly-once application is not crash-safe without a durable journal and " +
        "an idempotency classification. Route the effect through application.ts, or do not " +
        "automate it.",
    ).toEqual([]);
  });

  it("confirms the premise it rests on — no automatic application exists yet", () => {
    // If this ever fails, the finding above stopped being latent and the guard above became the
    // only thing standing between a redelivered comment and a repeated effect.
    const consumer = readFileSync(join(process.cwd(), "src/server/controlbus/consumer.ts"), "utf8");
    expect(consumer).not.toMatch(/\bexecFileSync\b|\bexecSync\b|\bspawn\b/);
    expect(consumer).not.toMatch(/prisma\./);
  });
});

describe("an action nobody classified is never applied automatically", () => {
  it("fails closed on an unclassified action", () => {
    const unknown = mayAutoApply("LOCAL_MODEL_HYPOTHESIS");
    expect(unknown.allowed).toBe(false);
    expect(unknown.class).toBe("UNKNOWN");
    expect(unknown.reason).toContain("unknown is not safe");
  });

  it.each([
    "PURCHASE_AI_CREDITS",
    "DEPLOY_PRODUCTION",
    "DESTRUCTIVE_DB_OP",
    "COMMIT_CREDENTIAL",
  ] as const)("refuses to auto-apply %s", (kind) => {
    expect(mayAutoApply(kind).allowed).toBe(false);
  });

  it("refuses a non-idempotent action even though policy permits it", () => {
    // The distinction worth keeping: FIX_REPRODUCED_DEFECT is AUTO_ALLOWED_WITH_VERIFY, and it is
    // still not something a process should retry blind after dying halfway through. Governance
    // asks whether it MAY happen; this asks whether it can safely happen twice.
    expect(evaluateAction({ kind: "FIX_REPRODUCED_DEFECT" }).decision).toBe(
      "AUTO_ALLOWED_WITH_VERIFY",
    );
    expect(mayAutoApply("FIX_REPRODUCED_DEFECT").allowed).toBe(false);
  });

  it("allows the two classes that survive a crash of unknown outcome", () => {
    expect(mayAutoApply("EDIT_DOCS").allowed).toBe(true);
    expect(mayAutoApply("POST_PUBLIC_ISSUE_COMMENT").class).toBe("RECONCILABLE");
  });

  it("classifies every governed action, or names it UNKNOWN rather than omitting it", () => {
    // Coverage measured, not assumed. An action absent from the table is UNKNOWN and refused, so
    // this reports the gap rather than failing — the safe default is already correct, and what
    // matters is that the size of the gap is visible.
    const unclassified = GOVERNED_ACTIONS.filter((k) => idempotencyClass(k) === "UNKNOWN");
    expect(unclassified.length, `unclassified: ${unclassified.join(", ")}`).toBeLessThan(
      GOVERNED_ACTIONS.length / 2,
    );
    for (const kind of unclassified) expect(mayAutoApply(kind).allowed).toBe(false);
  });
});

describe("crash recovery is decided by the action, not by the journal", () => {
  const record = (state: ApplicationRecord["state"], action: ApplicationRecord["action"]) => ({
    protocolId: "ESC-009",
    action,
    idempotencyKey: idempotencyKey("ESC-009", action),
    state,
    at: "2026-08-19T00:00:00Z",
    note: "",
  });

  it("does nothing for an entry already applied", () => {
    expect(recoverFrom(record("APPLIED", "EDIT_DOCS")).action).toBe("NOTHING_TO_DO");
  });

  it("retries a reservation that never started", () => {
    // Nothing was attempted, so no effect can have occurred — safe regardless of class.
    expect(recoverFrom(record("RESERVED", "GIT_COMMIT")).action).toBe("RETRY");
  });

  it("retries an idempotent effect that may or may not have happened", () => {
    expect(recoverFrom(record("STARTED", "EDIT_DOCS")).action).toBe("RETRY");
  });

  it("goes and looks for a reconcilable one instead of guessing", () => {
    // The hard window. The journal cannot say whether the comment was posted; the issue can.
    const recovery = recoverFrom(record("STARTED", "POST_PUBLIC_ISSUE_COMMENT"));
    expect(recovery.action).toBe("RECONCILE_THEN_DECIDE");
    expect(recovery.reason).toContain("ESC-009:POST_PUBLIC_ISSUE_COMMENT");
  });

  it("escalates rather than repeating a non-idempotent effect of unknown outcome", () => {
    // The case that must never be reached, which is why such actions are refused before they are
    // ever reserved. Reaching it means the refusal was bypassed, and the only safe move left is
    // to stop and say so.
    expect(recoverFrom(record("STARTED", "ADDITIVE_SCHEMA_MIGRATION")).action).toBe(
      "ESCALATE_INDETERMINATE",
    );
  });

  it("keeps the idempotency key stable across restarts", () => {
    // Derived from what the effect IS, never from when it ran. A key containing a timestamp would
    // be a different key on every attempt, which is the same as having none.
    expect(idempotencyKey("ESC-009", "GIT_COMMIT")).toBe(idempotencyKey("ESC-009", "GIT_COMMIT"));
    expect(idempotencyKey("ESC-009", "GIT_COMMIT")).not.toMatch(/\d{4}-\d{2}-\d{2}|\d{10,}/);
  });
});
