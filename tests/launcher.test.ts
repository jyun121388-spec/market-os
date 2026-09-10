import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  describeLaunchConfig,
  LAUNCH_REFUSALS,
  resolveLaunchConfig,
} from "../packaging/launch-config.mjs";
import {
  classifyReadyAttempt,
  parseReadinessDocument,
  READY_POLL_VERDICTS,
} from "../packaging/ready-poll.mjs";
import type { LaunchConfig, LaunchRefusal } from "../packaging/launch-config.js";
import { READINESS_VOCABULARY } from "@/lib/readiness";

/**
 * Unit I — the Windows launcher.
 *
 * As with Unit H, the files under test are the files that ship. The launcher's two decisions worth
 * isolating are what it will accept as a configuration and when it may open a browser; both are
 * pure, and both are places where getting it wrong shows the user something they should not see —
 * a password in a refusal, or somebody else's web page.
 */

const PACKAGING = join(process.cwd(), "packaging");
const source = (name: string) => readFileSync(join(PACKAGING, name), "utf8");

const URL_OK = "postgresql://marketos:hunter2@127.0.0.1:55432/market_os";

describe("what the launcher will accept as a configuration", () => {
  it("takes the database and a default port from the config file", () => {
    const result = resolveLaunchConfig({ file: { databaseUrl: URL_OK }, env: {} });
    expect(result.ok).toBe(true);
    expect(result).toHaveProperty("config.port", 3100);
    expect(result).toHaveProperty("config.databaseUrl", URL_OK);
  });

  it("lets the environment win, so a URL need never be written to disk", () => {
    const result = resolveLaunchConfig({
      file: { databaseUrl: "postgresql://from:file@127.0.0.1:5432/f" },
      env: { DATABASE_URL: URL_OK, PORT: "4200" },
    });
    expect(result).toHaveProperty("config.databaseUrl", URL_OK);
    expect(result).toHaveProperty("config.port", 4200);
  });

  it("refuses rather than inventing a database", () => {
    expect(resolveLaunchConfig({ file: {}, env: {} })).toEqual({
      ok: false,
      refusal: "NO_DATABASE_URL",
    });
  });

  it("refuses a connection string that is not PostgreSQL", () => {
    const result = resolveLaunchConfig({ file: { databaseUrl: "mysql://x@y/z" }, env: {} });
    expect(result).toEqual({ ok: false, refusal: "INVALID_DATABASE_URL" });
  });

  it("refuses a config file that is not a configuration", () => {
    for (const file of ["", 7, [], "not json"]) {
      expect(resolveLaunchConfig({ file, env: {} })).toEqual({
        ok: false,
        refusal: "MALFORMED_CONFIG",
      });
    }
  });

  it("refuses a port that is nearly a number", () => {
    // `parseInt("3100abc")` is 3100, and accepting that would bind a port the user did not write
    // down and then report success about it.
    for (const port of ["3100abc", "", "-1", "0", "65536", "80.5", "http"]) {
      expect(
        resolveLaunchConfig({ file: { databaseUrl: URL_OK, port }, env: {} }),
        `port ${JSON.stringify(port)} was accepted`,
      ).toEqual({ ok: false, refusal: "INVALID_PORT" });
    }
  });

  it("does not manage a database it was not told to manage", () => {
    // The default has to be the one that cannot damage anything: an installation pointed at a
    // database somebody else runs must never start or stop it.
    for (const file of [
      { databaseUrl: URL_OK },
      { databaseUrl: URL_OK, postgres: {} },
      { databaseUrl: URL_OK, postgres: { manage: false, binDir: "b", dataDir: "d" } },
    ]) {
      const result = resolveLaunchConfig({ file, env: {} });
      expect(result).toHaveProperty("config.postgres", null);
    }
  });

  it("refuses to manage a database whose location is half-specified", () => {
    for (const postgres of [
      { manage: true },
      { manage: true, binDir: "pgsql/bin" },
      { manage: true, dataDir: "pgdata" },
      { manage: true, binDir: "  ", dataDir: "pgdata" },
    ]) {
      expect(resolveLaunchConfig({ file: { databaseUrl: URL_OK, postgres }, env: {} })).toEqual({
        ok: false,
        refusal: "INCOMPLETE_POSTGRES_CONFIG",
      });
    }
  });

  it("opens a browser unless told not to, and only an explicit false says not to", () => {
    const cases: [unknown, boolean][] = [
      [undefined, true],
      [true, true],
      [0, true],
      [false, false],
    ];
    for (const [openBrowser, expected] of cases) {
      const result = resolveLaunchConfig({ file: { databaseUrl: URL_OK, openBrowser }, env: {} });
      expect(result).toHaveProperty("config.openBrowser", expected);
    }
  });

  it("only ever refuses from the closed vocabulary", () => {
    const refusals: LaunchRefusal[] = [];
    for (const file of [
      "",
      {},
      { databaseUrl: "mysql://x" },
      { databaseUrl: URL_OK, port: "x" },
      { databaseUrl: URL_OK, postgres: { manage: true } },
    ]) {
      const result = resolveLaunchConfig({ file, env: {} });
      if (!result.ok) refusals.push(result.refusal);
    }
    for (const refusal of refusals) expect(LAUNCH_REFUSALS).toContain(refusal);
    expect(new Set(refusals).size).toBe(LAUNCH_REFUSALS.length);
  });

  it("says nothing about the database but that it is configured", () => {
    // A launcher's first output on a broken install is exactly the window a user screenshots.
    const config = (
      resolveLaunchConfig({ file: { databaseUrl: URL_OK }, env: {} }) as { config: LaunchConfig }
    ).config;
    const line = describeLaunchConfig(config);
    expect(line).not.toContain("hunter2");
    expect(line).not.toContain("127.0.0.1:55432");
    expect(line).toContain("database=configured");
  });

  it("puts no part of the connection string into any refusal", () => {
    for (const file of ["", { databaseUrl: "mysql://user:hunter2@h/d" }]) {
      const result = resolveLaunchConfig({ file, env: {} });
      expect(JSON.stringify(result)).not.toContain("hunter2");
    }
  });
});

