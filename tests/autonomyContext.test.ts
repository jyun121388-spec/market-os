import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { capabilityGapProposals, clusterProposals } from "@/server/evolution/proposal";
import type { Proposal } from "@/server/evolution/proposal";
import { evaluateStopSentinel, scheduleNextWork } from "@/server/evolution/scheduler";
import type { ActionKind } from "@/server/governance/policy";
import {
  deferOpenGates,
  establishEnvironment,
  isStartable,
  parseGateRegister,
  queueVerdict,
  scheduleAutonomousWork,
  UNKNOWN_ENCODING,
  USAGE_LIMIT_MARKER,
  carriesUsageLimitMarker,
  type EnvironmentProbe,
} from "../scripts/autonomy-context";

/**
 * The autonomy boundary (IR-126): the scheduler is called with what the machine established, and
 * nothing unestablished is ever read as available.
 *
 * The defect these bind: `scripts/next-work.ts` called `scheduleNextWork()` bare and printed
 * `ACTIONABLE 5 / DEFERRED 0` on a machine where every provider key was known to be absent. The
 * library's optimistic default is intentional and pinned elsewhere; the boundary is where it must
 * end. Every fixture below is a probe, so no control depends on this machine's keys, its `gh`, or
 * its documents unless it says so.
 */

/** A register with exactly these gates at exactly these statuses. */
const register = (statuses: Record<string, string>) =>
  Object.entries(statuses)
    .map(([id, status]) => `## ${id} — a gate\n\n**Status**: \`${status}\` · note\n`)
    .join("\n");

const PENDING_REGISTER = register({ "HG-003": "PENDING_USER", "HG-004": "PENDING_USER" });

const probe = (overrides: Partial<EnvironmentProbe> = {}): EnvironmentProbe => ({
  env: {},
  gateRegister: () => PENDING_REGISTER,
  stateDocument: () => "# Project state\n\nnothing exhausted here\n",
  githubAuth: () => "AUTHENTICATED",
  ...overrides,
});

const ALL_KEYS = { FRED_API_KEY: "x", ECOS_API_KEY: "x", DART_API_KEY: "x" };

/** A proposal needing exactly these actions, for human-gate semantics. */
const proposal = (id: string, requiredGovernance: ActionKind[]): Proposal => ({
  id,
  observation: `${id} observed`,
  proposedChange: "change",
  expectedBenefit: "benefit",
  expectedRisk: "risk",
  requiredVerify: ["a targeted test"],
  requiredGovernance,
  evidence: [{ standing: "OBSERVED" as const, statement: "observed once", source: "test fixture" }],
  systemicWeakness: null,
  hypothesis: "test hypothesis",
});

const realProposals = () => [...clusterProposals(), ...capabilityGapProposals()];

describe("a known no-provider-key environment", () => {
  it("schedules nothing and defers everything with a reason", () => {
    const { queue, environment } = scheduleAutonomousWork({ probe: probe() });
    expect(queue.actionable).toEqual([]);
    expect(queue.deferred.length).toBeGreaterThan(0);
    for (const work of queue.deferred) {
      expect(isStartable(work)).toBe(false);
      expect(work.blockedBy, `${work.proposal.id} is deferred without a reason`).toBeDefined();
    }
    const fact = environment.established.find((f) => f.field === "providerKeyAvailable");
    expect(fact?.value).toBe(false);
    expect(environment.context.providerKeyAvailable).toBe(false);
  });

  it("is where the library's optimistic reading of an unstated environment ends", () => {
    // The library pin stays in evolutionScheduler.test.ts. This is the other half: the SAME
    // proposals, the SAME tree, and the boundary reports strictly less startable work than a bare
    // call — never more.
    const bare = scheduleNextWork();
    const bounded = scheduleAutonomousWork({ probe: probe() }).queue;
    expect(bare.actionable.length).toBeGreaterThan(bounded.actionable.length);
    expect(bounded.actionable.length).toBeLessThanOrEqual(bare.actionable.length);
  });
});

