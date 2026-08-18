import { fetchWithTimeout } from "../httpTimeout";
import {
  padCik,
  type EdgarRecentFilings,
  type EdgarSubmissionsOverflow,
  type EdgarSubmissionsResponse,
} from "./types";

export class EdgarUserAgentMissingError extends Error {
  constructor() {
    super(
      "EDGAR_USER_AGENT is not set. SEC requires a descriptive User-Agent identifying the " +
        'requester (e.g. "Market OS contact@example.com") for fair-access compliance — see ' +
        "https://www.sec.gov/search-filings/edgar-application-programming-interfaces. " +
        "Copy .env.example to .env and set it (a real contact identity is a Human Gate per " +
        "docs/DATA_POLICY.md).",
    );
  }
}

export class EdgarApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Fetches raw submissions data for one company. No API key is required, unlike FRED/ECOS/DART
 * — SEC EDGAR instead requires a descriptive User-Agent header (fair-access policy). Returns
 * the untouched API response — no normalization or interpretation.
 */
export async function fetchEdgarSubmissions(cik: string): Promise<EdgarSubmissionsResponse> {
  const userAgent = process.env.EDGAR_USER_AGENT;
  if (!userAgent) {
    throw new EdgarUserAgentMissingError();
  }

  const url = `https://data.sec.gov/submissions/CIK${padCik(cik)}.json`;
  const response = await fetchWithTimeout(url, { headers: { "User-Agent": userAgent } });
  if (!response.ok) {
    throw new EdgarApiError(
      `SEC EDGAR request failed for CIK ${cik}: ${response.status} ${response.statusText}`,
      response.status,
    );
  }

  return (await response.json()) as EdgarSubmissionsResponse;
}

/** Hard stop on overflow fetching, so a filer with an absurd history cannot run unbounded. */
const MAX_OVERFLOW_FILES = 20;

export interface EdgarFilingHistory {
  /** Company metadata, taken from the primary submissions document. */
  cik: string;
  name: string;
  /** Every filing across `filings.recent` AND every overflow file, in one parallel-array set. */
  filings: EdgarRecentFilings;
  recentCount: number;
  /**
   * What SEC itself says the company has: `filings.recent` plus the declared `filingCount` of
   * every overflow file, fetched or not. The number to check a stored count against.
   */
  providerTotal: number;
  overflowFilesAvailable: number;
  overflowFilesFetched: number;
  /** True when SEC listed more overflow files than this run was willing to fetch. */
  truncated: boolean;
}

/**
 * Fetches a company's COMPLETE filing history, not just the most recent 1000.
 *
 * `filings.recent` is hard-capped by SEC at 1000 entries; everything older spills into
 * `filings.files[]`, each naming another JSON document under the same /submissions/ path. The
 * ingest previously read `recent` alone and treated it as the company's filing history. For
 * Apple that meant storing exactly 1000 filings back to 2015 and silently dropping 1240 more
 * covering 1994-2015 — 55% of the history, absent without a word.
 *
 * That the stored count was exactly 1000 is the tell, and it is worth stating plainly: the live
 * contract check that ran the day before verified the SHAPE of the response and reported
 * "1000 recent filings" as an informational line. Shape verification is not completeness
 * verification, and a round number should have been read as a cap rather than a total.
 *
 * Overflow documents use the same parallel-array layout as `recent` but at the top level, with
 * no enclosing `filings` wrapper (verified live 2026-08-17).
 */