describe("when the launcher may open a browser", () => {
  const budgetMs = 60_000;

  it("opens on this application's own READY document", () => {
    expect(
      classifyReadyAttempt({
        reached: true,
        status: 200,
        body: '{"status":"READY"}',
        elapsedMs: 1_000,
        budgetMs,
      }),
    ).toBe("READY");
  });

  it("keeps waiting while the server boots and the schema is not usable yet", () => {
    const booting = { reached: false, elapsedMs: 500, budgetMs };
    const notReady = {
      reached: true,
      status: 503,
      body: '{"status":"NOT_READY","reason":"SCHEMA_NOT_READY"}',
      elapsedMs: 900,
      budgetMs,
    };
    expect(classifyReadyAttempt(booting)).toBe("RETRY");
    expect(classifyReadyAttempt(notReady)).toBe("RETRY");
  });

  it("gives up when the budget is spent", () => {
    expect(classifyReadyAttempt({ reached: false, elapsedMs: budgetMs, budgetMs })).toBe(
      "TIMED_OUT",
    );
  });

  it("honours a ready answer that arrives exactly at the deadline", () => {
    // Order matters: checking the budget first would throw away the answer the launcher was
    // waiting for, on the attempt it finally arrived.
    expect(
      classifyReadyAttempt({
        reached: true,
        status: 200,
        body: '{"status":"READY"}',
        elapsedMs: budgetMs,
        budgetMs,
      }),
    ).toBe("READY");
  });

  it("refuses to open a browser at a program that is not Market OS", () => {
    // The case this verdict exists for. A launcher polls a fixed port on localhost and something
    // else may own it. Retrying would waste the budget; opening a browser would show the user a
    // stranger's page and let them believe it is theirs.
    const impostors = [
      "<!doctype html><title>somebody else</title>",
      '{"status":"ok"}',
      '"READY"',
      '["READY"]',
      "",
      '{"ready":true}',
    ];
    for (const body of impostors) {
      expect(
        classifyReadyAttempt({ reached: true, status: 200, body, elapsedMs: 10, budgetMs }),
        `a 200 answering ${JSON.stringify(body)} was mistaken for Market OS`,
      ).toBe("NOT_MARKET_OS");
    }
  });

  it("reads the readiness document strictly, and only its two tokens", () => {
    expect(parseReadinessDocument('{"status":"READY"}')).toBe("READY");
    expect(parseReadinessDocument('{"status":"NOT_READY","reason":"DATABASE_UNAVAILABLE"}')).toBe(
      "NOT_READY",
    );
    expect(parseReadinessDocument('{"status":"MAYBE"}')).toBeNull();
    expect(parseReadinessDocument(undefined)).toBeNull();
  });

  it("agrees with the route about what the two tokens are", () => {
    // Both sides of this contract are in this repository, and nothing else makes them move
    // together. `READINESS_VOCABULARY` is the endpoint's own list.
    expect(READINESS_VOCABULARY).toContain("READY");
    expect(READINESS_VOCABULARY).toContain("NOT_READY");
    expect(parseReadinessDocument('{"status":"READY"}')).toBe("READY");
    expect(parseReadinessDocument('{"status":"NOT_READY"}')).toBe("NOT_READY");
  });

  it("only ever answers from the closed vocabulary, and reaches every verdict", () => {
    const verdicts = new Set([
      classifyReadyAttempt({
        reached: true,
        status: 200,
        body: '{"status":"READY"}',
        elapsedMs: 1,
        budgetMs,
      }),
      classifyReadyAttempt({ reached: false, elapsedMs: 1, budgetMs }),
      classifyReadyAttempt({ reached: false, elapsedMs: budgetMs, budgetMs }),
      classifyReadyAttempt({ reached: true, status: 200, body: "nope", elapsedMs: 1, budgetMs }),
    ]);
    for (const verdict of verdicts) expect(READY_POLL_VERDICTS).toContain(verdict);
    expect(verdicts.size).toBe(READY_POLL_VERDICTS.length);
  });
});

