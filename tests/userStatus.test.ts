import { describe, expect, it } from "vitest";
import type { IngestRunHealth, SystemHealth } from "@/server/domain/systemHealth";
import { buildUserStatus, type UserStatusInput } from "@/lib/userStatus";

/**
 * The user-facing status page, tested where it matters.
 *
 * Two things are worth testing here and the rest is presentation: that a state a reader will act
 * on is distinguished from one they should ignore, and that nothing an adapter wrote can reach the
 * screen. The second is the load-bearing one — `IngestRunHealth.error` is a raw string and has
 * carried connection strings, absolute paths and stack traces.
 */

const run = (over: Partial<IngestRunHealth> = {}): IngestRunHealth => ({
  sourceCode: "FRED",
  target: "CPIAUCSL",
  status: "SUCCESS",
  finishedAt: "2026-09-01T10:00:00.000Z",
  inserted: 10,
  unchanged: 0,
  skipped: 0,
  fetched: 10,
  providerTotal: 10,
  truncated: false,
  error: null,
  ...over,
});

const health = (over: Partial<SystemHealth> = {}): SystemHealth => ({
  sources: [],
  unresolvedDataConflicts: 0,
  recentRuns: [],
  incompleteRuns: 0,
  ...over,
});

const input = (over: Partial<UserStatusInput> = {}): UserStatusInput => ({
  health: health(),
  configured: { FRED: false, DART: false, ECOS: false },
  indicators: { total: 0, stale: 0, cadenceUnknown: 0 },
  generationEnabled: false,
  ...over,
});

const withData = (sourceCode: string, lastIngestAt: string) => ({
  sourceCode,
  sourceName: sourceCode,
  tier: "TIER_S",
  lastIngestAt,
});

const provider = (s: ReturnType<typeof buildUserStatus>, code: string) =>
  s.providers.find((p) => p.sourceCode === code)!;

/** Every string anywhere in the result, so a leak cannot hide in a nested field. */
function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) allStrings(v, out);
  else if (value && typeof value === "object")
    for (const v of Object.values(value)) allStrings(v, out);
  return out;
}

