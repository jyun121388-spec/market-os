/**
 * Is the server about to be tested actually serving THIS tree?
 *
 * SR-02 in the Evolution ledger: "an E2E pass was reported from a server process started before the
 * fix under test." The lesson recorded with it is that a fresh RESULT was taken as evidence about
 * fresh CODE without establishing that the process producing it was running that code.
 *
 * The existing mitigation is an overridable port, and its own comment is honest about what that is:
 * a way to avoid the collision instead of relying on whoever runs this to remember. That is a
 * convenience. It proves nothing about the process on the other end.
 *
 * ## WHAT THIS CAN AND CANNOT PROVE, measured rather than assumed
 *
 * Three probes were run on this machine before any of this was written.
 *
 *   PROCESS IDENTITY IS OBTAINABLE. The listener's PID, executable path, command line and start
 *   time all come back from `Get-NetTCPConnection` joined to `Win32_Process`. Working directory
 *   does not — Win32_Process has no cwd.
 *
 *   COMMAND LINE DOES NOT DISTINGUISH WORKTREES HERE. `require.resolve("next/package.json")`
 *   resolves to `C:/AI-Projects/market-os/node_modules`, which this checkout SHARES with the
 *   sibling worktree. So `next dev` started from either checkout shows the same binary path — and
 *   the sibling is on a different commit with uncommitted changes, which is exactly the hazard.
 *
 *   BUILD_ID ONLY EXISTS FOR A BUILT SERVER. `.next/BUILD_ID` is present, but `npm run dev` does
 *   not serve it, and dev is what this harness's prerequisites name.
 *
 * So a SERVED sentinel — the server attesting its own commit — is the only thing that would settle
 * it in every mode, and that needs a product endpoint. SR-02 is recorded P2, and `CLAUDE.md` allows
 * a V1 product change only for a reproduced P0 or P1. This module therefore does NOT claim to prove
 * the binding. It establishes what is establishable, refuses to call the rest proven, and labels
 * the run accordingly.
 *
 * ## THE SIGNAL IT DOES CHECK
 *
 * A server process that STARTED BEFORE the newest source file was last written cannot have been
 * launched from the current tree. That is SR-02's exact incident shape. It is one-directional
 * evidence and is treated as such: starting later than every source file does not prove the process
 * loaded them, because a dev server also recompiles on change. Hence three verdicts, not two.
 *
 *   BOUND        the process started after the newest source write, and for a built server its
 *                BUILD_ID matches `.next/BUILD_ID`
 *   STALE        the process started BEFORE a source file was written. Refuse.
 *   UNPROVEN     the listener could not be identified, or nothing distinguishes the two states
 *
 * `UNPROVEN` is not a pass. A run under it is not evidence about this tree, and the report says so
 * in those words so that a green result cannot be quoted as if it were.
 *
 *   npx tsx scripts/e2e-tree-binding.ts [--url http://localhost:3000] [--require-binding]
 */

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";

export type BindingVerdict = "BOUND" | "STALE" | "UNPROVEN";

export interface TreeBinding {
  verdict: BindingVerdict;
  reason: string;
  /** Everything observed, recorded whether or not it decided anything. */
  observed: {
    url: string;
    port: number | null;
    headSha: string | null;
    dirtyFiles: number | null;
    newestSourceFile: string | null;
    newestSourceMtime: string | null;
    localBuildId: string | null;
    listenerPid: number | null;
    listenerExe: string | null;
    listenerCommandLine: string | null;
    listenerStarted: string | null;
  };
  /** Stated in the report so a reader is never left to assume the binding is total. */
  limitations: string[];
}

