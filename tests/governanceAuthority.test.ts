import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { capabilityGapProposals } from "@/server/evolution/proposal";
import { CAPABILITY_AXES, PROVIDER_CAPABILITIES } from "@/server/fabric/providerCapability";
import {
  AUTHORITY_BEARING_STATUS,
  authorizingGateFor,
  liveUseAuthorization,
  PROVIDERS_REQUIRING_AUTHORIZATION,
  quarantinedGates,
  UNAUTHORIZED_OBSERVATION_MARKER,
} from "@/server/fabric/providerAuthorization";
import { parseGateRegister, scheduleAutonomousWork } from "../scripts/autonomy-context";

/**
 * `OBSERVATION_IS_NOT_AUTHORIZATION`.
 *
 * On 2026-09-11 live ECOS and OpenDART responses were observed, all 56 capability cells moved onto
 * `LIVE_RESPONSE` evidence, and HG-003 and HG-004 were recorded `RESOLVED · LIVE_VERIFIED` on the
 * strength of that. The measurements were real. The conclusion was not: a Human Gate is a person's
 * decision, and watching a call succeed is not that person deciding it may be made.
 *
 * Two failures made it invisible. The register said the credentials were gates while a ledger
 * entry said they were closed, and nothing mechanical compared them. And every gated capability
 * proposal took its gate from a NOT_VERIFIED cell — so when the last unverified cell was measured
 * away, `blockedBy` disappeared with it and `CAP-FOLLOWUP-OPENDART`, whose required governance is
 * literally `CALL_FREE_PROVIDER`, became startable with nothing in front of it.
 *
 * Everything below reads the REAL durable state. No fixture register stands in for
 * `docs/HUMAN_GATE_QUEUE.md`, because a control that checks a copy is a control that passes while
 * the original drifts — which is the exact shape of the first failure.
 */

const REGISTER_PATH = "docs/HUMAN_GATE_QUEUE.md";
const registerText = () => readFileSync(REGISTER_PATH, "utf8");
const register = () => parseGateRegister(registerText());

describe("the authority state of the two quarantined gates", () => {
  it("records HG-003 and HG-004 as pending, not resolved", () => {
    const parsed = register();
    for (const gate of ["HG-003", "HG-004"]) {
      expect(parsed.get(gate), `${gate} must not be authority-bearing`).not.toBe(
        AUTHORITY_BEARING_STATUS,
      );
      expect(parsed.get(gate), `${gate} must be present and pending`).toBe("PENDING_USER");
    }
  });

  it("keeps the observation on the record rather than pretending it did not happen", () => {
    // The other half of the correction, and the one it would be easy to skip. The requests were
    // made; deleting the evidence would replace a governance failure with a false record. What
    // changes is the disposition of the evidence, not its existence.
    const text = registerText();
    expect(quarantinedGates(text).sort()).toEqual(["HG-003", "HG-004"]);
    expect(text).toContain("17 of 17");
    expect(text).toContain("28 of 28");
  });

  /**
   * THE DISCRIMINATION.
   *
   * A gate whose section admits its evidence was gathered without authority may not simultaneously
   * claim that evidence resolved it. Flipping either half alone turns this red: mark HG-003
   * `RESOLVED` again and this fails; delete the marker to avoid that and the control above fails
   * because the audit fact went missing. Both together are the only way through, and both together
   * are a person having actually decided.
   */
  it("forbids any gate from being resolved while its evidence is marked unauthorized", () => {
    const parsed = register();
    for (const gate of quarantinedGates(registerText())) {
      expect(
        parsed.get(gate),
        `${gate} carries ${UNAUTHORIZED_OBSERVATION_MARKER} and is also ${AUTHORITY_BEARING_STATUS}: ` +
          "an unauthorized observation cannot be the thing that closes the gate it was taken without",
      ).not.toBe(AUTHORITY_BEARING_STATUS);
    }
  });
});

