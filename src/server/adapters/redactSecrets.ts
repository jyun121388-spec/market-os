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

/**
 * Shortest password worth redacting.
 *
 * The database password is redacted by exact value like any other credential, but a very short
 * one ("test", "admin") would match ordinary prose and turn a useful diagnostic into
 * `[REDACTED]` soup. Eight characters is the point where a value is specific enough that a match
 * is almost certainly the password rather than a coincidence.
 */
const MIN_REDACTABLE_PASSWORD_LENGTH = 8;

/**
 * The password component of `DATABASE_URL`, when there is one worth redacting.
 *
 * An audit (`gpt-5.6-luna`, 2026-08-18) noted that this value was excluded from redaction. The
 * exclusion was reasoned rather than accidental — the password does NOT appear in Prisma
 * connection errors, verified against a real failure — but "this particular error shape does not
 * contain it" is a weaker guarantee than "it is redacted wherever it appears", and the cost of
 * the stronger one is four lines. A stored database password is not a defect anyone gets to
 * discover twice.
 */
function databasePassword(): string | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  try {
    const password = decodeURIComponent(new URL(url).password ?? "");
    return password.length >= MIN_REDACTABLE_PASSWORD_LENGTH ? password : null;
  } catch {
    return null;
  }
}

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
export function sanitiseErrorForStorage(input: unknown): string {
  // Accepts `unknown`, not `string`. Every caller is an error path, and `catch (err)` gives
  // `any` — so a signature demanding a string type-checks fine and then throws at runtime, in
  // the one code path whose entire job is to still work when something has gone wrong. Found
  // immediately after wiring this into the ingest scripts, by running it rather than compiling it.
  const text = typeof input === "string" ? input : errorToString(input);
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

/**
 * Best-effort string form of anything thrown.
 *
 * `stack` is preferred where present because it carries the message plus the frames an operator
 * needs; the code-frame stripping below removes the parts that leak filesystem layout. A thrown
 * non-Error still has to produce something readable rather than "[object Object]".
 */
function errorToString(input: unknown): string {
  if (input instanceof Error) return input.stack ?? `${input.name}: ${input.message}`;
  if (input === null || input === undefined) return String(input);
  if (typeof input === "object") {
    try {
      return JSON.stringify(input);
    } catch {
      return Object.prototype.toString.call(input);
    }
  }
  return String(input);
}

/**
 * The password inside any connection URI, removed by SHAPE rather than by value.
 *
 * Value-matching alone leaves a real hole, which the Gate A review found: credentials shorter than
 * the eight-character threshold are exempt, so `postgresql://market:s3cr3t!@host/db` in an
 * ingestion error keeps its password and can reach `/admin`.
 *
 * The threshold itself is not the mistake — it exists because redacting "test" or "admin" by value
 * would turn ordinary diagnostics into `[REDACTED]` soup, and that reasoning still holds. What was
 * missing is that a password sitting between `:` and `@` in a URI needs no length heuristic to be
 * identified. Its position says what it is.
 *
 * Scoped to the userinfo component only, so the scheme, user, host, port and database name all
 * survive — a redacted connection string should still tell you which database failed.
 */
const CONNECTION_URI_PASSWORD = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+):[^\s@/]+@/gi;

export function redactSecrets(text: string): string {
  let out = text.replace(CONNECTION_URI_PASSWORD, `$1:${REDACTED}@`);

  for (const name of CREDENTIAL_ENV_VARS) {
    const value = process.env[name];
    // Guard against a short or empty value turning every string into redaction soup — a
    // one-character "key" would otherwise match everywhere.
    if (value && value.length >= 8) {
      out = out.split(value).join(REDACTED);
    }
  }

  // The database password, by exact value, on the same terms as any provider credential.
  const dbPassword = databasePassword();
  if (dbPassword) {
    out = out.split(dbPassword).join(REDACTED);
  }

  for (const param of CREDENTIAL_QUERY_PARAMS) {
    out = out.replace(
      new RegExp(`([?&]${param}=)[^&\\s]+`, "gi"),
      (_match, prefix: string) => `${prefix}${REDACTED}`,
    );
  }

  return out;
}
