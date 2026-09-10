import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { classifyInstall, INSTALL_ACTIONS } from "../packaging/install-classify.mjs";
import type { InstallProbes } from "../packaging/install-classify.js";
import {
  FORBIDDEN_STAGED_PATTERNS,
  isForbiddenStagedPath,
  PACKAGED_INSTALLER_FILES,
  PACKAGED_SETUP_FILES,
} from "../scripts/stage-runtime";

/**
 * Unit J — the installer.
 *
 * An installer is the most destructive program in a package: it runs `initdb`, and `initdb` into a
 * directory that already holds files is how somebody loses work that had nothing to do with this
 * application. So the refusals are what these tests are mostly about, and the install path is the
 * short case at the end.
 */

const PACKAGING = join(process.cwd(), "packaging");
const source = (name: string) => readFileSync(join(PACKAGING, name), "utf8");
const code = (name: string) =>
  source(name)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/gm, "$1");

function probes(over: Partial<InstallProbes> = {}): InstallProbes {
  return {
    applicationFilesPresent: true,
    postgresPresent: true,
    dataDirExists: false,
    dataDirEmpty: true,
    dataDirEntryCount: 0,
    clusterPresent: false,
    configPresent: false,
    ...over,
  };
}

describe("what an installation decides to do", () => {
  it("creates a cluster when the data directory does not exist", () => {
    expect(classifyInstall(probes()).action).toBe("CREATE_CLUSTER");
  });

  it("creates a cluster in a directory that exists but is empty", () => {
    expect(
      classifyInstall(probes({ dataDirExists: true, dataDirEmpty: true, dataDirEntryCount: 0 }))
        .action,
    ).toBe("CREATE_CLUSTER");
  });

  it("does nothing when it is already installed", () => {
    expect(
      classifyInstall(probes({ dataDirExists: true, clusterPresent: true, configPresent: true }))
        .action,
    ).toBe("ALREADY_INSTALLED");
  });

  it("is idempotent, which is the property a user produces by double-clicking twice", () => {
    const first = classifyInstall(probes());
    expect(first.action).toBe("CREATE_CLUSTER");
    const second = classifyInstall(
      probes({
        dataDirExists: true,
        dataDirEmpty: false,
        dataDirEntryCount: 24,
        clusterPresent: true,
        configPresent: true,
      }),
    );
    expect(second.action).toBe("ALREADY_INSTALLED");
  });

  it("refuses a data directory that already contains somebody's files", () => {
    // The refusal this whole classifier exists for.
    const verdict = classifyInstall(
      probes({ dataDirExists: true, dataDirEmpty: false, dataDirEntryCount: 3 }),
    );
    expect(verdict.action).toBe("REFUSE_DATA_DIR_NOT_EMPTY");
    expect(verdict).toHaveProperty("entryCount", 3);
  });

  it("refuses an existing database whose configuration has gone missing", () => {
    // The plausible-looking repair here is to initdb again, and it would destroy a database that
    // may hold everything the user has. The generated password is not recoverable from the
    // cluster, so the honest answer is to say what is wrong and stop.
    expect(
      classifyInstall(probes({ dataDirExists: true, clusterPresent: true, configPresent: false }))
        .action,
    ).toBe("REFUSE_CLUSTER_WITHOUT_CONFIG");
  });

  it("does not mistake its own cluster for a stranger's files", () => {
    // A cluster directory is full of files. Checking "not empty" before "is a cluster" would make
    // every second install refuse, which is the failure mode of a safety check nobody can satisfy.
    const verdict = classifyInstall(
      probes({
        dataDirExists: true,
        dataDirEmpty: false,
        dataDirEntryCount: 24,
        clusterPresent: true,
        configPresent: true,
      }),
    );
    expect(verdict.action).toBe("ALREADY_INSTALLED");
  });

  it("refuses an incomplete package before it looks at any directory", () => {
    // A package that cannot run has no business creating a database cluster, and the answer does
    // not depend on what is on disk.
    for (const over of [
      {},
      { dataDirExists: true, dataDirEmpty: false, dataDirEntryCount: 9 },
      { dataDirExists: true, clusterPresent: true, configPresent: true },
    ]) {
      expect(classifyInstall(probes({ ...over, applicationFilesPresent: false })).action).toBe(
        "REFUSE_INCOMPLETE_PACKAGE",
      );
    }
  });

  it("refuses when no PostgreSQL is bundled", () => {
    expect(classifyInstall(probes({ postgresPresent: false })).action).toBe("REFUSE_NO_POSTGRES");
  });

  it("only ever answers from the closed vocabulary, and reaches every verdict", () => {
    const seen = new Set(
      [
        {},
        { applicationFilesPresent: false },
        { postgresPresent: false },
        { dataDirExists: true, dataDirEmpty: false, dataDirEntryCount: 2 },
        { dataDirExists: true, clusterPresent: true, configPresent: false },
        { dataDirExists: true, clusterPresent: true, configPresent: true },
      ].map((over) => classifyInstall(probes(over)).action),
    );
    for (const action of seen) expect(INSTALL_ACTIONS).toContain(action);
    expect(seen.size).toBe(INSTALL_ACTIONS.length);
  });
});