describe("provider capability that IS available", () => {
  it("unlocks only the work whose gate the register records as resolved", () => {
    const { queue } = scheduleAutonomousWork({
      probe: probe({
        env: ALL_KEYS,
        gateRegister: () => register({ "HG-003": "RESOLVED", "HG-004": "PENDING_USER" }),
      }),
    });
    const ids = (items: typeof queue.actionable) => items.map((w) => w.proposal.id);
    expect(ids(queue.actionable)).toContain("CAP-DEBT-ECOS");
    expect(ids(queue.actionable)).not.toContain("CAP-DEBT-OPENDART");
    const dart = queue.deferred.find((w) => w.proposal.id === "CAP-DEBT-OPENDART");
    expect(dart?.authority).toBe("REQUIRES_HUMAN");
    expect(dart?.blockedBy).toContain("HG-004");
    expect(dart?.blockedBy).toContain("PENDING_USER");
  });

  it("does not change what a human gate means", () => {
    // A key in the shell is an environment fact. It cannot carry a deployment past its gate.
    const { queue } = scheduleAutonomousWork({
      probe: probe({ env: ALL_KEYS, gateRegister: () => register({}) }),
      proposals: [
        proposal("MIXED", ["ADD_TEST", "DEPLOY_PRODUCTION"]),
        proposal("TEST", ["ADD_TEST"]),
      ],
    });
    expect(queue.actionable.map((w) => w.proposal.id)).toEqual(["TEST"]);
    expect(queue.deferred[0].proposal.id).toBe("MIXED");
    expect(queue.deferred[0].authority).toBe("REQUIRES_HUMAN");
  });

  it("needs every known key before 'call a free provider' reads as available", () => {
    // One boolean for three providers is what the engine takes. A FRED key does not make ECOS
    // callable, so one present key does not flip it; the absent providers are named.
    const environment = establishEnvironment(probe({ env: { FRED_API_KEY: "x" } }));
    expect(environment.providerKeys).toEqual({
      FRED: "PRESENT",
      ECOS: "ABSENT",
      OPENDART: "ABSENT",
    });
    expect(environment.context.providerKeyAvailable).toBe(false);
    const fact = environment.established.find((f) => f.field === "providerKeyAvailable");
    expect(fact?.because).toContain("ECOS");
    expect(fact?.because).toContain("OPENDART");
    expect(fact?.because).not.toContain("FRED");
  });
});

describe("a fact that could not be established", () => {
  it("is held closed, listed with its reason, and never read as available", () => {
    const environment = establishEnvironment(
      probe({ githubAuth: () => "UNAVAILABLE", stateDocument: () => null }),
    );
    const unestablished = Object.fromEntries(environment.unestablished.map((f) => [f.field, f]));
    expect(unestablished.credentialsAvailable?.supplied).toBe(false);
    expect(environment.context.credentialsAvailable).toBe(false);
    expect(unestablished.includedModelQuotaAvailable?.supplied).toBe(false);
    expect(environment.context.includedModelQuotaAvailable).toBe(false);
    for (const fact of environment.unestablished) {
      expect(fact.because.length).toBeGreaterThan(0);
      expect(fact.supplied).not.toBe(true);
    }
    // The encoding table itself: nothing unknown maps to available, ever.
    for (const supplied of Object.values(UNKNOWN_ENCODING)) expect(supplied).not.toBe(true);
  });

  it("reads the usage-limit marker as a line, not as a mention", () => {
    // Found by running the module on the real tree: PROJECT_STATE describes the convention in
    // prose, and a substring match reported the quota exhausted. The real document is the fixture.
    const real = readFileSync("docs/PROJECT_STATE.md", "utf8");
    expect(real).toContain(USAGE_LIMIT_MARKER);
    expect(carriesUsageLimitMarker(real)).toBe(false);
    const prose = establishEnvironment(probe({ stateDocument: () => real }));
    expect(prose.context.includedModelQuotaAvailable).toBe(true);
    const marked = establishEnvironment(
      probe({ stateDocument: () => `${real}\n\n${USAGE_LIMIT_MARKER} — paused 2026-09-06\n` }),
    );
    expect(marked.context.includedModelQuotaAvailable).toBe(false);
    expect(carriesUsageLimitMarker(`  ${USAGE_LIMIT_MARKER}`)).toBe(true);
  });

  it("encodes an unknown verification as 'verify first', not as a measured red", () => {
    // `verificationGreen: false` turns every AUTO_ALLOWED_WITH_VERIFY into DENIED — a claim that
    // the suite was run and failed. Nobody ran it. Undefined is what the engine reads as "verify
    // before committing", and it is the only honest encoding for this one field.
    const environment = establishEnvironment(probe());
    expect(environment.context.verificationGreen).toBeUndefined();
    expect(environment.unestablished.map((f) => f.field)).toContain("verificationGreen");
    expect(UNKNOWN_ENCODING.verificationGreen).toBeUndefined();
  });

  it("defers an item whose gate cannot be found, because unknown is not resolved", () => {
    const { queue, gateDeferrals } = scheduleAutonomousWork({
      probe: probe({ env: ALL_KEYS, gateRegister: () => null }),
    });
    expect(queue.actionable.map((w) => w.proposal.id)).not.toContain("CAP-DEBT-ECOS");
    const ecos = gateDeferrals.find((d) => d.proposalId === "CAP-DEBT-ECOS");
    expect(ecos?.gates[0].status).toContain("UNKNOWN");
    // And a gate the register simply omits is UNKNOWN too, not implicitly resolved.
    const omitted = scheduleAutonomousWork({
      probe: probe({ env: ALL_KEYS, gateRegister: () => register({ "HG-004": "RESOLVED" }) }),
    });
    expect(omitted.queue.actionable.map((w) => w.proposal.id)).not.toContain("CAP-DEBT-ECOS");
    expect(omitted.queue.actionable.map((w) => w.proposal.id)).toContain("CAP-DEBT-OPENDART");
  });
});

