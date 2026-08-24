/**
 * Do the repository's request authorities agree about what a request IS?
 *
 * There are three, and they were built at different times for different reasons:
 *
 *   `resolveRequestAuthority`  IR-107. Positive recognition of one of five closed operations, with
 *                              operands. Drives the deterministic `askMarket` serving path.
 *   `authorizeInference`       IR-101/102. Eligibility for a generation step, derived from
 *                              `classifyRequestFrame`, admitting two frames.
 *   `deriveCandidateEnvelope`  IR-103/104. Which stored records a request is ABOUT.
 *
 * Specialization between them is legitimate and expected: inference being NARROWER than
 * deterministic serving is a safety property, not a defect — a level request that a planner may
 * never see is exactly what `plannerPermitted: false` means.
 *
 * One direction is not legitimate. **A weaker legacy classifier must never rescue a request the
 * complete operation parser refuses.** If `resolveRequestAuthority` says PROHIBITED, UNSUPPORTED or
 * AMBIGUOUS and `authorizeInference` says eligible, then two parsers disagree about what the same
 * sentence means and the more permissive one is the one attached to a model.
 *
 * This measures that rather than reasoning about it. It reads no sealed fixture and asserts
 * nothing; it prints the cross-product so a claim about divergence has evidence under it.
 *
 * Run: DATABASE_URL=... npx tsx --tsconfig tsconfig.json scripts/authority-divergence.ts
 */

import { resolveRequestAuthority } from "@/server/domain/requestAuthority";
import { authorizeInference } from "@/server/domain/inferenceAuthorization";
import { deriveCandidateEnvelope } from "@/server/domain/candidateEnvelope";

interface Probe {
  group: string;
  query: string;
}

const PROBES: Probe[] = [
  { group: "current observation", query: "What is the current US headline CPI?" },
  { group: "current observation", query: "Show me the current UK policy rate." },
  { group: "current observation", query: "What is the current Widget Price Index?" },
  { group: "observed change", query: "How much has US headline CPI changed this year?" },
  { group: "observed change", query: "What is the change in US GDP last year?" },
  { group: "definition", query: "What is a yield curve inversion?" },
  { group: "definition", query: "What is the definition of CPI?" },
  { group: "attributed report", query: "What did analysts publish about US headline CPI?" },
  { group: "attributed report", query: "What did Goldman Sachs say about US inflation?" },
  { group: "attributed report", query: "What was published about US headline CPI?" },
  { group: "stored mechanism", query: "Explain how alpha affects beta." },
  { group: "stored mechanism", query: "Explain how the policy rate affects mortgage costs." },
  { group: "negated relation", query: "Explain how alpha does not affect beta." },
  { group: "multi relation", query: "Explain how alpha affects beta and how gamma affects delta." },
  { group: "unsupported factual", query: "Rank every European economy by growth." },
  { group: "unsupported factual", query: "US headline CPI" },
  { group: "unsupported factual", query: "Why did the market do that yesterday?" },
  { group: "personalized directive", query: "Should I buy Samsung right now?" },
  { group: "personalized directive", query: "How much of my savings should go into bonds?" },
  { group: "personalized directive", query: "Where should I set my stop-loss?" },
  { group: "personal subject", query: "What is the current level of my pension fund?" },
  { group: "personal subject", query: "What is my average cost basis on Apple?" },
  { group: "mixed factual + directive", query: "What is the current gold price and rebalance my portfolio?" },
  {
    group: "mixed factual + directive",
    query: "Tell me the current gold price, then decide how many ounces to buy.",
  },
  { group: "mixed factual + directive", query: "Rebalance the portfolio. What is the current gold price?" },
  { group: "ambiguous", query: "How much has US headline CPI changed?" },
  { group: "ambiguous", query: "What is the current change in US headline CPI this year?" },
  { group: "imperative informational", query: "Give me the figure for Korea's headline consumer price index." },
  { group: "imperative informational", query: "Show me CPI" },
  { group: "unsupported forecast", query: "Give me the exact closing price of Tesla on December 31, 2027." },
  { group: "korean", query: "현재 소비자물가 상승률은 얼마인가요?" },
  { group: "korean", query: "내 포트폴리오 지금 어떻게 조정할까요?" },
  { group: "korean", query: "한국은행이 기준금리에 대해 뭐라고 발표했나요?" },
];

/** The one direction that is never legitimate: the parser refuses and inference does not. */
function isUnsafe(authorityStatus: string, inferenceEligible: boolean): boolean {
  return inferenceEligible && authorityStatus !== "AUTHORIZED";
}

async function main(): Promise<void> {
  const rows: {
    p: Probe;
    authority: string;
    operation: string;
    inference: string;
    envelope: string;
    unsafe: boolean;
  }[] = [];

  for (const p of PROBES) {
    const a = resolveRequestAuthority(p.query);
    const i = authorizeInference(p.query);
    let envelope = "-";
    try {
      const e = await deriveCandidateEnvelope(p.query);
      envelope = `${e.status}${e.operation ? "/" + e.operation : ""}`;
    } catch (error) {
      envelope = `THREW ${(error as Error).message.slice(0, 30)}`;
    }
    rows.push({
      p,
      authority: a.status,
      operation: a.status === "AUTHORIZED" ? a.operation : "-",
      inference: i.eligible ? `ELIGIBLE/${i.frame}` : `blocked/${i.blockedBy}`,
      envelope,
      unsafe: isUnsafe(a.status, i.eligible),
    });
  }

  let group = "";
  for (const r of rows) {
    if (r.p.group !== group) {
      group = r.p.group;
      console.log(`\n--- ${group}`);
    }
    console.log(
      `${r.unsafe ? "UNSAFE " : "       "}${r.authority.padEnd(12)} ${r.operation.padEnd(32)} ` +
        `${r.inference.padEnd(34)} ${r.envelope.padEnd(26)} ${r.p.query.slice(0, 58)}`,
    );
  }

  const unsafe = rows.filter((r) => r.unsafe);
  console.log(
    `\nUNSAFE DIVERGENCES (parser refuses, inference permits): ${unsafe.length}/${rows.length}`,
  );
  for (const r of unsafe) {
    console.log(`   ${r.authority} vs ${r.inference}   ${r.p.query}`);
  }

  // The safe direction, counted separately so it is never mistaken for the unsafe one.
  const narrower = rows.filter((r) => r.authority === "AUTHORIZED" && !r.inference.startsWith("ELIGIBLE"));
  console.log(
    `\nSAFE SPECIALIZATIONS (parser authorizes, inference declines): ${narrower.length}/${rows.length}`,
  );
  for (const r of narrower) {
    console.log(`   ${r.operation.padEnd(32)} ${r.inference.padEnd(34)} ${r.p.query.slice(0, 52)}`);
  }
}

void main();
