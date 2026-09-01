/**
 * Does an open file handle actually stop another process deleting or renaming the file?
 *
 * IR-075 in `store.ts` records a residual race and names the fix it would need: "hold the lock file
 * OPEN for the process lifetime. On Windows an open handle cannot be deleted or renamed by another
 * process, so exclusion is enforced by the OS rather than inferred from timestamps."
 *
 * That is an ASSERTION ABOUT THE PLATFORM sitting in a comment, and the next attempt at IR-075
 * would build a lock rewrite on top of it. This measures it instead. Whichever way it comes out,
 * the answer is worth more than the sentence: if it holds, a future rewrite starts from measured
 * ground; if it does not, the recorded "real fix" is wrong and would have cost a review cycle to
 * discover.
 *
 * The subtlety it is really testing is not Windows but NODE: Win32 exclusion depends on the share
 * mode a handle is opened with, and `fs.openSync` does not let a caller choose it. So the question
 * is not "can Windows do this" — it is "does an ordinary Node handle do this", which is what any
 * implementation here would actually have.
 *
 *   npx tsx scripts/probe-open-handle-exclusion.ts
 *
 * Writes only into a temp directory and removes it. Touches no control-bus state.
 */

import { execFileSync } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Attempt = { attempt: string; blocked: boolean; detail: string };

/**
 * Runs one destructive operation from a SEPARATE process, because that is the only thing the claim
 * is about. Same-process attempts prove nothing: the handle table is shared.
 */
function fromAnotherProcess(script: string): { threw: boolean; detail: string } {
  try {
    const out = execFileSync(process.execPath, ["-e", script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { threw: false, detail: out.trim() || "succeeded" };
  } catch (error) {
    const message = (error as { stderr?: string; message: string }).stderr ?? "";
    return { threw: true, detail: (message || (error as Error).message).trim().split("\n")[0] };
  }
}

export function probe(): { platform: string; attempts: Attempt[] } {
  const dir = mkdtempSync(join(tmpdir(), "open-handle-"));
  const target = join(dir, "held.lock").replace(/\\/g, "/");
  const renamed = join(dir, "moved.lock").replace(/\\/g, "/");
  writeFileSync(target, "held\n", "utf8");

  // Held open for the whole probe, exactly as an IR-075 rewrite would hold it.
  const fd = openSync(target, "r+");
  const attempts: Attempt[] = [];
  try {
    const unlink = fromAnotherProcess(
      `require("fs").unlinkSync(${JSON.stringify(target)}); console.log("unlinked")`,
    );
    attempts.push({
      attempt: "unlink from another process",
      blocked: unlink.threw,
      detail: unlink.detail,
    });

    // Only meaningful if the file survived the unlink.
    if (existsSync(target)) {
      const rename = fromAnotherProcess(
        `require("fs").renameSync(${JSON.stringify(target)}, ${JSON.stringify(renamed)}); console.log("renamed")`,
      );
      attempts.push({
        attempt: "rename from another process",
        blocked: rename.threw,
        detail: rename.detail,
      });
    } else {
      attempts.push({
        attempt: "rename from another process",
        blocked: false,
        detail: "not attempted — the unlink already removed it",
      });
    }

    const exclusiveCreate = fromAnotherProcess(
      `try { require("fs").writeFileSync(${JSON.stringify(target)}, "x", { flag: "wx" }); console.log("created"); } catch (e) { console.error(e.code); process.exit(1); }`,
    );
    attempts.push({
      attempt: "exclusive create over it",
      blocked: exclusiveCreate.threw,
      detail: exclusiveCreate.detail,
    });
  } finally {
    closeSync(fd);
    rmSync(dir, { recursive: true, force: true });
  }

  return { platform: process.platform, attempts };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  const { platform, attempts } = probe();
  console.log(`platform: ${platform}\n`);
  for (const a of attempts) {
    console.log(`  ${a.blocked ? "BLOCKED " : "allowed "}  ${a.attempt}`);
    console.log(`              ${a.detail}`);
  }
  const deletionBlocked = attempts.find((a) => a.attempt.startsWith("unlink"))?.blocked;
  console.log(
    `\nIR-075's premise — an open handle stops another process deleting the file — is ${
      deletionBlocked ? "SUPPORTED" : "NOT SUPPORTED"
    } by an ordinary Node handle here.`,
  );
}