export async function fetchEdgarFilingHistory(cik: string): Promise<EdgarFilingHistory> {
  const userAgent = process.env.EDGAR_USER_AGENT;
  if (!userAgent) {
    throw new EdgarUserAgentMissingError();
  }

  const submissions = await fetchEdgarSubmissions(cik);
  const recent = submissions.filings.recent;
  const merged: EdgarRecentFilings = cloneFilings(recent);

  const overflowFiles = submissions.filings.files ?? [];
  const toFetch = overflowFiles.slice(0, MAX_OVERFLOW_FILES);

  for (const file of toFetch) {
    // `file.name` comes from SEC's response, not from us. Interpolating a third-party string
    // into a URL is how a path traversal ("../../…") or an absolute URL becomes a request to
    // somewhere else entirely — a small SSRF surface, and not one worth leaving open just
    // because the third party is trustworthy today. Constrain it to the filename shape SEC
    // actually documents and uses.
    if (!/^CIK\d{10}-submissions-\d{3}\.json$/.test(file.name)) {
      throw new EdgarApiError(
        `SEC EDGAR returned an unexpected overflow filename ${JSON.stringify(file.name)}. ` +
          "Refusing to fetch it — this is either schema drift or something worse.",
        0,
      );
    }
    const url = `https://data.sec.gov/submissions/${file.name}`;
    const response = await fetchWithTimeout(url, { headers: { "User-Agent": userAgent } });
    if (!response.ok) {
      throw new EdgarApiError(
        `SEC EDGAR overflow request failed for ${file.name}: ${response.status} ${response.statusText}`,
        response.status,
      );
    }
    appendFilings(merged, (await response.json()) as EdgarSubmissionsOverflow);
  }

  // SEC does not publish a single "total filings" number, but it publishes the pieces: the length
  // of `filings.recent` plus the `filingCount` SEC declares on EVERY overflow file — including
  // ones this run chose not to fetch, because the question is what the provider says exists, not
  // what we collected. Summing them is what makes completeness checkable instead of assumed.
  //
  // Without this, every EDGAR run stored providerTotal NULL, and the Company X-Ray page told
  // readers the ingest "retrieved everything the provider reported" on the strength of no
  // evidence at all (independent review, `gpt-5.6-terra`, 2026-08-18).
  const providerTotal =
    (recent.form?.length ?? 0) +
    overflowFiles.reduce((sum, file) => sum + (file.filingCount ?? 0), 0);

  return {
    cik: submissions.cik,
    name: submissions.name,
    filings: merged,
    recentCount: recent.form?.length ?? 0,
    providerTotal,
    overflowFilesAvailable: overflowFiles.length,
    overflowFilesFetched: toFetch.length,
    // Two ways to be short, and only the first was reported (IR-038). Hitting our own page cap is
    // one. The other is holding fewer filings than SEC says exist — a short overflow document, a
    // partial mirror, or SEC's own `filingCount` drifting from what it serves — and that was
    // reported as complete, because the question being asked was "did WE stop early?" rather than
    // "do we have it all?".
    //
    // The same defect as IR-030 in FRED, ECOS and DART. Those three were fixed together and EDGAR
    // was not part of that finding, which is why it survived: the fix went where the defect had
    // been looked for. This is the live path — EDGAR is the only provider with real data — so
    // unlike the other latent identity findings this one had a reader in front of it.
    //
    // `providerTotal` above already sums `filings.recent` and the declared `filingCount` of every
    // overflow file, INCLUDING the ones this run chose not to fetch. Everything needed to answer
    // the question was already computed and never compared.
    truncated:
      overflowFiles.length > MAX_OVERFLOW_FILES || (merged.form?.length ?? 0) < providerTotal,
  };
}

/**
 * The parallel-array field list, in one place. Every field must be copied and appended in
 * lockstep — dropping one here would misalign the arrays, which is the single failure mode this
 * layout is vulnerable to and the reason the live contract check asserts equal lengths.
 */
const FILING_ARRAY_FIELDS = [
  "accessionNumber",
  "filingDate",
  "reportDate",
  "acceptanceDateTime",
  "act",
  "form",
  "fileNumber",
  "filmNumber",
  "items",
  "size",
  "isXBRL",
  "isInlineXBRL",
  "primaryDocument",
  "primaryDocDescription",
] as const satisfies readonly (keyof EdgarRecentFilings)[];

function cloneFilings(source: EdgarRecentFilings): EdgarRecentFilings {
  const out = {} as EdgarRecentFilings;
  for (const field of FILING_ARRAY_FIELDS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (out as any)[field] = [...((source[field] ?? []) as unknown[])];
  }
  return out;
}

function appendFilings(target: EdgarRecentFilings, extra: EdgarSubmissionsOverflow): void {
  for (const field of FILING_ARRAY_FIELDS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (target as any)[field].push(...((extra[field] ?? []) as unknown[]));
  }
}
