/**
 * WHERE the control bus is. Nothing here reads a decision, and that separation is deliberate.
 *
 * This lived in `store.ts` for about an hour, and `tests/applicationPrerequisite.test.ts` failed:
 * that guard looks for a module which both consumes control-bus decisions and performs an effect,
 * and requires it to go through the application journal. `store.ts` names the inbox-entry type, and
 * asking git for a path means spawning a process, so the pair tripped it.
 *
 * The guard calls itself deliberately shallow, and the right answer to a shallow guard is not an
 * exemption. Splitting the module makes its predicate FALSE rather than excused: the file that
 * spawns a process knows nothing about decisions, and the file that knows about decisions spawns
 * nothing. That is the property the guard is a proxy for.
 *
 * The guard matches on TEXT, so this comment tripped it once more by naming that type in prose.
 * Also not worth an exemption — a shallow check that runs is worth more than a clever one that
 * gets deleted, and paying its price in a sentence is the whole bargain.
 */

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";

/**
 * The bus directory's NAME inside the repository. Not, on its own, a place.
 *
 * It was used as one, and that was the defect: `storePaths()` defaulted to this relative string, so
 * every module agreed on the name of the bus and nothing agreed on its location. Resolved against
 * `process.cwd()`, one name denoted two directories:
 *
 *     from C:/AI-Projects/market-os               -> market-os/.local/control-bus        EXISTS
 *     from C:/AI-Projects/market-os-ask-guardrail -> guardrail/.local/control-bus        ABSENT
 *
 * — measured, from the two worktrees of this repository that actually exist. Reading from the
 * second reports an empty inbox, which `stop-evidence.ts` at least refuses to call zero. WRITING
 * from it is the real hazard: `scripts/control-bus.ts` and `scripts/rc-preflight.ts` take no root
 * argument at all, so starting the watcher from the wrong worktree would have created a SECOND
 * durable inbox with its own independently advancing cursor. `CLAUDE.md` says "one issue, never a
 * second", and `DURABLE_INBOX_BEFORE_CURSOR_ADVANCE` assumes there is one cursor to advance; two of
 * them lose decisions to each other while each looks perfectly healthy.
 *
 * It had not fired. Every write so far passed `--bus-root` by hand, which is discipline, not a
 * property.
 */
export const RUNTIME_DIR = ".local/control-bus";

/**
 * Where the bus IS: one directory per repository, identical from every worktree.
 *
 * `git rev-parse --path-format=absolute --git-common-dir` answers with the shared `.git` — the same
 * absolute path whether asked from the main worktree or a linked one — and the bus sits beside it.
 * One rule both sides of the boundary obey, rather than a second check bolted onto the relative
 * name.
 *
 * `--path-format=absolute` is load-bearing and must precede the option it governs: the plain form
 * returns `.git` from the main worktree and an absolute path from anywhere else, which is the same
 * cwd-dependence in a new costume — and it looks like no defect at all when tested from a linked
 * worktree, which is where this repository's test suite runs.
 *
 * Fails CLOSED. If git cannot answer there is no fallback to the working directory, because the
 * working directory is what was wrong.
 */
export function repositoryBusRoot(
  cwd: string = process.cwd(),
): { root: string } | { error: string } {
  let common: string;
  try {
    common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    return {
      error: `git cannot name the repository from ${cwd} (${(error as Error).message.split("\n")[0]})`,
    };
  }
  if (!common) return { error: `git named no common directory from ${cwd}` };
  return { root: join(dirname(common), RUNTIME_DIR) };
}

/** The resolved root, or a refusal loud enough that nobody quietly writes to the wrong bus. */
export function defaultBusRoot(): string {
  const found = repositoryBusRoot();
  if ("error" in found) {
    throw new Error(
      `the control bus root cannot be resolved: ${found.error}. Pass an explicit root; falling ` +
        `back to the working directory is the defect this replaced.`,
    );
  }
  return found.root;
}