describe("where live-use authority comes from", () => {
  it("comes from the register, and the module cannot even see the matrix", () => {
    // Structural, not a promise. The boundary is that `providerAuthorization` has no access to a
    // capability measurement — so no future edit can quietly let one count as permission without
    // first adding an import that this assertion refuses.
    const source = readFileSync("src/server/fabric/providerAuthorization.ts", "utf8");
    // Comment-stripped, because the module says IN PROSE that it does not import the matrix, and
    // the first version of this assertion failed on that sentence. Scanning raw text for the
    // forbidden name reports the denial as the offence, which this project has now done five
    // times; the affirmative form is what must be absent, and the denial is asserted separately.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/gm, "$1");
    expect(code).not.toContain("providerCapability");
    expect(code).not.toContain("CAPABILITY_AXES");
    expect(source, "the boundary should be stated where a reader will meet it").toContain(
      "GATE REGISTER and from nothing else",
    );
  });

  it("refuses ECOS and OpenDART right now, with a reason a person can act on", () => {
    const parsed = register();
    for (const provider of ["ECOS", "OPENDART"]) {
      const decision = liveUseAuthorization(provider, parsed);
      expect(decision.state, `${provider} must not be callable`).toBe("NOT_AUTHORIZED");
      expect(decision.because).toContain("PENDING_USER");
    }
  });

  it("still authorizes FRED, whose gate a person really did close", () => {
    // The control that stops this from being a blanket refusal dressed as a boundary. HG-002 was
    // granted by the user on 2026-09-06 and nothing about this incident touches it.
    expect(liveUseAuthorization("FRED", register()).state).toBe("AUTHORIZED");
  });

  it("treats an unreadable or silent register as unknown, never as permission", () => {
    expect(liveUseAuthorization("ECOS", null).state).toBe("UNKNOWN");
    expect(liveUseAuthorization("ECOS", new Map()).state).toBe("UNKNOWN");
    // And a provider that needs no credential is answered NOT_REQUIRED rather than UNKNOWN, so a
    // keyless surface is not held by a gate that does not exist.
    expect(liveUseAuthorization("SEC_EDGAR", register()).state).toBe("NOT_REQUIRED");
    expect(authorizingGateFor("SEC_EDGAR")).toBeUndefined();
  });

  it("does not change its answer when every capability cell is live", () => {
    // The claim in one assertion. The matrix is fully observed — 56 of 56 on `LIVE_RESPONSE` — and
    // ECOS is still not callable. Measurement and permission are independent, and this is what
    // that independence looks like when it is working.
    const live = PROVIDER_CAPABILITIES.flatMap((p) =>
      CAPABILITY_AXES.filter((a) => p.axes[a].provenance === "LIVE_RESPONSE"),
    );
    expect(live.length).toBe(PROVIDER_CAPABILITIES.length * CAPABILITY_AXES.length);
    expect(liveUseAuthorization("ECOS", register()).state).toBe("NOT_AUTHORIZED");
  });
});

describe("what the scheduler will let run", () => {
  it("gates every proposal that would call a credentialed provider", () => {
    // The regression this repair exists for. Before it, three provider-calling proposals named no
    // gate at all, because a gate was only ever derived from a NOT_VERIFIED cell and none remained.
    const calling = capabilityGapProposals().filter(
      (p) => p.requiredGovernance.includes("CALL_FREE_PROVIDER") && p.provider !== undefined,
    );
    expect(calling.length).toBeGreaterThan(0);
    for (const proposal of calling) {
      const needsGate = PROVIDERS_REQUIRING_AUTHORIZATION.some((p) => p === proposal.provider);
      if (!needsGate) continue;
      expect(
        proposal.blockedBy,
        `${proposal.id} would call ${String(proposal.provider)} and names no gate`,
      ).toBe(authorizingGateFor(String(proposal.provider)));
    }
  });

  it("holds OpenDART's follow-up closed against the real register", () => {
    // Through the real autonomy path, with the real documents, and with every key present — so
    // that a credential being available cannot be mistaken for the thing that unblocks it.
    const { queue } = scheduleAutonomousWork({
      probe: {
        env: { FRED_API_KEY: "x", ECOS_API_KEY: "x", DART_API_KEY: "x" },
        gateRegister: () => registerText(),
        stateDocument: () => "# Project state\n\nnothing exhausted here\n",
        githubAuth: () => "AUTHENTICATED",
      },
    });
    expect(queue.actionable.map((w) => w.proposal.id)).not.toContain("CAP-FOLLOWUP-OPENDART");
    const held = queue.deferred.find((w) => w.proposal.id === "CAP-FOLLOWUP-OPENDART");
    expect(held, "CAP-FOLLOWUP-OPENDART must be present and deferred").toBeDefined();
    expect(held?.authority).toBe("REQUIRES_HUMAN");
    expect(held?.blockedBy).toContain("HG-004");
  });

  it("does not hold work that needs no provider", () => {
    // Fail-closed must not become fail-everything. The keyless SEC surface is still startable, and
    // productization work with no provider dependency is unaffected by any of this.
    const { queue } = scheduleAutonomousWork({
      probe: {
        env: {},
        gateRegister: () => registerText(),
        stateDocument: () => "# Project state\n\nnothing exhausted here\n",
        githubAuth: () => "AUTHENTICATED",
      },
    });
    expect(queue.actionable.map((w) => w.proposal.id)).toContain("CAP-FOLLOWUP-SEC_EDGAR");
  });
});