describe("NO_SAFE_MEANINGFUL_NODE", () => {
  it("is a statement about the queue and never about stopping", () => {
    const schedule = scheduleAutonomousWork({ probe: probe() });
    expect(queueVerdict(schedule).verdict).toBe("NO_SAFE_MEANINGFUL_NODE");
    // The same queue, handed to the sentinel with nothing else established: the loop may not stop.
    // The verdict is one of the sentinel's inputs, not a substitute for the other eight.
    const sentinel = evaluateStopSentinel({ queue: schedule.queue });
    expect(sentinel.mayStop).toBe(false);
    expect(sentinel.conditions.find((c) => c.name === "no startable task")?.satisfied).toBe(true);
    expect(sentinel.conditions.filter((c) => !c.satisfied).length).toBeGreaterThan(0);
  });

  it("says whether the zero is a finding or a fact held closed", () => {
    const established = queueVerdict(scheduleAutonomousWork({ probe: probe() }));
    expect(established.because).toContain("established");
    const held = queueVerdict(
      scheduleAutonomousWork({ probe: probe({ githubAuth: () => "UNAVAILABLE" }) }),
    );
    expect(held.verdict).toBe("NO_SAFE_MEANINGFUL_NODE");
    expect(held.because).toContain("credentialsAvailable");
    expect(held.because).toContain("held closed");
  });

  it("is not emitted while anything is startable", () => {
    const schedule = scheduleAutonomousWork({
      probe: probe({
        env: ALL_KEYS,
        gateRegister: () => register({ "HG-003": "RESOLVED", "HG-004": "RESOLVED" }),
      }),
    });
    expect(schedule.queue.actionable.length).toBeGreaterThan(0);
    expect(queueVerdict(schedule).verdict).toBe("STARTABLE_WORK_EXISTS");
  });
});

describe("the gate register", () => {
  it("is read the way it is written: first status per section, addenda do not overwrite", () => {
    const parsed = parseGateRegister(
      [
        "## HG-001 — push auth\n\n**Status**: `RESOLVED` · closed\n",
        "## HG-002 — key\n\n**Status**: `RESOLVED` · closed\n\n**Status at the time**: `PENDING_USER`\n",
        "## HG-001 addendum — the channel\n\n**Status**: `HUMAN_GATE`\n",
      ].join("\n"),
    );
    expect(parsed.get("HG-001")).toBe("RESOLVED");
    expect(parsed.get("HG-002")).toBe("RESOLVED");
  });

  it("reads the real register, and HG-002 is closed while HG-003 and HG-004 are not", () => {
    const parsed = parseGateRegister(readFileSync("docs/HUMAN_GATE_QUEUE.md", "utf8"));
    expect(parsed.get("HG-002")).toBe("RESOLVED");
    expect(parsed.get("HG-003")).not.toBe("RESOLVED");
    expect(parsed.get("HG-004")).not.toBe("RESOLVED");
  });

  it("moves only items that name an open gate, and keeps the rest where they were", () => {
    const queue = scheduleNextWork({
      proposals: realProposals(),
      context: { providerKeyAvailable: true, credentialsAvailable: true },
    });
    const before = queue.actionable.map((w) => w.proposal.id);
    const { queue: after, deferrals } = deferOpenGates(queue, new Map([["HG-003", "RESOLVED"]]));
    for (const d of deferrals) expect(before).toContain(d.proposalId);
    for (const d of deferrals) expect(d.gates.some((g) => g.status !== "RESOLVED")).toBe(true);
    expect(after.actionable.length + deferrals.length).toBe(before.length);
    expect(after.deferred.length).toBe(queue.deferred.length + deferrals.length);
  });
});

describe("the machine probe", () => {
  it("answers every field as established or unestablished without reading a value", () => {
    // Runs against THIS machine, so it asserts shape only: every scheduler field is accounted for
    // exactly once, and nothing that was not established is supplied as available.
    const environment = establishEnvironment();
    const fields = [...environment.established, ...environment.unestablished].map((f) => f.field);
    expect([...fields].sort()).toEqual(
      [
        "credentialsAvailable",
        "includedModelQuotaAvailable",
        "providerKeyAvailable",
        "verificationGreen",
      ].sort(),
    );
    for (const fact of environment.unestablished) expect(fact.supplied).not.toBe(true);
    for (const presence of Object.values(environment.providerKeys)) {
      expect(["PRESENT", "ABSENT"]).toContain(presence);
    }
  });
});

