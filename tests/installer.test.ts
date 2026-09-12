import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { classifyInstall, INSTALL_ACTIONS } from "../packaging/install-classify.mjs";
import type { InstallProbes } from "../packaging/install-classify.js";
import { buildInstaller } from "../scripts/build-installer";
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

describe("the batch files, which cmd.exe reads in the console's codepage", () => {
  it("uses no byte above 0x7F, anywhere", () => {
    // An em dash (U+2014) in a COMMENT inside `Market OS.cmd` broke the entire launcher on a
    // machine whose console codepage is not UTF-8: cmd.exe mis-decoded the three bytes and then
    // executed the surrounding comment text as commands, reporting that `The`, `an` and `exactly`
    // were not recognised programs. Nothing about the failure pointed at an encoding.
    for (const name of ["Market OS.cmd", "Install Market OS.cmd"]) {
      const bytes = readFileSync(join(PACKAGING, name));
      const offending = bytes.findIndex((b) => b > 0x7f);
      expect(offending, `${name} has a non-ASCII byte at offset ${offending}`).toBe(-1);
    }
  });

  it("is copied through the packager that enforces that, not by a plain copy", () => {
    // Both staging paths use the same copier. Two copy paths with one of them lenient is how the
    // broken file ships anyway.
    const stager = readFileSync(join(process.cwd(), "scripts", "stage-runtime.ts"), "utf8");
    expect(stager).toContain("export function copyPackagedFile");
    expect(stager).toContain("0x7f");
    // And CRLF, because a .cmd with bare LF endings is a documented Windows hazard and the
    // checkout's line-ending settings vary by machine.
    //
    // Asserted through the variable name rather than by quoting the regex. Writing `\r` into an
    // expectation means writing it through two layers of escaping, and this environment collapses
    // backslashes in exactly that situation — the first version of this line compared against a
    // literal carriage return and failed on a stager that was correct.
    expect(stager).toContain("const crlf =");
    expect(stager).toContain("CRLF");
    const builder = readFileSync(join(process.cwd(), "scripts", "build-installer.ts"), "utf8");
    expect(builder).toContain("copyPackagedFile(join(REPO");
  });
});

describe("the bundled Node runtime", () => {
  const launcher = source("Market OS.cmd");
  const installer = source("Install Market OS.cmd");
  const builder = readFileSync(join(process.cwd(), "scripts", "build-installer.ts"), "utf8");

  it("is staged by the BUILD PIPELINE, not left to a leftover directory", () => {
    // The defect this closes: `Market OS.cmd` had looked for `node\node.exe` since it was written
    // and nothing ever created one. An old `node/` in a reused output tree could make a single
    // acceptance run pass while a clean rebuild still sent the user to nodejs.org.
    expect(builder).toContain("function stageNodeRuntime");
    expect(builder).toContain("BUNDLED_NODE_PATH");
    const staged = builder.indexOf("stageNodeRuntime(outDir, nodeSource)");
    expect(staged, "the build must actually call it").toBeGreaterThan(-1);
  });

  it("verifies the runtime by EXECUTING the staged binary, not by trusting the copy", () => {
    // A successful copy proves the filesystem worked. Asking the staged file its own version is
    // the only check that says what was copied.
    const fn = builder.slice(builder.indexOf("function stageNodeRuntime"));
    expect(fn.slice(0, 2000)).toContain('execFileSync(destination, ["-v"]');
    expect(fn.slice(0, 2000)).toContain("MINIMUM_BUNDLED_NODE_MAJOR");
  });

  it("fails packaging closed when the runtime is missing, unusable, symlinked or too old", () => {
    const fn = builder.slice(
      builder.indexOf("function stageNodeRuntime"),
      builder.indexOf("function arg("),
    );
    for (const refusal of [
      "no Node runtime at",
      "is a symlink",
      "would not execute",
      "is older than the required",
    ]) {
      expect(fn, `no refusal for: ${refusal}`).toContain(refusal);
    }
    // And a final check on the built tree, so a runtime that changed after verification is caught.
    expect(builder).toContain("is not in the built distribution");
    expect(builder).toContain("changed after it was verified");
  });

  it("pins and attests the runtime rather than reporting the build host", () => {
    // `nodeVersion: process.version` describes the machine that ran the build and says nothing
    // about what shipped. The manifest now carries a real identity for the bundled binary.
    expect(builder).toContain("nodeRuntime,");
    const fn = builder.slice(builder.indexOf("interface BundledNodeIdentity"));
    for (const field of ["version", "sha256", "bytes", "path"]) {
      expect(fn.slice(0, 900), `attestation lacks ${field}`).toContain(field);
    }
  });

  it("leaves the user entry points with no system-Node fallback at all", () => {
    // The delivery contract: normal operation must not require the user to install or understand
    // Node. A fallback to `where node` is that requirement wearing a helpful message.
    //
    // Scanned with `rem` lines removed, because the launcher's own comment explains what was taken
    // out and names it. That is the sixth time in this repository a substring scan has reported a
    // denial as the offence; the affirmative form is what must be absent, and the comment is
    // asserted separately below.
    const commands = (text: string) =>
      text
        .split(/\r?\n/)
        .filter((line) => !/^\s*rem\b/i.test(line))
        .join("\n");
    for (const [name, raw] of [
      ["Market OS.cmd", launcher],
      ["Install Market OS.cmd", installer],
    ] as const) {
      const text = commands(raw);
      expect(text, `${name} still falls back to a system Node`).not.toContain("where node");
      expect(text, `${name} still sends the user to install Node`).not.toContain("nodejs.org");
      expect(text, `${name} does not use the bundled runtime`).toContain("node\\node.exe");
      expect(text, `${name} does not treat a missing runtime as a damaged copy`).toContain(
        "is incomplete",
      );
    }
    // And the launcher says WHY the fallback is gone, so a later reader does not restore it as a
    // kindness.
    expect(launcher).toContain("THE BUNDLED RUNTIME IS THE ONLY RUNTIME");
  });
});

