/**
 * What kinds does the control-bus channel ACTUALLY carry, and how many does the parser know?
 *
 * READ ONLY. Written because `CLAUDE.md` states the answer and states it wrongly, and I quoted that
 * wrong answer twice in one session while deferring a question to an escalation that turns out
 * never to have been drafted.
 *
 *   npx tsx scripts/channel-kinds.ts [--issue 2]
 *
 * The point is not the list. It is that the list should be MEASURED: a prose inventory of what a
 * channel carries drifts the moment the channel carries something new, and nothing notices.
 */

import { execFileSync } from "node:child_process";
import { CONTROL_BUS_REPOSITORY } from "../src/server/controlbus/state";

/** The kinds `parseProtocolMessage` will admit. Everything else is dropped by the bus. */
export const PARSED_KINDS = ["ESCALATION", "CHATGPT_DECISION", "CLAUDE_APPLIED"] as const;

/** A leading `[TAG]` at the very start of a comment body. */
const LEADING_TAG = /^\[([A-Z][A-Z_]*)\]/;

export interface KindCount {
  kind: string;
  count: number;
  /** Does `ProtocolKind` admit it? */
  parsed: boolean;
  /** Inbound kinds are the ones this repository does not write. */
  direction: "inbound" | "outbound";
}

export function tally(bodies: string[]): KindCount[] {
  const counts = new Map<string, number>();
  for (const body of bodies) {
    const match = LEADING_TAG.exec(body.trimStart());
    if (!match) continue;
    counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([kind, count]) => ({
      kind,
      count,
      parsed: (PARSED_KINDS as readonly string[]).includes(kind),
      // `CLAUDE_*` and `ESCALATION` are written from here; everything else arrives.
      direction:
        kind.startsWith("CLAUDE_") || kind === "ESCALATION"
          ? ("outbound" as const)
          : ("inbound" as const),
    }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}

export function fetchBodies(issueNumber: number): string[] {
  const raw = execFileSync(
    "gh",
    ["api", `repos/${CONTROL_BUS_REPOSITORY}/issues/${issueNumber}/comments`, "--paginate"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const parsed = JSON.parse(raw) as { body: string }[] | { body: string }[][];
  const flat = (Array.isArray(parsed[0]) ? parsed.flat() : parsed) as { body: string }[];
  return flat.map((c) => c.body ?? "");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  const at = process.argv.indexOf("--issue");
  const issue = at === -1 ? 2 : Number(process.argv[at + 1]);
  const rows = tally(fetchBodies(issue));

  const inbound = rows.filter((r) => r.direction === "inbound");
  const outbound = rows.filter((r) => r.direction === "outbound");

  for (const [label, group] of [
    ["INBOUND", inbound],
    ["OUTBOUND", outbound],
  ] as const) {
    console.log(`== ${label} (${group.length} kind(s)) ==`);
    for (const r of group) {
      console.log(
        `  ${String(r.count).padStart(3)}  ${r.parsed ? "parsed " : "DROPPED"}  ${r.kind}`,
      );
    }
    console.log();
  }

  const known = rows.filter((r) => r.parsed).length;
  console.log(`ProtocolKind admits ${known} of ${rows.length} tag kinds this channel carries.`);
  console.log(
    "A kind the parser drops reaches this repository only when a session reads the issue by hand.",
  );
}
