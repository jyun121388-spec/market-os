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
