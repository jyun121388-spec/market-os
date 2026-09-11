/**
 * The autonomy boundary: environment facts, established from the machine, supplied to the scheduler.
 *
 * ## WHY THIS EXISTS (IR-126)
 *
 * `scheduleNextWork()` is a pure function of the context it is handed, and an OMITTED context is
 * optimistic by design — `tests/evolutionScheduler.test.ts` pins that, and the pin says the remedy
 * is for the caller to supply what it knows. `scripts/evolution-shadow.ts` does. The repository's
 * canonical "run the scheduler" surface, `scripts/next-work.ts`, did not: it called
 * `scheduleNextWork()` bare, so with every provider key known to be absent it printed
 * `ACTIONABLE 5 / DEFERRED 0`, listed four provider-gated items as `AGENT_MAY_PROCEED_AFTER_VERIFY`,
 * and then fed that queue to `evaluateStopSentinel` as the "no startable task" condition. The same
 * tree, through the shadow script, said `0 actionable / 5 deferred`. Reproduced on 2026-09-06
 * (A: shadow 0/4, B: bare call 4/0, C: next-work 4/0 — one fewer since HG-002 closed FRED), and an
 * independent read-only pass reached the same verdict: a defect at the caller boundary, not in the
 * library.
 *
 * ## THE RULE
 *
 * At this boundary, explicit FALSE stays FALSE, and UNKNOWN is never promoted to available when the
 * output decides what may be started. Every fact below is either ESTABLISHED from the machine —
 * presence only, never a value — or UNESTABLISHED with the reason, and an unestablished fact is
 * supplied to the scheduler in whatever encoding the policy engine reads as "not permitted yet"
 * (`UNKNOWN_ENCODING`). That encoding is per field on purpose: the engine blocks provider calls only
 * on an explicit `providerKeyAvailable: false`, but reads `verificationGreen: false` as a MEASURED
 * red suite (DENIED), so for that field the honest unknown is `undefined` — "verify first" — and
 * `false` would be a claim.
 *
 * The library is untouched. A generic caller may still omit context and get the documented
 * optimistic queue; the autonomous entry point may not.
 *
 * ## HUMAN GATES ARE NOT ENVIRONMENT
 *
 * `providerKeyAvailable` is one boolean for three providers, because that is what the policy engine
 * takes. A FRED key does not make ECOS callable, and an ECOS key in the shell does not close HG-003
 * — a gate is closed by a person and recorded in `docs/HUMAN_GATE_QUEUE.md`. So after the scheduler
 * has answered, any startable item whose `blockedBy` names a gate is checked against the register:
 * a gate that is not `RESOLVED` there, or that cannot be found, defers the item as `REQUIRES_HUMAN`.
 * Human-gate semantics are the register's, not this file's, and not the environment's.
 *
 *   npx tsx scripts/next-work.ts        (the consumer)
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  capabilityGapProposals,
  clusterProposals,
  type Proposal,
} from "../src/server/evolution/proposal";
import { KEYED_PROVIDERS, type KeyedProvider } from "../src/server/governance/policy";
import {
  scheduleNextWork,
  type NextWorkQueue,
  type ScheduledWork,
  type SchedulerContext,
} from "../src/server/evolution/scheduler";

/**
 * The provider credentials this repository knows, by environment variable NAME.
 *
 * Values are never read past a boolean. The KEYS of this record are `KeyedProvider` — the policy
 * engine's own identity type, checked by the type system rather than by a comment, so a provider
 * added to the engine and forgotten here fails to compile instead of failing closed silently.
 */
export const PROVIDER_KEY_ENV: Record<KeyedProvider, string> = {
  FRED: "FRED_API_KEY",
  ECOS: "ECOS_API_KEY",
  OPENDART: "DART_API_KEY",
};
export type ProviderCode = KeyedProvider;
export type Presence = "PRESENT" | "ABSENT";

export type GithubAuth = "AUTHENTICATED" | "UNAUTHENTICATED" | "UNAVAILABLE";

/** Everything this module asks the machine, injectable so the boundary is testable without a machine. */
export interface EnvironmentProbe {
  /** Names to presence. Only ever asked whether a name is set. */
  env: Record<string, string | undefined>;
  /** Text of `docs/HUMAN_GATE_QUEUE.md`, or null when it cannot be read. */
  gateRegister: () => string | null;
  /** Text of `docs/PROJECT_STATE.md`, or null when it cannot be read. */
  stateDocument: () => string | null;
  /** `gh auth status`, by exit code only — nothing is captured, nothing is printed. */
  githubAuth: () => GithubAuth;
}