describe("where a distribution may be built", () => {
  const builder = readFileSync(join(process.cwd(), "scripts", "build-installer.ts"), "utf8");
  const stager = readFileSync(join(process.cwd(), "scripts", "stage-runtime.ts"), "utf8");

  it("refuses an output directory that already contains a previous build's runtime", () => {
    // A build over residue produces a manifest about bytes it did not create. It happened once as
    // an over-count (13,929 application files, the whole tree read as the application), and the
    // bundled runtime makes the failure worse in kind rather than in degree: a `node/` left by an
    // earlier build would let an acceptance run pass on a runtime this build never staged.
    // `stageNodeRuntime` cannot catch that, because the file it finds is real.
    const dir = mkdtempSync(join(tmpdir(), "mos-residue-"));
    try {
      mkdirSync(join(dir, "node"), { recursive: true });
      writeFileSync(join(dir, "node", "node.exe"), "not the runtime this build staged");
      expect(() => buildInstaller(dir, join(process.cwd(), "no-such-postgres"))).toThrow(
        /already exists/,
      );
      // The refusal names the residue, so the operator is not left guessing what was in the way.
      expect(() => buildInstaller(dir, join(process.cwd(), "no-such-postgres"))).toThrow(/node/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses an empty directory too, because an empty one is not a safe destination here", () => {
    // Emptiness would be the natural rule and it is the wrong one on this machine: Node v24.14.0
    // aborts the whole process, silently, when `cpSync` is given an EXISTING destination directly
    // under a drive root. A refusal that accepted `C:\MarketOS-V1` because it happened to be empty
    // would hand that abort straight to the operator, with no output to diagnose it from.
    const dir = mkdtempSync(join(tmpdir(), "mos-empty-"));
    try {
      expect(() => buildInstaller(dir, join(process.cwd(), "no-such-postgres"))).toThrow(
        /already exists/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not pre-create the output directory, so the first copy is the one that makes it", () => {
    // The other half of the same defect: refusing an existing directory achieves nothing if the
    // stager then creates it and copies into it. Asserted on the source, because the alternative is
    // a test that builds a real distribution.
    const copyInto = stager.slice(
      stager.indexOf("function copyInto("),
      stager.indexOf("function gitOutput("),
    );
    expect(copyInto.length, "copyInto not found").toBeGreaterThan(100);
    expect(copyInto, "copyInto pre-creates its destination again").not.toContain("mkdirSync(to");
    expect(stager).not.toMatch(/mkdirSync\(outDir, \{ recursive: true \}\);/);
    expect(
      copyInto,
      "the reason must survive, or someone restores the mkdir as tidiness",
    ).toContain("0xC0000409");
    expect(builder).toContain("0xC0000409");
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
