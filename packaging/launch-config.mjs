/**
 * What the launcher needs before it starts anything, and what it refuses to guess.
 *
 * Pure, and plain JavaScript for the same reason as its neighbours: it ships. Every refusal is a
 * token from a closed set, and NO refusal carries the connection string — a launcher's first
 * output on a broken install is exactly where a password would otherwise end up, in a window the
 * user is most likely to screenshot.
 */

/** Every reason a launch can be refused before it begins. */
export const LAUNCH_REFUSALS = [
  "MALFORMED_CONFIG",
  "NO_DATABASE_URL",
  "INVALID_DATABASE_URL",
  "INVALID_PORT",
  "INCOMPLETE_POSTGRES_CONFIG",
];

const DEFAULT_PORT = 3100;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Resolve the launch configuration from the config file's parsed contents and the environment.
 *
 * The environment wins. A launcher started by a script, a service manager or a test can then
 * supply the URL without it ever being written to disk, and the file stays the fallback for the
 * case that has no environment to speak of: a user double-clicking an icon.
 *
 * @param {{ file?: unknown, env?: Record<string, string | undefined> }} input
 * @returns {import("./launch-config.js").LaunchResolution}
 */
export function resolveLaunchConfig(input) {
  const env = input.env ?? {};
  const file = input.file;

  if (file !== undefined && file !== null && !isPlainObject(file)) {
    return { ok: false, refusal: "MALFORMED_CONFIG" };
  }
  const fromFile = isPlainObject(file) ? file : {};

  const rawUrl = env.DATABASE_URL ?? fromFile.databaseUrl;
  if (typeof rawUrl !== "string" || rawUrl.trim().length === 0) {
    return { ok: false, refusal: "NO_DATABASE_URL" };
  }
  const databaseUrl = rawUrl.trim();
  // Shape only. Whether the database ANSWERS is `first-run.mjs`'s question, and answering it here
  // would mean two places deciding the same thing differently.
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    return { ok: false, refusal: "INVALID_DATABASE_URL" };
  }

  const rawPort = env.PORT ?? fromFile.port;
  let port = DEFAULT_PORT;
  if (rawPort !== undefined) {
    // `Number()` rather than `parseInt`: `parseInt("3100abc")` is 3100, which would silently
    // accept a typo and then bind a port the user did not write down.
    const parsed = Number(rawPort);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      return { ok: false, refusal: "INVALID_PORT" };
    }
    port = parsed;
  }

  // Managing PostgreSQL is opt-in. An installation that points at a database somebody else runs
  // must never start or stop it, and the default has to be the one that cannot damage anything.
  let postgres = null;
  const rawPg = fromFile.postgres;
  if (isPlainObject(rawPg) && rawPg.manage === true) {
    const binDir = typeof rawPg.binDir === "string" ? rawPg.binDir.trim() : "";
    const dataDir = typeof rawPg.dataDir === "string" ? rawPg.dataDir.trim() : "";
    if (binDir.length === 0 || dataDir.length === 0) {
      return { ok: false, refusal: "INCOMPLETE_POSTGRES_CONFIG" };
    }
    postgres = { manage: true, binDir, dataDir };
  }

  return {
    ok: true,
    config: {
      databaseUrl,
      port,
      postgres,
      // Anything other than an explicit `false` opens the browser, because the overwhelmingly
      // common case is a person double-clicking an icon and expecting a window.
      openBrowser: fromFile.openBrowser !== false,
    },
  };
}

/**
 * The one line a launcher may print about its configuration.
 *
 * A separate function so that "the launcher never prints the URL" is a property of a tested unit
 * rather than of every `console.log` someone adds later.
 *
 * @param {import("./launch-config.js").LaunchConfig} config
 * @returns {string}
 */
export function describeLaunchConfig(config) {
  const managed = config.postgres !== null;
  return `LAUNCH port=${config.port} database=configured postgres=${managed ? "managed" : "external"} browser=${config.openBrowser}`;
}