/**
 * The scheduler facts this module answers with a single boolean.
 *
 * `providerKeys` is deliberately NOT one of them: it is a map, it is always establishable (a name
 * is either set or it is not), and it has no "unknown" encoding to choose. Keeping the table over
 * the scalars means adding a non-boolean context field can never silently acquire a default.
 */
export type ScalarSchedulerFact = Exclude<keyof SchedulerContext, "providerKeys">;

export interface EstablishedFact {
  field: ScalarSchedulerFact;
  value: boolean;
  because: string;
}

export interface UnestablishedFact {
  field: ScalarSchedulerFact;
  /** What the scheduler was told instead. Never the permissive reading. */
  supplied: boolean | undefined;
  because: string;
}

export interface AutonomyEnvironment {
  /** What `scheduleNextWork` is called with. Built only from the two lists below. */
  context: SchedulerContext;
  providerKeys: Record<ProviderCode, Presence>;
  established: EstablishedFact[];
  unestablished: UnestablishedFact[];
}

/**
 * What the scheduler is told about a fact this module could not establish.
 *
 * Read against `src/server/governance/policy.ts`: the engine blocks on an explicit `false` for the
 * first three and treats their absence as permissive, so the closed encoding is `false`. For
 * `verificationGreen`, `false` means "measured red" and turns AUTO_ALLOWED_WITH_VERIFY into DENIED;
 * absence means "verify before committing", which is the only honest thing to say about a suite
 * nobody has run. Mapping any of these to `true` is the defect this file exists to refuse.
 */
export const UNKNOWN_ENCODING: Record<ScalarSchedulerFact, boolean | undefined> = {
  providerKeyAvailable: false,
  credentialsAvailable: false,
  includedModelQuotaAvailable: false,
  verificationGreen: undefined,
};

/**
 * The marker `CLAUDE.md` says is written into PROJECT_STATE when included usage is exhausted.
 *
 * It counts only at the START OF A LINE. The first run of this module on the real tree found the
 * string in PROJECT_STATE's prose — a sentence describing the convention — and reported the quota
 * exhausted. A mention is not a marker, and reading one as the other is presence-as-state, the
 * defect class this file exists to refuse, committed by this file.
 */
export const USAGE_LIMIT_MARKER = "USAGE_LIMIT_PAUSE";

/** True when some line of `text` begins with the marker (leading whitespace allowed). */
export function carriesUsageLimitMarker(text: string): boolean {
  return text.split("\n").some((line) => line.trimStart().startsWith(USAGE_LIMIT_MARKER));
}

/** Presence only. Identical in spirit to `requireCredential`, minus the exit code and the message. */
const present = (env: Record<string, string | undefined>, name: string): Presence =>
  env[name] ? "PRESENT" : "ABSENT";

