/**
 * Whether this installation may CALL a provider right now, which is a different question from
 * whether it knows what that provider returns.
 *
 * This module exists because the two were conflated once, in a way no mechanism noticed. On
 * 2026-09-11 live ECOS and OpenDART responses were observed, every capability cell moved onto
 * `LIVE_RESPONSE` evidence, and HG-003 and HG-004 were recorded `RESOLVED · LIVE_VERIFIED` on the
 * strength of that. The measurement was real and the conclusion did not follow: a Human Gate is a
 * person's decision, and observing that a call succeeds is not the person deciding it may be made.
 *
 * So the boundary is drawn structurally rather than by discipline:
 *
 *   **Authorization is derived from the GATE REGISTER and from nothing else.**
 *
 * Nothing here imports `providerCapability`, and a test asserts it never will. A capability
 * measurement may be as live and as complete as you like; it is an input to no function in this
 * file. The register is the only source, because the register is the only place a person writes.
 *
 * The converse is equally deliberate. Quarantining the AUTHORITY does not quarantine the FACT:
 * the observations happened, they are recorded, and they remain usable as technical evidence
 * about what those APIs return. `KEEP_THE_AUDIT_FACT_REVOKE_THE_GATE_CLAIM`.
 */

/** Providers whose live use needs a person's decision, because using one spends a credential. */
export const PROVIDERS_REQUIRING_AUTHORIZATION = ["FRED", "ECOS", "OPENDART"] as const;

export type AuthorizedProvider = (typeof PROVIDERS_REQUIRING_AUTHORIZATION)[number];

/**
 * The gate that authorizes live use of each provider.
 *
 * SEC_EDGAR is deliberately absent rather than mapped to nothing: its public read-only surface
 * needs no credential at all (IR-132), so there is no gate to satisfy and no entry to look up.
 * An absent provider is answered by `authorizingGateFor` returning `undefined`, which callers must
 * read as "no authorization is required", not as "authorization is unknown".
 */
const AUTHORIZING_GATE: Record<AuthorizedProvider, string> = {
  FRED: "HG-002",
  ECOS: "HG-003",
  OPENDART: "HG-004",
};

/**
 * The marker a gate section carries when a live observation of that provider exists but was made
 * WITHOUT the gate having been granted.
 *
 * It is the load-bearing half of the reconciliation. The observation cannot be unmade and must not
 * be falsified, so it stays recorded; what it must never do is read as permission. A gate carrying
 * this marker is therefore forbidden from also being `RESOLVED`, and `tests/governanceAuthority.test.ts`
 * asserts both halves against the real register: the marker is present, and no gate carrying it is
 * resolved. Flipping one back without removing the other turns that acceptance RED.
 */
export const UNAUTHORIZED_OBSERVATION_MARKER =
  "UNAUTHORIZED_LIVE_OBSERVATION__NOT_HUMAN_GATE_AUTHORITY";

/** The one status string in the register that grants authority. Anything else does not. */
export const AUTHORITY_BEARING_STATUS = "RESOLVED";

export type LiveUseState =
  /** A person recorded the gate as resolved. */
  | "AUTHORIZED"
  /** The gate exists and is not resolved. */
  | "NOT_AUTHORIZED"
  /** The register could not be read, or does not carry this gate. Never treated as permission. */
  | "UNKNOWN"
  /** No credential is involved, so there is nothing to authorize. */
  | "NOT_REQUIRED";

export interface LiveUseDecision {
  state: LiveUseState;
  because: string;
}

/** The gate that would authorize this provider, or `undefined` when none is required. */
export function authorizingGateFor(provider: string): string | undefined {
  return AUTHORIZING_GATE[provider as AuthorizedProvider];
}

/**
 * May this provider be called live?
 *
 * @param provider source code, e.g. `ECOS`
 * @param register the parsed gate register, or `null` when it could not be read
 */
export function liveUseAuthorization(
  provider: string,
  register: Map<string, string> | null,
): LiveUseDecision {
  const gate = authorizingGateFor(provider);
  if (gate === undefined) {
    return {
      state: "NOT_REQUIRED",
      because: `${provider} has no credentialed surface behind a gate, so nothing authorizes it.`,
    };
  }
  if (register === null) {
    return {
      state: "UNKNOWN",
      because: `The gate register could not be read, so ${gate} is unknown — and unknown is not resolved.`,
    };
  }
  const status = register.get(gate);
  if (status === undefined) {
    return {
      state: "UNKNOWN",
      because: `The gate register does not carry ${gate}, so its status is unknown rather than implicitly granted.`,
    };
  }
  if (status !== AUTHORITY_BEARING_STATUS) {
    return {
      state: "NOT_AUTHORIZED",
      because: `${gate} is ${status}, and only ${AUTHORITY_BEARING_STATUS} authorizes a live call.`,
    };
  }
  return { state: "AUTHORIZED", because: `${gate} is ${status} in the register.` };
}

/**
 * The gates whose sections carry the unauthorized-observation marker, read off the register TEXT.
 *
 * Takes the raw document rather than the parsed map, because the marker lives in the prose of a
 * section and the parser deliberately keeps only the first status per heading. Both readings of
 * the same file, which is the point: a reconciliation that satisfied one and not the other would
 * be exactly the divergence this repair is about.
 */
export function quarantinedGates(registerText: string): string[] {
  const gates: string[] = [];
  const sections = registerText.split(/^## /m);
  for (const section of sections) {
    const heading = /^(HG-\d{3})\b/.exec(section);
    if (heading === null) continue;
    if (section.includes(UNAUTHORIZED_OBSERVATION_MARKER)) gates.push(heading[1]);
  }
  return [...new Set(gates)];
}
