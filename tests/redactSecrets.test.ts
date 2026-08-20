import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { redactSecrets, sanitiseErrorForStorage, REDACTED } from "@/server/adapters/redactSecrets";

/**
 * Credential redaction for anything that might be logged, stored, or rendered.
 *
 * The concrete hazard, found on 2026-08-17: `HttpTimeoutError` embeds the request URL in its
 * message, provider credentials live in those URLs, and ingest-run errors are now persisted to
 * `ingest_runs.error` and rendered on the authenticated /admin page. Without this, a single
 * upstream timeout would have written an API key into the database.
 */
describe("redactSecrets", () => {
  const original = {
    FRED_API_KEY: process.env.FRED_API_KEY,
    ECOS_API_KEY: process.env.ECOS_API_KEY,
    DART_API_KEY: process.env.DART_API_KEY,
  };

  beforeEach(() => {
    process.env.FRED_API_KEY = "fredsecretkey1234567890";
    process.env.ECOS_API_KEY = "ecossecretkey1234567890";
    process.env.DART_API_KEY = "dartsecretkey1234567890";
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("redacts an ECOS key embedded in a URL path segment", () => {
    // ECOS is the awkward one: the key is a path segment, so query-parameter redaction alone
    // would miss it entirely.
    const url =
      "https://ecos.bok.or.kr/api/StatisticSearch/ecossecretkey1234567890/json/kr/1/1000/722Y001/M/200001/202612/0101000";
    const out = redactSecrets(`Request to ${url} timed out after 30000ms`);

    expect(out).not.toContain("ecossecretkey1234567890");
    expect(out).toContain(REDACTED);
    // The rest of the URL is diagnostic and must survive, or the error stops being useful.
    expect(out).toContain("722Y001");
    expect(out).toContain("timed out after 30000ms");
  });

  it("redacts a FRED key in a query parameter", () => {
    const out = redactSecrets(
      "https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&api_key=fredsecretkey1234567890&file_type=json",
    );
    expect(out).not.toContain("fredsecretkey1234567890");
    expect(out).toContain("series_id=DGS10");
    expect(out).toContain("file_type=json");
  });

  it("redacts an OpenDART key in its crtfc_key parameter", () => {
    const out = redactSecrets(
      "https://opendart.fss.or.kr/api/list.json?crtfc_key=dartsecretkey1234567890&corp_code=00126380",
    );
    expect(out).not.toContain("dartsecretkey1234567890");
    expect(out).toContain("corp_code=00126380");
  });

  it("redacts a credential-shaped query parameter even when it is not a configured key", () => {
    // Second layer: a stale value, or a second account's key, still should not be stored.
    const out = redactSecrets("https://example.com/x?api_key=some-other-key-entirely&z=1");
    expect(out).not.toContain("some-other-key-entirely");
    expect(out).toContain("z=1");
  });

  it("leaves text alone when no credential is present", () => {
    const clean = "SEC EDGAR request failed for CIK 320193: 503 Service Unavailable";
    expect(redactSecrets(clean)).toBe(clean);
  });

  it("strips Prisma's code frame — paths and source — before storage", () => {
    // Verbatim shape of a real Prisma client error, captured from an actual connection failure.
    // The password is NOT in it (checked, not assumed), but the absolute path and several lines
    // of application source are, and `recordIngestRun` persists this for /admin to render.
    const prismaError = [
      "",
      "Invalid `client.source.findMany()` invocation in",
      "C:\\AI-Projects\\market-os\\src\\server\\domain\\ingestRun.ts:15:25",
      "",
      "  12 async function main() {",
      "  13   const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: URL }) });",
      "  14   try {",
      "→ 15     await client.source.findMany(",
      "Can't reach database server at 127.0.0.1:59999",
    ].join("\n");

    const stored = sanitiseErrorForStorage(prismaError);

    // The one line an operator actually needs survives.
    expect(stored).toContain("Can't reach database server at 127.0.0.1:59999");
    // Filesystem layout and application source do not.
    expect(stored).not.toContain("C:\\AI-Projects");
    expect(stored).not.toContain("new PrismaClient");
    expect(stored).not.toContain("connectionString");
    expect(stored).not.toMatch(/ingestRun\.ts:\d+:\d+/);
  });

  it("redacts credentials inside an error before storing it", () => {
    const stored = sanitiseErrorForStorage(
      "Request to https://api.stlouisfed.org/fred/series?api_key=fredsecretkey1234567890 timed out",
    );
    expect(stored).not.toContain("fredsecretkey1234567890");
    expect(stored).toContain(REDACTED);
  });

  it("leaves an ordinary one-line error untouched apart from trimming", () => {
    expect(sanitiseErrorForStorage("provider returned 503")).toBe("provider returned 503");
  });

  it("strips POSIX absolute paths too, not only Windows ones", () => {
    const stored = sanitiseErrorForStorage("failed reading /home/runner/work/market-os/secret.ts");
    expect(stored).not.toContain("/home/runner");
    expect(stored).toContain("[PATH]");
  });

  it("does not turn every string into redaction soup when a key is implausibly short", () => {
    // A one- or two-character value would otherwise match all over the place, destroying the
    // diagnostic value of every message.
    process.env.FRED_API_KEY = "ab";
    const text = "a stable and readable error about DGS10";
    expect(redactSecrets(text)).toBe(text);
  });
});

/**
 * Hardening from an audit of secret routes (`gpt-5.6-luna`, 2026-08-18), plus a bug that audit's
 * fix introduced and that only running the code revealed.
 */
describe("sanitiseErrorForStorage accepts whatever was actually thrown", () => {
  const ORIGINAL_FRED = process.env.FRED_API_KEY;
  const ORIGINAL_DB = process.env.DATABASE_URL;

  beforeEach(() => {
    process.env.FRED_API_KEY = "fredkey1234567890abcdef";
    process.env.DATABASE_URL = "postgresql://user:supersecretpw123@127.0.0.1:5432/db";
  });
  afterEach(() => {
    if (ORIGINAL_FRED === undefined) delete process.env.FRED_API_KEY;
    else process.env.FRED_API_KEY = ORIGINAL_FRED;
    if (ORIGINAL_DB === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = ORIGINAL_DB;
  });

  it("handles an Error object, not just a string", () => {
    // The signature took `string`. Every caller is a catch block, where the binding is `any`, so
    // it type-checked and would then have thrown INSIDE the error handler - the one path whose
    // whole job is to keep working when something has already gone wrong.
    const err = new Error("boom");
    expect(typeof sanitiseErrorForStorage(err)).toBe("string");
    expect(sanitiseErrorForStorage(err)).toContain("boom");
  });

  it("redacts a provider key carried in a thrown Error's message", () => {
    const err = new Error(
      "FRED failed: https://api.stlouisfed.org/fred/series?api_key=fredkey1234567890abcdef",
    );
    expect(sanitiseErrorForStorage(err)).not.toContain("fredkey1234567890abcdef");
  });

  it("handles a thrown non-Error without producing [object Object]", () => {
    expect(sanitiseErrorForStorage({ code: "P2002" })).toContain("P2002");
    expect(sanitiseErrorForStorage(null)).toBe("null");
    expect(sanitiseErrorForStorage(42)).toBe("42");
  });

  it("still accepts a plain string", () => {
    expect(sanitiseErrorForStorage("plain message")).toContain("plain message");
  });
});

describe("the database password is redacted like any other credential", () => {
  const ORIGINAL_DB = process.env.DATABASE_URL;
  afterEach(() => {
    if (ORIGINAL_DB === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = ORIGINAL_DB;
  });

  it("removes the password when it appears in text", () => {
    // It does not appear in Prisma connection errors - that was verified. But "this error shape
    // does not contain it" is weaker than "it is redacted wherever it appears", and a stored
    // database password is not a thing anyone gets to discover twice.
    process.env.DATABASE_URL = "postgresql://user:supersecretpw123@127.0.0.1:5432/db";
    expect(redactSecrets("connection used supersecretpw123 here")).not.toContain(
      "supersecretpw123",
    );
  });

  it("leaves a short password alone, so ordinary prose is not shredded", () => {
    // A four-character password would match everywhere and turn diagnostics into redaction soup.
    process.env.DATABASE_URL = "postgresql://user:test@127.0.0.1:5432/db";
    expect(redactSecrets("this is a test of the system")).toBe("this is a test of the system");
  });

  it("does nothing when DATABASE_URL is unset or unparseable", () => {
    delete process.env.DATABASE_URL;
    expect(redactSecrets("nothing to redact")).toBe("nothing to redact");
    process.env.DATABASE_URL = "not-a-url";
    expect(redactSecrets("nothing to redact")).toBe("nothing to redact");
  });
});

/**
 * Gate A, finding E1 — a short password survived redaction.
 *
 * Credentials are redacted by exact value, and values under eight characters are exempt so that
 * "test" or "admin" do not turn ordinary diagnostics into `[REDACTED]` soup. That reasoning is
 * sound and it left a hole: a seven-character database password in a connection URI reached
 * persisted ingestion errors and could be rendered on `/admin`.
 *
 * The threshold was not the mistake. A password sitting between `:` and `@` in a URI needs no
 * length heuristic to be identified — its position says what it is — so it is now redacted by
 * shape, while everything else about the string survives. A redacted connection error should still
 * say which database failed.
 */
describe("a connection URI never keeps its password", () => {
  it.each([
    "connect failed: postgresql://market:s3cr3t!@db.internal:5432/market_os",
    "postgres://u:short@host:5432/db",
    "mysql://root:p@127.0.0.1:3306/app",
    "mongodb+srv://svc:abc@cluster0.example.net/db",
  ])("redacts the password in %s", (text) => {
    const out = redactSecrets(text);
    expect(out).toContain("[REDACTED]");
    for (const secret of ["s3cr3t!", ":short@", ":p@", ":abc@"]) {
      if (text.includes(secret)) expect(out).not.toContain(secret);
    }
  });

  it("keeps everything that is not the password", () => {
    // A diagnostic that cannot say which host or database failed is not much of a diagnostic.
    const out = redactSecrets("postgresql://market:s3cr3t!@db.internal:5432/market_os");
    expect(out).toContain("postgresql://market:");
    expect(out).toContain("@db.internal:5432/market_os");
  });

  it("leaves ordinary URLs and prose alone", () => {
    for (const safe of [
      "GET https://api.stlouisfed.org/fred/series?series_id=UNRATE",
      "see https://github.com/jyun121388-spec/market-os for details",
      "ratio was 3:1 and host@example.com replied",
    ]) {
      expect(redactSecrets(safe)).toBe(safe);
    }
  });
});

/**
 * Gate B, findings RS-1 and RS-2 — the fix for E1 was wrong at both ends of the URI.
 *
 * RS-1: the username was required, and it is optional in a URI. `postgresql://:s3cr3t@host/db`
 * kept its password — six characters, below the value-redaction floor, so no later phase caught it
 * either. The one shape most likely to appear in a misconfigured local connection string.
 *
 * RS-2: nothing was required after the `@`, so the substitution edited prose. "Parser syntax is
 * proto://left:right@ followed by a host token" came back with `[REDACTED]` in the middle of a
 * sentence about grammar, and because this runs before the other two phases, nothing could put it
 * back.
 */
describe("the connection-URI redaction, at both ends", () => {
  it("redacts a password when the username is empty", () => {
    const out = redactSecrets("connect failed: postgresql://:s3cr3t@db.internal/market");
    expect(out).not.toContain("s3cr3t");
    expect(out).toContain("postgresql://:[REDACTED]@db.internal/market");
  });

  it.each([
    "Parser syntax is proto://left:right@ followed by a host token.",
    "the grammar is scheme://user:pass@ then the authority",
  ])("leaves %s alone, because no host follows", (text) => {
    // A real connection URI always has a host. Requiring one costs nothing and stops this from
    // rewriting text that holds no secret.
    expect(redactSecrets(text)).toBe(text);
  });

  it("still redacts the cases E1 was about", () => {
    for (const [text, secret] of [
      ["postgresql://market:s3cr3t!@db.internal:5432/market_os", "s3cr3t!"],
      ["postgres://u:short@host:5432/db", "short"],
      ["mongodb+srv://svc:abc@cluster0.example.net/db", "abc"],
    ] as const) {
      const out = redactSecrets(text);
      expect(out).toContain("[REDACTED]");
      expect(out).not.toContain(`:${secret}@`);
    }
  });
});