export function establishEnvironment(
  probe: EnvironmentProbe = machineProbe(),
): AutonomyEnvironment {
  const established: EstablishedFact[] = [];
  const unestablished: UnestablishedFact[] = [];
  const context: SchedulerContext = {};

  const establish = (field: ScalarSchedulerFact, value: boolean, because: string) => {
    established.push({ field, value, because });
    context[field] = value;
  };
  const cannotEstablish = (field: ScalarSchedulerFact, because: string) => {
    const supplied = UNKNOWN_ENCODING[field];
    unestablished.push({ field, supplied, because });
    if (supplied !== undefined) context[field] = supplied;
  };

  // --- provider keys: presence per provider, one boolean for the engine ------------------------
  //
  // Scripts run under tsx do not load `.env`; the adapters read `process.env`, and so does this.
  // A key that sits in `.env` but was not exported is, for this process, absent — which is also
  // what the adapters would find, so the report and the reality agree.
  const providerKeys = Object.fromEntries(
    KEYED_PROVIDERS.map((code) => [code, present(probe.env, PROVIDER_KEY_ENV[code])]),
  ) as Record<ProviderCode, Presence>;
  const absent = KEYED_PROVIDERS.filter((code) => providerKeys[code] === "ABSENT");
  const everyKeyPresent = KEYED_PROVIDERS.every((code) => providerKeys[code] === "PRESENT");

  // BOTH facts, always, and each answers a different question. The map answers "may this
  // FRED-named action run", the aggregate answers "may an action that never said what it calls
  // run". Supplying only the aggregate is the aliasing
  // `[CHATGPT_DECISION][MARKET-PROVIDER-KEY-GRANULARITY-20260906]` accepted; supplying only the
  // map would leave every unnamed action unanswered, which the engine reads as permitted.
  context.providerKeys = Object.fromEntries(
    KEYED_PROVIDERS.map((code) => [code, providerKeys[code] === "PRESENT"]),
  ) as Partial<Record<ProviderCode, boolean>>;

  establish(
    "providerKeyAvailable",
    everyKeyPresent,
    everyKeyPresent
      ? "every known provider key is present in the environment (presence only; values not read)"
      : `absent: ${absent.join(", ")}. This is the CONJUNCTION, read only by an action that does ` +
          "not say which provider it calls; a named action is answered from the per-provider map " +
          "above and is not held by another provider's absence",
  );

  // --- GitHub credential: a positive probe, by exit code -------------------------------------
  //
  // CLAUDE.md records the probe that got this wrong: `gh auth status` exits non-zero when logged
  // out, a `||` fallback fired, and "unauthenticated" was recorded as "absent". Three outcomes,
  // each its own result, and only the first is positive.
  switch (probe.githubAuth()) {
    case "AUTHENTICATED":
      establish("credentialsAvailable", true, "gh auth status exited 0 (nothing captured)");
      break;
    case "UNAUTHENTICATED":
      establish("credentialsAvailable", false, "gh is installed and auth status exited non-zero");
      break;
    case "UNAVAILABLE":
      cannotEstablish(
        "credentialsAvailable",
        "gh could not be run, which says nothing about whether a credential exists",
      );
  }

  // --- included model quota: the documented marker ---------------------------------------------
  const state = probe.stateDocument();
  if (state === null) {
    cannotEstablish("includedModelQuotaAvailable", "docs/PROJECT_STATE.md could not be read");
  } else if (carriesUsageLimitMarker(state)) {
    establish(
      "includedModelQuotaAvailable",
      false,
      `docs/PROJECT_STATE.md carries a ${USAGE_LIMIT_MARKER} line, the marker CLAUDE.md says is written when included usage is exhausted`,
    );
  } else {
    establish(
      "includedModelQuotaAvailable",
      true,
      `docs/PROJECT_STATE.md is readable and no line begins with ${USAGE_LIMIT_MARKER}; CLAUDE.md makes that marker the record of exhaustion` +
        (state.includes(USAGE_LIMIT_MARKER)
          ? " (the string occurs in prose, which is not the marker)"
          : ""),
    );
  }

  // --- verification: not attempted here, for the same reason stop-evidence gives -------------
  cannotEstablish(
    "verificationGreen",
    "requires running the suite, build and typecheck on THIS tree; a cached result is a claim " +
      "about a past one. Left undefined, which the engine reads as 'verify before committing', " +
      "not as green",
  );

  return { context, providerKeys, established, unestablished };
}

/** The real machine. Nothing here prints, and nothing reads a value past a boolean. */
export function machineProbe(): EnvironmentProbe {
  const read = (path: string): string | null => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  };
  return {
    env: process.env,
    gateRegister: () => read("docs/HUMAN_GATE_QUEUE.md"),
    stateDocument: () => read("docs/PROJECT_STATE.md"),
    githubAuth: () => {
      const result = spawnSync("gh", ["auth", "status"], { stdio: "ignore", windowsHide: true });
      if (result.error) return "UNAVAILABLE";
      return result.status === 0 ? "AUTHENTICATED" : "UNAUTHENTICATED";
    },
  };
}

/**
 * Gate id -> the status literal the register records for it.
 *
 * A section opens with `## HG-nnn — title`; its status is the first `**Status**: \`X\`` line after
 * it. First status wins, so the `HG-001 addendum` section and a resolved gate's "status at the
 * time" record do not overwrite the current one.
 */
export function parseGateRegister(text: string): Map<string, string> {
  const statuses = new Map<string, string>();
  let current: string | null = null;
  for (const line of text.split("\n")) {
    const heading = /^## (HG-\d{3})\b/.exec(line);
    if (heading) {
      current = heading[1];
      continue;
    }
    const status = /^\*\*Status\*\*: `([A-Z_]+)`/.exec(line);
    if (status && current && !statuses.has(current)) statuses.set(current, status[1]);
  }
  return statuses;
}

export interface GateDeferral {
  proposalId: string;
  /** Each gate the item named, with what the register says about it. */
  gates: { id: string; status: string }[];
}

const STARTABLE = new Set<ScheduledWork["authority"]>([
  "AGENT_MAY_PROCEED",
  "AGENT_MAY_PROCEED_AFTER_VERIFY",
]);

/**
 * Moves every startable item that names an unresolved — or unfindable — gate to the deferred side.
 *
 * `register` is null when the file could not be read. Then every named gate is UNKNOWN, and
 * unknown defers: an item cannot become startable because the record that would gate it was
 * missing.
 */