/**
 * Per-provider granularity at the boundary
 * (`[CHATGPT_DECISION][MARKET-PROVIDER-KEY-GRANULARITY-20260906]`).
 *
 * IR-126 established the environment and held unknowns closed; it also recorded, as a stated
 * limitation, that `providerKeyAvailable` is one boolean for three providers. M11's measurement
 * made that limitation load-bearing. The boundary now supplies BOTH facts, and neither replaces
 * the other: the map answers a named action, the conjunction answers an unnamed one.
 */
describe("the boundary supplies per-provider facts as well as the conjunction", () => {
  it("establishes both, from presence alone", () => {
    // A value that cannot occur in prose. The first version of this control used "x" and failed
    // against the word "exited" — a leak check whose needle appears in ordinary English proves
    // nothing either way, which is worse than not checking.
    const SENTINEL = "kEy-Va1ue-Must-Never-Appear-9f3c";
    const environment = establishEnvironment(probe({ env: { FRED_API_KEY: SENTINEL } }));
    expect(environment.context.providerKeys).toEqual({
      FRED: true,
      ECOS: false,
      OPENDART: false,
    });
    // The aggregate is still the conjunction, and still false. Both are true statements about the
    // same environment; they answer different questions.
    expect(environment.context.providerKeyAvailable).toBe(false);
    // Presence only: no established or unestablished fact carries the value anywhere.
    for (const fact of [...environment.established, ...environment.unestablished]) {
      expect(fact.because).not.toContain(SENTINEL);
      expect(JSON.stringify(fact)).not.toContain(SENTINEL);
    }
    expect(JSON.stringify(environment.context)).not.toContain(SENTINEL);
  });

  it("unlocks a provider on its own key, without waiting for the others", () => {
    // The defect, at the boundary: ECOS's work was held by OpenDART's absent key. HG-003 resolved
    // so the gate is not what is being measured here.
    const { queue } = scheduleAutonomousWork({
      probe: probe({
        env: { ECOS_API_KEY: "x" },
        gateRegister: () => register({ "HG-003": "RESOLVED", "HG-004": "PENDING_USER" }),
      }),
    });
    const ids = queue.actionable.map((w) => w.proposal.id);
    expect(ids).toContain("CAP-DEBT-ECOS");
    expect(ids).not.toContain("CAP-DEBT-OPENDART");
    // And the work that names no provider is still held by the conjunction, which is unchanged.
    expect(ids).not.toContain("CLUSTER-PROVIDER_ASSUMPTION");
    expect(ids).not.toContain("CLUSTER-SEMANTIC_RECENCY");
  });

  it("does not let a present key close a Human Gate", () => {
    // The two are independent and stay independent: an ECOS key is an environment fact, HG-003 is
    // a person's decision recorded in the register, and only the register closes it.
    const { queue, gateDeferrals } = scheduleAutonomousWork({
      probe: probe({
        env: { ECOS_API_KEY: "x" },
        gateRegister: () => register({ "HG-003": "PENDING_USER", "HG-004": "PENDING_USER" }),
      }),
    });
    expect(queue.actionable.map((w) => w.proposal.id)).not.toContain("CAP-DEBT-ECOS");
    const ecos = queue.deferred.find((w) => w.proposal.id === "CAP-DEBT-ECOS");
    expect(ecos?.authority).toBe("REQUIRES_HUMAN");
    expect(ecos?.blockedBy).toContain("HG-003");
    expect(gateDeferrals.some((d) => d.proposalId === "CAP-DEBT-ECOS")).toBe(true);
  });

  it("names the provider in the reason when the key is what is missing", () => {
    // HG-003 resolved, key absent: the remaining blocker is the credential, and it says so.
    const { queue } = scheduleAutonomousWork({
      probe: probe({ gateRegister: () => register({ "HG-003": "RESOLVED" }) }),
    });
    const ecos = queue.deferred.find((w) => w.proposal.id === "CAP-DEBT-ECOS");
    expect(ecos?.authority).toBe("BLOCKED_BY_ENVIRONMENT");
    expect(ecos?.governance.some((t) => t.provider === "ECOS")).toBe(true);
  });

  it("still holds everything closed when no key is present at all", () => {
    // The IR-126 property, re-asserted through the new contract: per-provider facts must not have
    // opened a path that the conjunction used to close.
    const { queue } = scheduleAutonomousWork({
      probe: probe({
        gateRegister: () => register({ "HG-003": "RESOLVED", "HG-004": "RESOLVED" }),
      }),
    });
    expect(queue.actionable).toEqual([]);
    expect(queueVerdict({ ...scheduleAutonomousWork({ probe: probe() }) }).verdict).toBe(
      "NO_SAFE_MEANINGFUL_NODE",
    );
  });
});
