/**
 * Redaction for anything the packaged setup prints.
 *
 * Its own file so that it can be tested as the bytes that ship, without importing the setup
 * program and running it. `first-run.mjs` has no other redactor.
 *
 * Built from the ACTUAL connection string and its ACTUAL password, never from a pattern for what
 * a connection string is supposed to look like. That distinction is not theoretical here: the leak
 * audit that preceded this unit found real API keys in a bundler cache, and it found them because
 * it searched for the values rather than for the places values were expected to be. A
 * pattern-shaped redactor is only as good as the shapes someone thought of.
 */

/**
 * The password, and the whole userinfo, read off the connection string by hand.
 *
 * Deliberately crude: everything between the first `//` and the LAST `@` before the path is the
 * userinfo, and everything after the first `:` in it is the password. Crude in the direction of
 * redacting too much, which costs legibility in a log line, rather than too little, which costs a
 * credential.
 *
 * @param {string} url
 * @returns {string[]}
 */
function lexicalUserinfo(url) {
  const afterScheme = url.indexOf("//");
  if (afterScheme === -1) return [];
  const authorityStart = afterScheme + 2;
  const pathStart = url.indexOf("/", authorityStart);
  const authority =
    pathStart === -1 ? url.slice(authorityStart) : url.slice(authorityStart, pathStart);
  const at = authority.lastIndexOf("@");
  if (at === -1) return [];
  const userinfo = authority.slice(0, at);
  const colon = userinfo.indexOf(":");
  if (colon === -1) return [];
  const password = userinfo.slice(colon + 1);
  // The userinfo as a whole as well, since `user:password` often appears intact in an error.
  return [userinfo, password].filter((s) => s.length > 0);
}

/**
 * @param {string | undefined} url
 * @returns {(text: unknown) => string}
 */
export function makeRedactor(url) {
  /** @type {string[]} */
  const secrets = [];
  if (url) {
    secrets.push(url);
    try {
      const parsed = new URL(url);
      if (parsed.password) {
        // Both forms. The URL carries the password percent-encoded, and a library that reports it
        // back — in an error, in a log line — may have decoded it first.
        secrets.push(parsed.password, decodeURIComponent(parsed.password));
      }
    } catch {
      // Not a parseable URL. The whole string is still redacted, which is the important half, and
      // failing to parse is not a reason to redact nothing.
    }

    // And the same password read off the string directly, because `new URL` is not reliable here
    // and its failure is SILENT. A PostgreSQL password may contain `?`, which the WHATWG parser
    // treats as the end of the authority — so `new URL` returns an empty password for a URL that
    // plainly has one, and a redactor built on it alone would print that password in the clear
    // the moment it appeared on its own. Measured, not assumed: a test feeds a password made
    // entirely of regex and URL metacharacters.
    for (const candidate of lexicalUserinfo(url)) secrets.push(candidate);
  }

  // Longest first. Redacting the password before the full URL would leave the URL's remaining
  // characters unmatched and print the host, the user and the database name in the clear.
  const ordered = [...new Set(secrets.filter((s) => typeof s === "string" && s.length > 0))].sort(
    (a, b) => b.length - a.length,
  );

  return (text) => {
    let out = String(text);
    // `split`/`join` rather than a regex: a password is arbitrary bytes and may contain regex
    // metacharacters, and building a pattern out of a secret is how a redactor silently stops
    // matching the one value it exists to hide.
    for (const secret of ordered) out = out.split(secret).join("[redacted]");
    return out;
  };
}