export function deferOpenGates(
  queue: NextWorkQueue,
  register: Map<string, string> | null,
): { queue: NextWorkQueue; deferrals: GateDeferral[] } {
  const deferrals: GateDeferral[] = [];
  const actionable: ScheduledWork[] = [];
  const moved: ScheduledWork[] = [];

  for (const work of queue.actionable) {
    const ids = [...new Set(work.blockedBy?.match(/\bHG-\d{3}\b/g) ?? [])];
    const gates = ids.map((id) => ({
      id,
      status: register === null ? "UNKNOWN (register unreadable)" : (register.get(id) ?? "UNKNOWN"),
    }));
    const open = gates.filter((g) => g.status !== "RESOLVED");
    if (open.length === 0) {
      actionable.push(work);
      continue;
    }
    deferrals.push({ proposalId: work.proposal.id, gates });
    moved.push({
      ...work,
      authority: "REQUIRES_HUMAN",
      blockedBy: open.map((g) => `${g.id} (${g.status})`).join(", "),
    });
  }

  return { queue: { actionable, deferred: [...queue.deferred, ...moved] }, deferrals };
}

export interface AutonomousSchedule {
  queue: NextWorkQueue;
  environment: AutonomyEnvironment;
  /** The register as parsed, or null when it could not be read. */
  register: Map<string, string> | null;
  gateDeferrals: GateDeferral[];
}

/**
 * The scheduler, called the way an autonomous loop must call it.
 *
 * There is no way to reach `scheduleNextWork` through here without the environment: the context is
 * built first and passed unconditionally, and a mutation suite proves that removing it turns the
 * boundary controls red.
 */
export function scheduleAutonomousWork(
  options: { probe?: EnvironmentProbe; completed?: string[]; proposals?: Proposal[] } = {},
): AutonomousSchedule {
  const probe = options.probe ?? machineProbe();
  const environment = establishEnvironment(probe);
  const registerText = probe.gateRegister();
  const register = registerText === null ? null : parseGateRegister(registerText);
  // The register is read BEFORE the proposals are built, and handed to the generator, so a
  // provider-calling proposal names its gate only while that gate is open. Without this the
  // library's own fail-closed default stands, and a resolved gate keeps being reported as the
  // reason work is stuck — which is misleading in exactly the direction that hides a real
  // blocker behind a settled one.
  const scheduled = scheduleNextWork({
    context: environment.context,
    completed: options.completed,
    proposals: options.proposals ?? [
      ...clusterProposals(),
      ...capabilityGapProposals(undefined, register),
    ],
  });
  const { queue, deferrals } = deferOpenGates(scheduled, register);
  return { queue, environment, register, gateDeferrals: deferrals };
}

export type QueueVerdict =
  | { verdict: "STARTABLE_WORK_EXISTS"; because: string }
  | { verdict: "NO_SAFE_MEANINGFUL_NODE"; because: string };

/**
 * What the queue says, and only what the queue says.
 *
 * `NO_SAFE_MEANINGFUL_NODE` means nothing may be started from here: either every item is gated and
 * the gating facts were established, or a fact could not be established and dependent work is
 * being held closed. Both are the same verdict — unknown is not safe — but the reason is printed,
 * because the second is a task ("establish the fact") and the first is a wait. Neither is
 * "may stop": that is `evaluateStopSentinel`, which also needs the discovery, review, orphan and
 * failure counts, and this verdict is one of its inputs rather than a substitute for it.
 */
export function queueVerdict(schedule: AutonomousSchedule): QueueVerdict {
  const { queue, environment } = schedule;
  if (queue.actionable.length > 0) {
    return {
      verdict: "STARTABLE_WORK_EXISTS",
      because: `${queue.actionable.length} item(s) startable under the established environment`,
    };
  }
  const heldClosed = environment.unestablished.filter((f) => f.supplied === false);
  if (heldClosed.length > 0) {
    return {
      verdict: "NO_SAFE_MEANINGFUL_NODE",
      because:
        `${queue.deferred.length} item(s) deferred; ${heldClosed.map((f) => f.field).join(", ")} ` +
        "could not be established and dependent work is held closed rather than assumed available",
    };
  }
  return {
    verdict: "NO_SAFE_MEANINGFUL_NODE",
    because: `${queue.deferred.length} item(s) deferred, every one gated on an established fact or an open human gate`,
  };
}

export function isStartable(work: ScheduledWork): boolean {
  return STARTABLE.has(work.authority);
}