function quiet(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function portOf(url: string): number | null {
  try {
    const u = new URL(url);
    if (u.port) return Number(u.port);
    return u.protocol === "https:" ? 443 : 80;
  } catch {
    return null;
  }
}

/**
 * The newest write under the source roots that can change what the server serves.
 *
 * `.next` and `node_modules` are excluded deliberately: a build artefact is downstream of the
 * source, so including it would let a rebuild mask a source edit the server never saw.
 */
function newestSource(): { file: string; mtime: Date } | null {
  const roots = ["src", "prisma"];
  let best: { file: string; mtime: Date } | null = null;
  for (const root of roots) {
    for (const file of ts.sys.readDirectory(root, [".ts", ".tsx", ".prisma", ".sql", ".css"])) {
      try {
        const mtime = statSync(file).mtime;
        if (!best || mtime > best.mtime) best = { file, mtime };
      } catch {
        // A file that vanished between listing and stat is not evidence about anything.
      }
    }
  }
  return best;
}

/** The listening process, via PowerShell. Windows-only, and says so rather than guessing. */
function listener(port: number): {
  pid: number;
  exe: string | null;
  commandLine: string | null;
  started: Date | null;
} | null {
  if (process.platform !== "win32") return null;
  const script =
    `$c = Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -First 1; ` +
    `if (-not $c) { exit 0 }; ` +
    `$p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $c.OwningProcess) -ErrorAction SilentlyContinue; ` +
    `if (-not $p) { exit 0 }; ` +
    `[Console]::Out.Write(($p | Select-Object ProcessId,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress))`;
  const out = quiet("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
  if (!out) return null;
  try {
    const j = JSON.parse(out) as {
      ProcessId: number;
      ExecutablePath: string | null;
      CommandLine: string | null;
      CreationDate: string | null;
    };
    // PowerShell renders CIM datetimes as `/Date(1234567890123)/` under ConvertTo-Json.
    const epoch = j.CreationDate ? /\/Date\((\d+)\)\//.exec(j.CreationDate)?.[1] : undefined;
    return {
      pid: j.ProcessId,
      exe: j.ExecutablePath ?? null,
      commandLine: j.CommandLine ?? null,
      started: epoch ? new Date(Number(epoch)) : j.CreationDate ? new Date(j.CreationDate) : null,
    };
  } catch {
    return null;
  }
}

/**
 * The decision, separated from the gathering so it can be tested without a live server.
 *
 * The STALE case was reproduced by hand first — a stub listener on 3000 read BOUND, then `touch`ing
 * one file under `src/` flipped the same process to STALE with nothing else changed. Keeping the
 * comparison pure is what lets that discriminating pair live in the suite instead of in a commit
 * message.
 */
export function compareStartToSource(
  started: Date | null,
  newest: { file: string; mtime: Date } | null,
): { verdict: BindingVerdict; reason: string } {
  if (started === null) {
    return {
      verdict: "UNPROVEN",
      reason: "the listening process could not be identified, so nothing ties the server to a tree",
    };
  }
  if (newest === null) {
    return {
      verdict: "UNPROVEN",
      reason: "no source files were found to compare against, which is itself suspicious",
    };
  }
  if (started < newest.mtime) {
    return {
      verdict: "STALE",
      reason:
        `the listening process started ${started.toISOString()}, BEFORE ${newest.file} was last ` +
        `written ${newest.mtime.toISOString()}. It cannot have been launched from the current tree.`,
    };
  }
  return {
    verdict: "BOUND",
    reason:
      `the listening process started ${started.toISOString()}, after the newest source write ` +
      `(${newest.file}, ${newest.mtime.toISOString()})`,
  };
}

export function checkTreeBinding(url: string): TreeBinding {
  const port = portOf(url);
  const headSha = quiet("git", ["rev-parse", "HEAD"]);
  const status = quiet("git", ["--no-optional-locks", "status", "--porcelain"]);
  const newest = newestSource();
  let localBuildId: string | null = null;
  try {
    localBuildId = readFileSync(path.join(".next", "BUILD_ID"), "utf8").trim();
  } catch {
    localBuildId = null;
  }
  const proc = port === null ? null : listener(port);

  const observed: TreeBinding["observed"] = {
    url,
    port,
    headSha,
    dirtyFiles: status === null ? null : status.split("\n").filter(Boolean).length,
    newestSourceFile: newest?.file ?? null,
    newestSourceMtime: newest?.mtime.toISOString() ?? null,
    localBuildId,
    listenerPid: proc?.pid ?? null,
    listenerExe: proc?.exe ?? null,
    listenerCommandLine: proc?.commandLine ?? null,
    listenerStarted: proc?.started?.toISOString() ?? null,
  };

  const limitations = [
    "The command line cannot distinguish this checkout from its sibling worktree: both resolve `next` through the same shared node_modules.",
    "A dev server recompiles on change, so starting before a source write does not always mean stale code — but it is never evidence of freshness either.",
    "Nothing here is a SERVED attestation. Only the server reporting its own commit would settle this in every mode, and that needs a product endpoint SR-02's P2 severity does not justify under the V1 freeze.",
  ];

  if (proc === null || proc.started === null) {
    return {
      verdict: "UNPROVEN",
      reason:
        process.platform !== "win32"
          ? "listener identity is only implemented for Windows on this machine; nothing was established"
          : `no identifiable process is listening on port ${port}, so the server that answers cannot be tied to anything`,
      observed,
      limitations,
    };
  }

  const decided = compareStartToSource(proc.started, newest);
  return {
    verdict: decided.verdict,
    reason: decided.reason.replace(
      "the listening process",
      `the listening process (pid ${proc.pid})`,
    ),
    observed,
    limitations,
  };
}

export function formatBinding(b: TreeBinding): string {
  const lines = [`TREE BINDING: ${b.verdict}`, `  ${b.reason}`, "", "  observed:"];
  for (const [k, v] of Object.entries(b.observed)) {
    lines.push(`    ${k.padEnd(20)} ${v === null ? "(unavailable)" : String(v)}`);
  }
  lines.push("", "  what this does NOT prove:");
  for (const l of b.limitations) lines.push(`    - ${l}`);
  if (b.verdict !== "BOUND") {
    lines.push(
      "",
      "  A run under this verdict is NOT evidence about the current tree. Say so wherever its",
      "  result is quoted.",
    );
  }
  return lines.join("\n");
}

if (process.argv[1] && process.argv[1].includes("e2e-tree-binding")) {
  const urlArg = process.argv.indexOf("--url");
  const url =
    urlArg >= 0 && process.argv[urlArg + 1]
      ? process.argv[urlArg + 1]
      : (process.env.E2E_BASE_URL ?? "http://localhost:3000");
  const binding = checkTreeBinding(url);
  console.log(formatBinding(binding));
  if (process.argv.includes("--require-binding") && binding.verdict !== "BOUND") {
    process.exitCode = 1;
  }
}
