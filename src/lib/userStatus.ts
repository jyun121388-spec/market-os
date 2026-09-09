import type { SystemHealth } from "@/server/domain/systemHealth";

/**
 * The operator dashboard, translated for the person who owns the installation.
 *
 * `/admin` stays operator-only and is not the answer to this problem: it prints raw ingest error
 * strings, provider targets and run internals, which is right for whoever is debugging the
 * pipeline and wrong for everybody else. This module is the translation layer, and it is a PURE
 * function so the thing that matters about it can be tested rather than promised.
 *
 * WHAT MATTERS ABOUT IT: `IngestRunHealth.error` is a raw string from an adapter. It has
 * contained connection strings, absolute paths and stack traces, and the whole point of a
 * user-facing status page is that none of that reaches it. So this builder NEVER copies `error`
 * into its output — it reports THAT a run failed and for which provider, in a sentence it wrote
 * itself. A control feeds it an error containing a password, a path, a PID and a stack frame and
 * asserts none of them survive.
 */

/**
 * The same three states the company index already uses, plus the one it does not need.
 *
 * Reused deliberately rather than re-invented: a reader who learns what `CONFIGURED_NO_DATA` means
 * on one page should not meet a different vocabulary for the same idea on another.
 * `EXTERNALLY_GATED` is the fourth, for a capability that is not a data provider at all and cannot
 * be enabled by configuring one.
 */
export type ProviderState =
  "HAS_DATA" | "CONFIGURED_NO_DATA" | "NOT_CONFIGURED" | "EXTERNALLY_GATED";

export type OverallState = "HEALTHY" | "DEGRADED" | "NO_DATA";

export interface UserProviderStatus {
  sourceCode: string;
  /** What this provider is, in the terms a reader thinks in. */
  label: string;
  state: ProviderState;
  /** Optional providers are a setup choice, not a fault. Saying so is the difference. */
  optional: boolean;
  detail: string;
  /** YYYY-MM-DD of the last time anything was stored from it, or null. Date only, never a time. */
  lastUpdate: string | null;
}

export type IssueKind = "FAILED_INGEST" | "PARTIAL_INGEST" | "STALE_DATA" | "DATA_CONFLICT";

export interface UserDataIssue {
  kind: IssueKind;
  sourceCode: string | null;
  detail: string;
}

export type CapabilityState =
  | "AVAILABLE"
  | "UNAVAILABLE_NO_DATA"
  | "UNAVAILABLE_NOT_CONFIGURED"
  | "EXTERNALLY_GATED"
  | "UNKNOWN";

export interface UserCapability {
  name: string;
  state: CapabilityState;
  detail: string;
}

export interface UserStatus {
  overall: OverallState;
  overallDetail: string;
  providers: UserProviderStatus[];
  issues: UserDataIssue[];
  capabilities: UserCapability[];
}

/**
 * Every provider this V1 knows about, and whether it is required.
 *
 * SEC EDGAR needs no credential — its public read surface was scoped keyless in IR-132 — so it can
 * never be `NOT_CONFIGURED`. The other three are optional: an installation with only US filings is
 * a smaller Market OS, not a broken one, and the status page has to say that rather than showing
 * three red rows.
 */
const PROVIDERS: { sourceCode: string; label: string; needsKey: boolean }[] = [
  { sourceCode: "SEC_EDGAR", label: "US company filings (SEC EDGAR)", needsKey: false },
  { sourceCode: "FRED", label: "US economic indicators (FRED)", needsKey: true },
  { sourceCode: "DART", label: "Korean company filings (DART)", needsKey: true },
  { sourceCode: "ECOS", label: "Korean economic indicators (Bank of Korea)", needsKey: true },
];

export interface UserStatusInput {
  health: SystemHealth;
  /** Presence only. A value must never reach this module, so the type cannot carry one. */
  configured: Record<string, boolean>;
  /** Indicator series held, and how many are stale against their own cadence. */
  indicators: { total: number; stale: number; cadenceUnknown: number };
  /** Whether the answer-writing model capability is enabled. False in V1 (HG-006). */
  generationEnabled: boolean;
}

const isoDate = (iso: string | null): string | null => (iso ? iso.slice(0, 10) : null);

