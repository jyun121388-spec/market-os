/**
 * Removes provider credentials from any string that might be logged, stored, or rendered.
 *
 * Found on 2026-08-17 while auditing the new IngestRun persistence. `HttpTimeoutError` embeds
 * the request URL in its message, and provider credentials live in those URLs:
 *
 *   - ECOS puts the API key in the PATH: `/api/StatisticSearch/{apiKey}/json/kr/...`
 *   - FRED puts it in a query parameter: `?api_key=...`
 *   - OpenDART likewise: `?crtfc_key=...`
 *
 * That was already reaching console output. Persisting ingest-run errors made it worse: the key
 * would have been written to `ingest_runs.error` and rendered on the authenticated /admin page,
 * turning a transient log line into a stored secret. `CLAUDE.md`'s "never commit secrets" rule
 * is about the same hazard one step earlier in the pipeline.
 *
 * Two layers, deliberately:
 *
 *  1. Redact the ACTUAL configured credential values wherever they appear. This is exact rather
 *     than pattern-based, so it works regardless of whether a provider puts its key in a path
 *     segment, a query parameter, or a header echoed back in an error body — including any
 *     provider added later that nobody remembered to add a pattern for.
 *  2. Redact known credential-bearing query parameters by name, which still helps if a key is
 *     somehow present without being the configured one (a stale value, a second account).
 */

/** Env vars holding a provider credential. Add new providers here. */
const CREDENTIAL_ENV_VARS = ["FRED_API_KEY", "ECOS_API_KEY", "DART_API_KEY"] as const;

/** Query parameters known to carry a credential, matched case-insensitively. */
const CREDENTIAL_QUERY_PARAMS = ["api_key", "apikey", "crtfc_key", "key", "token", "secret"];

export const REDACTED = "[REDACTED]";

/**
 * Prepares an error message for storage in `ingest_runs.error` and rendering on /admin.
 *
 * Redaction alone is not enough. Prisma's client errors embed a code frame: the absolute path of
 * the failing file and several lines of its source. Verified against a real connection failure —
 * the message opened with `Invalid \`client.source.findMany()\` invocation in
 * C:\...\file.ts:15:25` followed by numbered source lines. Persisting that puts local filesystem
 * layout and application source into a table rendered on an authenticated page, for no
 * diagnostic gain: the part an operator needs ("Can't reach database server at ...") survives
 * this stripping intact.
 *
 * The password itself does NOT appear in Prisma connection errors — checked, rather than
 * assumed — but `redactSecrets` still runs first, because any layer can produce the error that
 * ends up here.
 */
export function sanitiseErrorForStorage(text: string): string {
  const withoutSecrets = redactSecrets(text);

  const kept = withoutSecrets
    .split("\n")
    // Code-frame lines: "  12   const client = ..." and the "→ 15" pointer line.
    .filter((line) => !/^\s*(→\s*)?\d+\s/.test(line))
    // The "invocation in <path>:line:col" header, which exists only to locate source.
    .filter((line) => !/invocation in\s+\S+:\d+:\d+/i.test(line))
    .map((line) =>
      line
        // Absolute Windows and POSIX paths, wherever they appear in prose.
        .replace(/[A-Za-z]:\\[^\s"']+/g, "[PATH]")
        .replace(/(?:^|(?<=\s))\/(?:home|Users|var|opt|srv)\/[^\s"']+/g, "[PATH]"),
    )
    .map((line) => line.trimEnd())
    .filter((line, index, all) => !(line === "" && all[index - 1] === ""));

  return kept.join("\n").trim();
}

export function redactSecrets(text: string): string {
  let out = text;

  for (const name of CREDENTIAL_ENV_VARS) {
    const value = process.env[name];
    // Guard against a short or empty value turning every string into redaction soup — a
    // one-character "key" would otherwise match everywhere.
    if (value && value.length >= 8) {
      out = out.split(value).join(REDACTED);
    }
  }

  for (const param of CREDENTIAL_QUERY_PARAMS) {
    out = out.replace(
      new RegExp(`([?&]${param}=)[^&\\s]+`, "gi"),
      (_match, prefix: string) => `${prefix}${REDACTED}`,
    );
  }

  return out;
}