describe("the installer program", () => {
  const install = code("install.mjs");

  it("generates a credential rather than shipping one", () => {
    expect(install).toContain("randomBytes(24)");
    expect(install).toContain("base64url");
  });

  it("generates one that cannot break a URL parser", () => {
    // Not tidiness. A password containing `?` makes `new URL` return an EMPTY password for the
    // connection string — measured while building the launcher's redactor — and `@` or `/` would
    // move where the authority ends. `base64url` contains none of them.
    expect(install).toContain("base64url");
    expect(install).not.toContain('toString("base64")');
    expect(install).not.toContain('toString("hex")\n');
  });

  it("never prints the credential it generated", () => {
    expect(install).toContain("credential=generated");
    // Every line that writes to a console, checked for the variable. Not "the file never
    // interpolates `password`": it must, once, to build the connection string it writes into
    // market-os.json, and the first version of this assertion forbade exactly the thing the
    // installer exists to do. What must never happen is that value reaching a console.
    const consoleLines = install.split("\n").filter((line) => line.includes("console."));
    expect(consoleLines.length).toBeGreaterThan(4);
    for (const line of consoleLines) {
      expect(line, `a console line mentions the password: ${line.trim()}`).not.toContain(
        "password",
      );
    }
  });

  it("interpolates the password exactly once, into the URL it stores", () => {
    // The counterpart to the check above: one use, and it is the intended one. A second would be
    // invisible to a reader and is the kind of thing a hurried edit adds.
    const uses = install.split("${password}").length - 1;
    expect(uses).toBe(1);
    const configFunction = install.slice(install.indexOf("function writeConfig"));
    expect(configFunction).toContain("${password}");
  });

  it("gives initdb the password through a file, not a command line", () => {
    // A command line is readable by every other process on the machine for as long as the program
    // runs.
    expect(install).toContain("--pwfile=");
    expect(install).not.toMatch(/--pwprompt|--password=\$\{/);
  });

  it("deletes that file even when initdb fails", () => {
    // The whole reason for the file is that it is brief.
    const pwfileWrite = install.indexOf("writeFileSync(pwfile");
    const cleanup = install.indexOf("rmSync(pwfile");
    expect(pwfileWrite).toBeGreaterThan(-1);
    expect(cleanup).toBeGreaterThan(pwfileWrite);
    expect(install).toContain("} finally {");
  });

  it("asks the operating system for a free port rather than guessing one", () => {
    // A hard-coded default collides with whatever else the user runs, and a candidate list is a
    // shorter list of collisions.
    expect(install).toContain("server.listen(0");
  });

  it("starts PostgreSQL without holding its output pipes open", () => {
    // The defect that hung the first real installation for twenty minutes. `pg_ctl start` launches
    // the server as a child and exits; the SERVER inherits the pipes, so `spawnSync` waits for
    // them to close — which happens when PostgreSQL shuts down, not when `pg_ctl` returns. The
    // cluster came up, the log filled with routine checkpoints, and market-os.json was never
    // written. Reproduced in isolation as `status: 0` alongside `ETIMEDOUT`.
    expect(install).toContain("function startPostgres");
    const start = install.slice(install.indexOf("function startPostgres"));
    expect(start.slice(0, 400)).toContain('stdio: "ignore"');
    // And the server's own output still has somewhere to go, so ignoring the streams costs
    // nothing a person would need.
    expect(install).toContain("postgres.log");
  });

  it("binds the cluster to loopback", () => {
    expect(install).toContain("-h 127.0.0.1");
  });

  it("does not write a .env, because a package does not have one", () => {
    expect(install).not.toMatch(/["'][^"'\n]*\.env\b/);
    expect(install).toContain("market-os.json");
  });
});

describe("the thing a user runs once", () => {
  const shim = source("Install Market OS.cmd");

  it("always holds the window open, unlike the launcher", () => {
    // This window is the ONLY place an installation's result is reported. A double-clicked
    // installer that closes instantly is indistinguishable from one that never ran, so the pause
    // is unconditional rather than on failure.
    const failureBranch = shim.indexOf("did not complete");
    const pause = shim.lastIndexOf("pause");
    expect(pause).toBeGreaterThan(failureBranch);
    expect(shim).toContain("Installation finished");
  });

  it("passes its arguments through, so --data-dir reaches the installer", () => {
    expect(shim).toContain('"%~dp0install.mjs" %*');
  });
});

describe("what a distribution may contain", () => {
  it("stages the installer separately from the runtime", () => {
    // A runtime staged for testing has no business carrying a program that runs `initdb`.
    for (const name of Object.keys(PACKAGED_INSTALLER_FILES)) {
      expect(Object.keys(PACKAGED_SETUP_FILES)).not.toContain(name);
    }
    expect(Object.keys(PACKAGED_INSTALLER_FILES)).toContain("install.mjs");
  });

  it("refuses a database data directory anywhere in a distribution", () => {
    // A distribution carries a PostgreSQL INSTALLATION and never somebody's database. The rule
    // applies under `node_modules` too, because the rule is about what the directory IS.
    expect(isForbiddenStagedPath("pgdata/PG_VERSION")).toBe(true);
    expect(isForbiddenStagedPath("pgsql/pgdata/base/1/2600")).toBe(true);
    expect(isForbiddenStagedPath("node_modules/x/pgdata/PG_VERSION")).toBe(true);
    // And accepts the installation itself, which is the half a too-broad rule would take with it.
    expect(isForbiddenStagedPath("pgsql/bin/initdb.exe")).toBe(false);
    expect(isForbiddenStagedPath("pgsql/share/postgresql.conf.sample")).toBe(false);
  });

  it("keeps a reason beside every refusal, so a failure explains itself", () => {
    for (const pattern of FORBIDDEN_STAGED_PATTERNS) {
      expect(pattern.why.length).toBeGreaterThan(4);
    }
  });
});