describe("the launcher program itself", () => {
  const launcher = source("launcher.mjs");

  it("waits for readiness rather than for the port to open", () => {
    // The distinction the whole unit rests on: the port accepts connections well before the schema
    // is usable, and a browser opened at that moment shows an error page.
    expect(launcher).toContain("/api/ready");
    expect(launcher).toContain("classifyReadyAttempt");
  });

  it("does not open a browser before READY", () => {
    // Positional, because the ordering is the property. `openBrowser` must be reachable only from
    // inside the READY branch.
    //
    // Matching the CALL, guarded by its condition, and not the bare name: `openBrowser(url)` also
    // matches the function's own declaration, which is defined earlier in the file — the first
    // version of this assertion failed on a launcher that was correct, having compared the READY
    // branch against a definition rather than a call.
    const readyBranch = launcher.indexOf('verdict === "READY"');
    const browserCall = launcher.indexOf("if (config.openBrowser) openBrowser(url)");
    expect(readyBranch).toBeGreaterThan(-1);
    expect(browserCall).toBeGreaterThan(readyBranch);
  });

  it("binds to loopback, because this is a desktop application", () => {
    expect(launcher).toContain('HOSTNAME: "127.0.0.1"');
    expect(launcher).not.toContain("0.0.0.0");
  });

  it("stops a database only when it was the one that started it", () => {
    // A database that was already running belonged to someone before this process existed.
    expect(launcher).toContain("DATABASE_ALREADY_RUNNING");
    expect(launcher).toContain("if (ownsDatabase) stopDatabase(config)");
  });

  it("filters the server's stderr, which is where a database failure surfaces", () => {
    expect(launcher).toContain("redact(chunk)");
  });

  it("does not start a server when setup refused", () => {
    const setupFailure = launcher.indexOf("SETUP_FAILED");
    const serverStart = launcher.indexOf("const server = startServer(config)");
    expect(setupFailure).toBeGreaterThan(-1);
    expect(serverStart).toBeGreaterThan(setupFailure);
  });
});

describe("the thing a user double-clicks", () => {
  const shim = source("Market OS.cmd");

  it("is a .cmd, so a default execution policy cannot block it", () => {
    // A .ps1 launcher fails on exactly the clean Windows machine this is meant to work on.
    expect(() => source("Market OS.cmd")).not.toThrow();
  });

  it("runs from its own directory rather than wherever it was invoked", () => {
    expect(shim).toContain('cd /d "%~dp0"');
  });

  it("prefers a bundled Node over whatever is on PATH", () => {
    const bundled = shim.indexOf("node\\node.exe");
    const fallback = shim.indexOf("where node");
    expect(bundled).toBeGreaterThan(-1);
    expect(fallback).toBeGreaterThan(bundled);
  });

  it("holds the window open on failure", () => {
    // Without this a double-clicked launcher that refuses closes instantly and the user sees
    // nothing at all — which is indistinguishable, to them, from nothing having happened.
    expect(shim).toContain("pause");
  });
});
