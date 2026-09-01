/**
 * WHICH PROCESS owns the socket listening on a loopback port — from OS evidence only.
 *
 * Split out of `e2e-tree-binding.ts` because it is the part with a platform matrix and the part
 * whose failure mode is silent. Everything here answers one question and refuses to answer it
 * loosely: a positive result must come from kernel-backed socket ownership, and anything short of
 * that returns null so the caller fails closed.
 *
 * ## WHY THIS EXISTS
 *
 * Discovery was Windows-only. CI runs on Linux, where it found nothing and every verdict collapsed
 * to UNPROVEN — so the check gated nothing in the environment that gates merges, and the tests
 * could only exercise injected decision logic. That gap was reported rather than papered over, and
 * this closes it.
 *
 * ## WHAT IS NOT EVIDENCE, and each of these was named as a way to get this wrong
 *
 * Process NAME or image. Command-line substrings. Working directory. Which `node` happens to be
 * running. Age. Whichever PID makes a test pass. A `node_modules` path shared between checkouts.
 * None of them identify a socket owner, and several would confidently select the wrong process on
 * this machine, where two worktrees share one `node_modules`.
 *
 * ## RACE AWARENESS
 *
 * A socket can be handed off and a PID can be reused between two observations. Identity is
 * therefore read TWICE around the lookup and must agree on both the PID and the process's own
 * start token; if it does not, the answer is null. A stable wrong answer is worse than no answer,
 * because the caller would treat it as evidence.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, readlinkSync } from "node:fs";

export interface ListenerIdentity {
  pid: number;
  exe: string | null;
  commandLine: string | null;
  started: Date | null;
  /**
   * An exact, platform-native token for "this specific process instance".
   *
   * Compared across the two observations instead of the derived `started` Date, because the token
   * needs no arithmetic and therefore cannot drift: on Linux it is the raw `starttime` field in
   * clock ticks, on Windows the raw creation timestamp. A PID that was reused between observations
   * will not reproduce it.
   */
  identityToken: string;
  /** Which OS mechanism produced this, printed in the report so the reader can judge it. */
  authority: string;
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

/* ------------------------------------------------------------------ Windows */

function discoverWindows(port: number): ListenerIdentity | null {
  // The port is validated by the caller and interpolated as a bare integer; nothing from the URL
  // reaches the shell as text.
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
    if (typeof j.ProcessId !== "number") return null;
    // PowerShell renders CIM datetimes as `/Date(1234567890123)/` under ConvertTo-Json.
    const epoch = j.CreationDate ? /\/Date\((\d+)\)\//.exec(j.CreationDate)?.[1] : undefined;
    return {
      pid: j.ProcessId,
      exe: j.ExecutablePath ?? null,
      commandLine: j.CommandLine ?? null,
      started: epoch ? new Date(Number(epoch)) : j.CreationDate ? new Date(j.CreationDate) : null,
      identityToken: j.CreationDate ?? "",
      authority: "Get-NetTCPConnection -> Win32_Process (socket owner)",
    };
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------- Linux */

/**
 * The listening socket's inode, from `/proc/net/tcp` and `/proc/net/tcp6`.
 *
 * Columns: `sl local_address rem_address st ... inode`. `local_address` is `HEXIP:HEXPORT`, the
 * port big-endian. `st` is `0A` for LISTEN — checked, so an established connection to the same
 * port number is never mistaken for the listener.
 *
 * AMBIGUITY REFUSES. A port can be bound by more than one socket — separate v4 and v6 listeners,
 * or SO_REUSEPORT across processes. If the inodes resolve to more than one distinct owner the
 * answer is null, because "one of these two" is not an identification.
 */
function listeningInodes(port: number): string[] {
  const inodes: string[] = [];
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n").slice(1)) {
      const f = line.trim().split(/\s+/);
      if (f.length < 10) continue;
      const [, local, , state] = f;
      if (state !== "0A") continue;
      const hexPort = local.split(":")[1];
      if (hexPort === undefined || parseInt(hexPort, 16) !== port) continue;
      inodes.push(f[9]);
    }
  }
  return inodes;
}

