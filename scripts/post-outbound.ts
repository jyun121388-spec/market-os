/**
 * Post an outbound control-bus message THROUGH the lifecycle, instead of beside it.
 *
 * Every comment this session has posted went out by hand: `gh issue comment`, then `gh api` to read
 * it back. That satisfies the invariant and records nothing, which is why the durable outbox is
 * empty and why `controlBusStanding` has never once been able to say `OPEN` about a real id. The
 * producer built for IR-115 had test callers only. This is the production caller.
 *
 *   npx tsx scripts/post-outbound.ts --id ESC-014 --kind ESCALATION --body-file draft.md \
 *     [--bus-root .local/control-bus] [--confirm]
 *
 * WITHOUT `--confirm` it is a dry run: screen the body, look for an existing comment, print what
 * would happen, post nothing. The default is the safe one because the irreversible step here is a
 * comment on a public issue.
 */

import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transmitAndCommit, type OutboundDeps } from "../src/server/controlbus/outbound";
import {
  bodyDigest,
  CONTROL_BUS_REPOSITORY,
  isTransmitted,
  type ControlBusState,
} from "../src/server/controlbus/state";
import { RUNTIME_DIR, storePaths } from "../src/server/controlbus/store";
import { mayPostPublicly } from "../src/server/escalation/screen";
import { ghTransport } from "./gh-transport";

/** Same 45s budget the watcher writes its heartbeat on. */
const HEARTBEAT_STALE_MS = 45_000;

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

async function main(): Promise<number> {
  const protocolId = arg("id");
  const kind = arg("kind");
  const bodyFile = arg("body-file");
  const root = arg("bus-root") ?? RUNTIME_DIR;
  const confirm = process.argv.includes("--confirm");

  if (!protocolId || !bodyFile || (kind !== "ESCALATION" && kind !== "CLAUDE_APPLIED")) {
    console.error("usage: --id <protocolId> --kind ESCALATION|CLAUDE_APPLIED --body-file <path>");
    return 2;
  }

  const body = readFileSync(bodyFile, "utf8");

  // A fast-fail, so a body with a secret in it never reaches the store or the network and the
  // operator sees the finding immediately. It is NOT the guarantee: `transmitAndCommit`
  // screens again, because the guarantee belongs to the operation and not to this caller.
  const screen = mayPostPublicly(body);
  if (!screen.allowed) {
    console.error("SCREEN REFUSED — nothing was sent");
    for (const finding of screen.findings)
      console.error(`  line ${finding.line}  ${finding.category}: ${finding.reason}`);
    return 1;
  }

  const paths = storePaths(root);
  const state = JSON.parse(readFileSync(paths.state, "utf8")) as ControlBusState;
  const digest = bodyDigest(body);
  const transport = ghTransport(CONTROL_BUS_REPOSITORY, state.issueNumber, (b) => {
    const file = join(tmpdir(), `outbound-${protocolId}-${digest.slice(0, 12)}.md`);
    writeFileSync(file, b, "utf8");
    return file;
  });

  if (!confirm) {
    // The dry run answers the only two questions worth knowing before sending: is it already there,
    // and is it already proven here.
    const already = state.outbox.find(
      (e) =>
        e.protocolId === protocolId &&
        bodyDigest(e.body) === digest &&
        isTransmitted(e, { repository: CONTROL_BUS_REPOSITORY, issueNumber: state.issueNumber }),
    );
    const remote = await transport.find(protocolId, digest);
    console.log(`DRY RUN  ${protocolId}  ${kind}  digest ${digest.slice(0, 16)}`);
    console.log(`  screen        PASS (${screen.findings.length} advisory finding(s))`);
    console.log(`  durable proof ${already ? "ALREADY PRESENT" : "none"}`);
    console.log(`  remote match  ${remote ? `comment ${remote.commentId}` : "none"}`);
    console.log(
      remote && !already
        ? "  -> --confirm would ADOPT the existing comment rather than post again"
        : already
          ? "  -> --confirm would report ALREADY_PROVEN and send nothing"
          : "  -> --confirm would POST, read back, verify, and commit",
    );
    return 0;
  }

  const deps: OutboundDeps = {
    now: () => new Date().toISOString(),
    heartbeatStaleMs: HEARTBEAT_STALE_MS,
    nowMs: () => Date.now(),
    // A fresh lease identity for this run: pid AND nonce, because a pid alone is not an identity.
    claim: {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      nonce: randomUUID(),
    },
  };

  const outcome = await transmitAndCommit(
    paths,
    state,
    { protocolId, kind, body, composedAt: new Date().toISOString() },
    transport,
    deps,
  );

  console.log(`${outcome.status}  ${protocolId}`);
  if (outcome.status === "REFUSED") {
    console.log(`  ${outcome.reason}`);
    console.log(outcome.entry ? "  the attempt is recorded, without proof" : "  nothing written");
    return 1;
  }
  console.log(`  comment ${outcome.entry.transmission?.commentId}`);
  console.log(`  digest  ${outcome.entry.transmission?.bodyDigest.slice(0, 16)}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`FAILED: ${(error as Error).message}`);
    process.exit(1);
  },
);