describe("user-facing status", () => {
  // ---------------------------------------------------------------- G
  it("G: nothing an adapter wrote in an error reaches the user", () => {
    // Everything a real ingest error has actually contained at some point in this repository.
    const SECRETS = [
      "postgresql://market_os:hunter2@127.0.0.1:55432/market_os_dev",
      "C:\\AI-Projects\\market-os\\.env",
      "abcdef0123456789abcdef0123456789",
      "at Object.<anonymous> (/app/src/server/adapters/fred/client.ts:42:11)",
      "pid 18448",
      "FRED_API_KEY",
    ];
    const status = buildUserStatus(
      input({
        health: health({
          sources: [withData("FRED", "2026-09-01T10:00:00.000Z")],
          recentRuns: [run({ status: "FAILED", error: SECRETS.join(" | ") })],
        }),
        configured: { FRED: true, DART: false, ECOS: false },
      }),
    );

    const haystack = allStrings(status).join(" \n ");
    for (const secret of SECRETS) {
      expect(haystack.includes(secret), `"${secret.slice(0, 40)}" leaked into user status`).toBe(
        false,
      );
    }
    // ...and the failure is still REPORTED. Redaction that hides the problem is not redaction.
    expect(status.issues.some((i) => i.kind === "FAILED_INGEST")).toBe(true);
  });

  // ---------------------------------------------------------------- D
  it("D: a failed ingest is visible, in a sentence this module wrote", () => {
    const status = buildUserStatus(
      input({
        health: health({
          sources: [withData("FRED", "2026-09-01T10:00:00.000Z")],
          recentRuns: [run({ status: "FAILED", error: "ECONNREFUSED 127.0.0.1:443" })],
        }),
        configured: { FRED: true, DART: false, ECOS: false },
      }),
    );
    const issue = status.issues.find((i) => i.kind === "FAILED_INGEST")!;
    expect(issue.sourceCode).toBe("FRED");
    expect(issue.detail).toContain("did not finish");
    expect(issue.detail).not.toContain("ECONNREFUSED");
    // Existing data is not implied to be wrong by a failed refresh.
    expect(issue.detail).toContain("Existing stored data is unaffected");
  });

  // ---------------------------------------------------------------- C
  it("C: a partial ingest is visibly partial, not merely 'ok'", () => {
    const status = buildUserStatus(
      input({
        health: health({
          sources: [withData("SEC_EDGAR", "2026-09-01T10:00:00.000Z")],
          recentRuns: [run({ sourceCode: "SEC_EDGAR", truncated: true })],
        }),
      }),
    );
    expect(status.issues.find((i) => i.kind === "PARTIAL_INGEST")?.detail).toContain(
      "known to be incomplete",
    );
  });

  // ---------------------------------------------------------------- B
  it("B: stale data is preserved as stale, and explains why it disappears from answers", () => {
    const status = buildUserStatus(
      input({
        health: health({ sources: [withData("FRED", "2026-09-01T10:00:00.000Z")] }),
        configured: { FRED: true, DART: false, ECOS: false },
        indicators: { total: 11, stale: 11, cadenceUnknown: 0 },
      }),
    );
    const stale = status.issues.find((i) => i.kind === "STALE_DATA")!;
    expect(stale.detail).toContain("11 of 11");
    // The connection a reader needs: this is WHY Ask Market said it had nothing.
    expect(stale.detail).toContain("withholds a stale reading");
  });

  // ---------------------------------------------------------------- E / F
  it("E: a missing optional provider is a setup choice, not a broken system", () => {
    const status = buildUserStatus(
      input({ health: health({ sources: [withData("SEC_EDGAR", "2026-09-01T10:00:00.000Z")] }) }),
    );
    const dart = provider(status, "DART");
    expect(dart.state).toBe("NOT_CONFIGURED");
    expect(dart.optional).toBe(true);
    expect(dart.detail).toContain("Nothing is wrong with the installation");
    // And the system overall is not called broken because an optional provider is absent.
    expect(status.overall).not.toBe("NO_DATA");
  });

  it("F: configured-but-empty is a different state from not configured", () => {
    const status = buildUserStatus(
      input({
        health: health({ sources: [withData("SEC_EDGAR", "2026-09-01T10:00:00.000Z")] }),
        configured: { FRED: true, DART: false, ECOS: false },
      }),
    );
    expect(provider(status, "FRED").state).toBe("CONFIGURED_NO_DATA");
    expect(provider(status, "DART").state).toBe("NOT_CONFIGURED");
    expect(provider(status, "FRED").detail).toContain("nothing has been fetched from it yet");
  });

  it("SEC EDGAR needs no credential, so it can never read as unconfigured", () => {
    // IR-132 scoped its public read surface keyless. Showing it as "not set up" would send a
    // reader looking for a key that does not exist.
    const status = buildUserStatus(input());
    expect(provider(status, "SEC_EDGAR").state).toBe("CONFIGURED_NO_DATA");
    expect(provider(status, "SEC_EDGAR").optional).toBe(false);
  });

  // ---------------------------------------------------------------- A
  it("A: a healthy installation says so plainly", () => {
    const status = buildUserStatus(
      input({
        health: health({
          sources: [withData("SEC_EDGAR", "2026-09-09T10:00:00.000Z")],
          recentRuns: [run({ sourceCode: "SEC_EDGAR" })],
        }),
        indicators: { total: 3, stale: 0, cadenceUnknown: 0 },
      }),
    );
    expect(status.overall).toBe("HEALTHY");
    expect(status.issues).toEqual([]);
    expect(provider(status, "SEC_EDGAR").lastUpdate).toBe("2026-09-09");
  });

  it("an installation with no data at all is distinguished from a degraded one", () => {
    const status = buildUserStatus(input());
    expect(status.overall).toBe("NO_DATA");
    expect(status.overallDetail).toContain("no provider has stored any data yet");
  });

  it("reports a date, never a timestamp — a wall-clock time is operator detail", () => {
    const status = buildUserStatus(
      input({ health: health({ sources: [withData("FRED", "2026-09-01T10:34:56.789Z")] }) }),
    );
    expect(provider(status, "FRED").lastUpdate).toBe("2026-09-01");
    expect(allStrings(status).join(" ")).not.toContain("10:34:56");
  });

  it("the gated generation capability is its own state, not 'unavailable'", () => {
    const status = buildUserStatus(input());
    const gen = status.capabilities.find((c) => c.name.includes("Written answers"))!;
    expect(gen.state).toBe("EXTERNALLY_GATED");
    expect(gen.detail).toContain("will not compose them into written prose");
    // No instruction a normal user cannot follow.
    for (const forbidden of [".env", "npm", "API key", "PowerShell"]) {
      expect(allStrings(status).join(" ")).not.toContain(forbidden);
    }
  });

  it("a capability with no provider configured says so, rather than 'no data'", () => {
    // The distinction the company index already draws, kept consistent here.
    const status = buildUserStatus(input());
    const macro = status.capabilities.find((c) => c.name.includes("Macro"))!;
    expect(macro.state).toBe("UNAVAILABLE_NOT_CONFIGURED");
    const filings = status.capabilities.find((c) => c.name.includes("filings"))!;
    expect(filings.state).toBe("UNAVAILABLE_NO_DATA");
  });
});
