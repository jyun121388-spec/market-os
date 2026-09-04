/**
 * Shared harness for the `verify-*-live.ts` provider contract checks.
 *
 * Extracted from `scripts/verify-edgar-live.ts` after that script earned its keep: its first run
 * against real SEC endpoints found schema drift (nullable `fy`/`fp`) that fixtures written from
 * documentation had never exercised. Every remaining provider adapter in this repo was built the
 * same way — from docs, never from a real response — so each gets the same treatment.
 *
 * What these scripts assert is the CONTRACT, not the data: field presence, types, nullability,
 * date and unit formats, and the pagination/total fields that decide whether a result is
 * complete. They deliberately do not pin financial values, which legitimately change; a check
 * that broke every time a series updated would be noise, and noise gets ignored.
 *
 * All of them are read-only against the provider and write nothing to the database.
 */

export class ContractCheck {
  private failures = 0;
  private checks = 0;

  constructor(private readonly provider: string) {}

  section(name: string): void {
    console.log(`\n[${name}]`);
  }

  info(message: string): void {
    console.log(`  info  ${message}`);
  }

  check(label: string, condition: boolean, detail?: unknown): void {
    this.checks += 1;
    if (condition) {
      console.log(`  PASS  ${label}`);
    } else {
      this.failures += 1;
      const suffix = detail === undefined ? "" : ` — ${format(detail)}`;
      console.error(`  FAIL  ${label}${suffix}`);
    }
  }

  /**
   * Records something real but not contract-breaking — e.g. a filer that simply does not tag a
   * concept. Reported rather than failed, because misclassifying a true characteristic of the
   * data as a defect is how a check loses its credibility.
   */
  note(message: string): void {
    console.log(`  NOTE  ${message}`);
  }

  finish(): void {
    console.log(
      `\n${
        this.failures === 0
          ? `ALL ${this.checks} ${this.provider} CONTRACT CHECKS PASSED`
          : `${this.failures}/${this.checks} ${this.provider} CHECK(S) FAILED`
      }`,
    );
    if (this.failures > 0) process.exitCode = 1;
  }
}

function format(detail: unknown): string {
  return typeof detail === "string" ? detail : JSON.stringify(detail);
}

/**
 * Reads a required credential, or explains precisely how to get it and exits non-zero.
 *
 * Never invents, defaults, or substitutes a value. A contract check that runs against a fake
 * key produces a confident result about nothing, which is worse than not running: the point of
 * these scripts is to replace assumption with evidence.
 */
export function requireCredential(name: string, howToObtain: string): string | null {
  const value = process.env[name];
  if (value) return value;

  console.error(
    `${name} is not set, so this check cannot run.\n\n${howToObtain}\n\n` +
      "Obtaining and entering a real credential is a Human Gate (docs/DATA_POLICY.md). This " +
      "script will not fabricate one, and the provider stays classified LIVE_KEY_PENDING until " +
      "a real key produces a real result.",
  );
  process.exitCode = 1;
  return null;
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const COMPACT_DATE = /^\d{8}$/;

export function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

export function isNumberArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((x) => typeof x === "number");
}

/**
 * Reports every distinct non-numeric value seen in a field that the adapter treats as "a number
 * or a missing-value marker".
 *
 * This is the single highest-value thing these scripts do for FRED and ECOS. Both adapters
 * currently take the conservative line that anything non-numeric means "missing" — which is
 * safe, but means neither can distinguish a genuine gap from a marker nobody anticipated. The
 * real set of markers is knowable only from a real response.
 */
export function summariseNonNumericMarkers(values: Array<string | undefined>): string[] {
  const markers = new Set<string>();
  for (const v of values) {
    if (v === undefined || !Number.isFinite(Number(v)) || v.trim() === "") {
      markers.add(v === undefined ? "<undefined>" : JSON.stringify(v));
    }
  }
  return [...markers].sort();
}