/** The PIDs holding any of these socket inodes open, by walking `/proc/<pid>/fd`. */
function pidsHoldingInodes(inodes: Set<string>): Set<number> {
  const owners = new Set<number>();
  let entries: string[];
  try {
    entries = readdirSync("/proc");
  } catch {
    return owners;
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    let fds: string[];
    try {
      fds = readdirSync(`/proc/${pid}/fd`);
    } catch {
      // Another user's process, or one that exited mid-scan. Not readable is not a match, and it
      // is deliberately not an error either: the scan continues and a genuinely unreadable owner
      // ends as "no owner found", which fails closed.
      continue;
    }
    for (const fd of fds) {
      let target: string;
      try {
        target = readlinkSync(`/proc/${pid}/fd/${fd}`);
      } catch {
        continue;
      }
      const m = /^socket:\[(\d+)\]$/.exec(target);
      if (m && inodes.has(m[1])) {
        owners.add(pid);
        break;
      }
    }
  }
  return owners;
}

/** Boot time in epoch seconds, from `/proc/stat`. */
function bootTimeSeconds(): number | null {
  try {
    const m = /^btime\s+(\d+)$/m.exec(readFileSync("/proc/stat", "utf8"));
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/**
 * `starttime` (field 22 of `/proc/<pid>/stat`) as the raw identity token, plus an absolute Date.
 *
 * The comm field can contain spaces and parentheses, so everything before the LAST `)` is skipped
 * rather than split on whitespace from the left — a process named `foo bar) baz` would otherwise
 * shift every subsequent field.
 *
 * USER_HZ is 100. That is the kernel's userspace ABI constant for these fields, fixed independently
 * of CONFIG_HZ, so it is a documented interface rather than an assumption about this machine. The
 * derived Date is used only for start-order comparison; the RAW ticks are what identity is checked
 * against, so even if the derivation were wrong the race check would not be.
 */
function processStart(pid: number): { started: Date | null; token: string } | null {
  let stat: string;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    return null;
  }
  const close = stat.lastIndexOf(")");
  if (close < 0) return null;
  const fields = stat
    .slice(close + 2)
    .trim()
    .split(/\s+/);
  // After the comm field, `state` is index 0, so `starttime` (field 22 overall) is index 19.
  const ticks = fields[19];
  if (ticks === undefined || !/^\d+$/.test(ticks)) return null;
  const btime = bootTimeSeconds();
  const started = btime === null ? null : new Date((btime + Number(ticks) / 100) * 1000);
  return { started, token: ticks };
}

function readMaybe(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function discoverLinux(port: number): ListenerIdentity | null {
  const inodes = listeningInodes(port);
  if (inodes.length === 0) return null;

  const owners = pidsHoldingInodes(new Set(inodes));
  // Zero owners: the socket exists but no readable process holds it — another user, or it closed
  // mid-scan. More than one: genuinely ambiguous. Both fail closed.
  if (owners.size !== 1) return null;
  const pid = [...owners][0];

  const start = processStart(pid);
  if (start === null) return null;

  const exe = (() => {
    try {
      return readlinkSync(`/proc/${pid}/exe`);
    } catch {
      return null;
    }
  })();
  const cmdline = readMaybe(`/proc/${pid}/cmdline`);

  return {
    pid,
    exe,
    // `cmdline` is NUL-separated. Recorded for the report only; it is never evidence of identity.
    commandLine: cmdline === null ? null : cmdline.replace(/\0/g, " ").trim() || null,
    started: start.started,
    identityToken: start.token,
    authority: "/proc/net/tcp inode -> /proc/<pid>/fd (socket owner)",
  };
}

/* --------------------------------------------------------------- dispatcher */

/**
 * Discover the listener twice and require the two observations to agree.
 *
 * Returns null on: an unsupported platform, no listener, an unreadable or ambiguous owner, a parse
 * failure, or a PID/identity-token mismatch between the observations. The caller turns every one
 * of those into UNPROVEN, which is the only honest reading of "we could not tell".
 */
export function discoverListener(port: number): ListenerIdentity | null {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;

  const discover = process.platform === "win32" ? discoverWindows : discoverLinux;
  if (process.platform !== "win32" && process.platform !== "linux") return null;

  const first = discover(port);
  if (first === null) return null;
  const second = discover(port);
  if (second === null) return null;
  if (first.pid !== second.pid || first.identityToken !== second.identityToken) return null;
  return first;
}