function providerStatus(
  def: (typeof PROVIDERS)[number],
  input: UserStatusInput,
): UserProviderStatus {
  const source = input.health.sources.find((s) => s.sourceCode === def.sourceCode);
  const lastUpdate = isoDate(source?.lastIngestAt ?? null);
  const hasData = lastUpdate !== null;
  const configured = def.needsKey ? input.configured[def.sourceCode] === true : true;

  if (hasData) {
    return {
      sourceCode: def.sourceCode,
      label: def.label,
      state: "HAS_DATA",
      optional: def.needsKey,
      lastUpdate,
      detail: `Data from this provider is stored here. Last updated ${lastUpdate}.`,
    };
  }
  if (!configured) {
    return {
      sourceCode: def.sourceCode,
      label: def.label,
      state: "NOT_CONFIGURED",
      optional: true,
      lastUpdate: null,
      // A setup step, said as one. "Not configured" reads as broken unless something says it is a
      // choice, and three unconfigured optional providers would otherwise look like three faults.
      detail:
        "This provider is optional and has not been set up, so none of its data is available. " +
        "Nothing is wrong with the installation.",
    };
  }
  return {
    sourceCode: def.sourceCode,
    label: def.label,
    state: "CONFIGURED_NO_DATA",
    optional: def.needsKey,
    lastUpdate: null,
    detail: "This provider is set up, but nothing has been fetched from it yet.",
  };
}

/**
 * The user-safe view. No argument to this function can carry a secret, and no field of the result
 * is copied from an adapter's error string.
 */
export function buildUserStatus(input: UserStatusInput): UserStatus {
  const providers = PROVIDERS.map((def) => providerStatus(def, input));

  const issues: UserDataIssue[] = [];

  for (const run of input.health.recentRuns) {
    // `run.error` is NEVER read. What a reader needs is that a fetch failed and from where; the
    // adapter's own message is for `/admin`, where an operator can act on it.
    if (run.status === "FAILED") {
      issues.push({
        kind: "FAILED_INGEST",
        sourceCode: run.sourceCode,
        detail:
          `The last attempt to fetch data from ${run.sourceCode} did not finish. Existing stored ` +
          "data is unaffected; it may simply be older than expected.",
      });
    } else if (run.truncated || run.status === "PARTIAL") {
      issues.push({
        kind: "PARTIAL_INGEST",
        sourceCode: run.sourceCode,
        detail:
          `Only part of what ${run.sourceCode} offers was stored, so its history here is known to ` +
          "be incomplete.",
      });
    }
  }

  if (input.indicators.stale > 0) {
    issues.push({
      kind: "STALE_DATA",
      sourceCode: null,
      detail:
        `${input.indicators.stale} of ${input.indicators.total} indicators are older than their ` +
        "own usual release interval. Market OS withholds a stale reading rather than presenting " +
        "it as current, so those will not appear in answers.",
    });
  }

  if (input.health.unresolvedDataConflicts > 0) {
    issues.push({
      kind: "DATA_CONFLICT",
      sourceCode: null,
      detail:
        `${input.health.unresolvedDataConflicts} stored figures disagree with each other and have ` +
        "not been resolved. Market OS refuses to pick one rather than showing a number it cannot " +
        "prove.",
    });
  }

  const anyData = providers.some((p) => p.state === "HAS_DATA");
  const overall: OverallState = !anyData ? "NO_DATA" : issues.length > 0 ? "DEGRADED" : "HEALTHY";
  const overallDetail =
    overall === "NO_DATA"
      ? "Market OS is running, but no provider has stored any data yet. Set one up to begin."
      : overall === "DEGRADED"
        ? "Market OS is running and serving what it can prove. Some data is missing, stale or " +
          "incomplete — the details are below."
        : "Market OS is running and every provider with data is up to date.";

  const capabilities: UserCapability[] = [
    capability(
      "Company filings and evidence",
      providers.find((p) => p.sourceCode === "SEC_EDGAR")!,
      providers.find((p) => p.sourceCode === "DART")!,
    ),
    capability(
      "Macro indicators and regime",
      providers.find((p) => p.sourceCode === "FRED")!,
      providers.find((p) => p.sourceCode === "ECOS")!,
    ),
    {
      name: "Written answers in Ask Market",
      // Not a data problem and not fixable by configuring a provider, so it gets its own state
      // rather than being folded into "unavailable".
      state: input.generationEnabled ? "AVAILABLE" : "EXTERNALLY_GATED",
      detail: input.generationEnabled
        ? "Enabled."
        : "Not enabled in this installation. Ask Market still returns stored figures with their " +
          "sources; it will not compose them into written prose.",
    },
  ];

  return { overall, overallDetail, providers, issues, capabilities };
}

/** A capability backed by two providers is available when either one has data. */
function capability(name: string, a: UserProviderStatus, b: UserProviderStatus): UserCapability {
  if (a.state === "HAS_DATA" || b.state === "HAS_DATA") {
    return { name, state: "AVAILABLE", detail: "Data is stored and this feature works." };
  }
  if (a.state === "CONFIGURED_NO_DATA" || b.state === "CONFIGURED_NO_DATA") {
    return {
      name,
      state: "UNAVAILABLE_NO_DATA",
      detail: "A provider is set up but nothing has been fetched yet, so there is nothing to show.",
    };
  }
  return {
    name,
    state: "UNAVAILABLE_NOT_CONFIGURED",
    detail: "No provider for this feature has been set up.",
  };
}
