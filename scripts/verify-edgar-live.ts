/**
 * Live contract verification for the two SEC EDGAR adapters.
 *
 * Every adapter shape in this repo was written from published documentation, not from a real
 * response — the cloud dev sandbox had no egress to data.sec.gov, so `docs/RELEASE_READINESS.md`
 * classifies both EDGAR rows as LIVE_VERIFICATION_REQUIRED. EDGAR is the only tracked provider
 * that needs no API key (just a descriptive User-Agent), so it is the only one that can be
 * verified without a credential Human Gate.
 *
 * This asserts the *contract*, not the data: field presence, types, parallel-array alignment,
 * date formats, and the concepts the adapter depends on. It deliberately does not assert
 * specific financial values — those legitimately change, and a test that pins them would be
 * noise, not signal. What it catches is schema drift: SEC renaming, removing, or retyping
 * something the adapter reads.
 *
 * Read-only. No writes to the database, no state changed anywhere.
 *
 * Usage: EDGAR_USER_AGENT="Your Name you@example.com" npx tsx scripts/verify-edgar-live.ts
 * SEC rejects User-Agent strings that do not look like a name plus a contact address with
 * HTTP 403 (verified live 2026-08-16) — a bare product/URL string is not accepted.
 */
import { sanitiseErrorForStorage } from "../src/server/adapters/redactSecrets";
import {
  fetchEdgarFilingHistory,
  fetchEdgarSubmissions,
} from "../src/server/adapters/edgar/client";
import { TRACKED_EDGAR_COMPANIES } from "../src/server/adapters/edgar/types";
import { fetchCompanyFacts } from "../src/server/adapters/edgar-xbrl/client";
import {
  TRACKED_XBRL_CONCEPTS,
  TRACKED_XBRL_COMPANIES,
} from "../src/server/adapters/edgar-xbrl/types";

let failures = 0;
let checks = 0;

function check(label: string, condition: boolean, detail?: string) {
  checks += 1;
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    failures += 1;
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isNumberArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((x) => typeof x === "number");
}

async function verifySubmissions() {
  const { cik, corpName } = TRACKED_EDGAR_COMPANIES[0];
  console.log(`\n[submissions] CIK ${cik} (${corpName})`);
  const res = await fetchEdgarSubmissions(cik);

  check("cik is a string", typeof res.cik === "string");
  check("name is a string", typeof res.name === "string");
  check("entityType is a string", typeof res.entityType === "string");
  check(
    "sic / sicDescription are strings",
    typeof res.sic === "string" && typeof res.sicDescription === "string",
  );
  check("tickers is a string[]", isStringArray(res.tickers));
  check("exchanges is a string[]", isStringArray(res.exchanges));
  check("filings.recent exists", Boolean(res.filings?.recent));
  check("filings.files is an array", Array.isArray(res.filings?.files));

  const recent = res.filings.recent;
  const stringFields = [
    "accessionNumber",
    "filingDate",
    "reportDate",
    "acceptanceDateTime",
    "act",
    "form",
    "fileNumber",
    "filmNumber",
    "items",
    "primaryDocument",
    "primaryDocDescription",
  ] as const;
  const numberFields = ["size", "isXBRL", "isInlineXBRL"] as const;

  for (const f of stringFields) {
    check(`recent.${f} is a string[]`, isStringArray(recent[f]), `got ${typeof recent[f]}`);
  }
  for (const f of numberFields) {
    check(`recent.${f} is a number[]`, isNumberArray(recent[f]), `got ${typeof recent[f]}`);
  }

  // The parallel-array layout is the single riskiest assumption in this adapter: if the arrays
  // ever stopped aligning, every filing would be silently mis-attributed rather than error out.
  const lengths = new Set([...stringFields, ...numberFields].map((f) => recent[f]?.length));
  check(
    "every recent.* array has the same length (parallel-array alignment holds)",
    lengths.size === 1,
    `distinct lengths: ${[...lengths].join(", ")}`,
  );

  const n = recent.form.length;
  check("at least one recent filing returned", n > 0);
  check(
    "filingDate values are YYYY-MM-DD",
    recent.filingDate.every((d) => ISO_DATE.test(d)),
    recent.filingDate.find((d) => !ISO_DATE.test(d)),
  );
  // reportDate is legitimately blank for some form types (e.g. some 8-Ks) — the adapter must
  // tolerate that, so verify it is "ISO date or empty", never a surprise third format.
  check(
    "reportDate values are YYYY-MM-DD or empty",
    recent.reportDate.every((d) => d === "" || ISO_DATE.test(d)),
    recent.reportDate.find((d) => d !== "" && !ISO_DATE.test(d)),
  );
  check(
    "accessionNumber values look like NNNNNNNNNN-NN-NNNNNN",
    recent.accessionNumber.every((a) => /^\d{10}-\d{2}-\d{6}$/.test(a)),
    recent.accessionNumber.find((a) => !/^\d{10}-\d{2}-\d{6}$/.test(a)),
  );

  console.log(
    `  info  ${res.name} · ${n} recent filings · forms present: ${[...new Set(recent.form)].slice(0, 8).join(", ")}`,
  );

  // Completeness, not just shape. The first version of this script reported "1000 recent
  // filings" as an informational line and moved on; that round number was SEC's cap, not
  // Apple's filing count, and the ingest was silently storing 45% of the history. Shape
  // verification is not completeness verification — so completeness is now asserted.
  const overflow = res.filings.files ?? [];
  const overflowTotal = overflow.reduce((sum, f) => sum + (f.filingCount ?? 0), 0);
  if (overflow.length > 0) {
    console.log(
      `  info  ${overflow.length} overflow file(s) holding a further ${overflowTotal} filings ` +
        `(${overflow[0].filingFrom} to ${overflow[overflow.length - 1].filingTo})`,
    );
  }

  const history = await fetchEdgarFilingHistory(cik);
  check(
    "the filing history fetch includes the overflow files, not just filings.recent",
    history.filings.form.length === n + overflowTotal,
    `history=${history.filings.form.length}, recent=${n}, overflow=${overflowTotal}`,
  );
  check("nothing was truncated", history.truncated === false);
  check(
    "merged parallel arrays stay aligned across the recent/overflow boundary",
    new Set([
      "accessionNumber",
      "filingDate",
      "form",
      "primaryDocDescription",
      "items",
      "size",
    ] as const).size > 0 &&
      ["accessionNumber", "filingDate", "form", "primaryDocDescription", "items", "size"].every(
        (f) =>
          (history.filings[f as keyof typeof history.filings] as unknown[]).length ===
          history.filings.form.length,
      ),
  );
  check(
    "no duplicate accession numbers across the recent/overflow boundary",
    new Set(history.filings.accessionNumber).size === history.filings.accessionNumber.length,
  );
  console.log(
    `  info  complete history: ${history.filings.form.length} filings, oldest ` +
      `${[...history.filings.filingDate].sort()[0]}`,
  );
}

async function verifyCompanyFacts() {
  const { cik, corpName } = TRACKED_XBRL_COMPANIES[0];
  console.log(`\n[companyfacts] CIK ${cik} (${corpName})`);
  const res = await fetchCompanyFacts(cik);

  check("cik is a number", typeof res.cik === "number");
  check("entityName is a string", typeof res.entityName === "string");
  check("facts['us-gaap'] exists", Boolean(res.facts?.["us-gaap"]));

  const usGaap = res.facts["us-gaap"] ?? {};
  const present = TRACKED_XBRL_CONCEPTS.filter((c) => c in usGaap);
  const missing = TRACKED_XBRL_CONCEPTS.filter((c) => !(c in usGaap));

  // Not every company tags every concept (Apple reports RevenueFromContractWithCustomer... not
  // Revenues, for instance). A missing concept is a real, documented characteristic of the data,
  // not a contract violation — so it is reported, not failed. What WOULD be a violation is a
  // present concept whose internal shape differs from what the adapter reads.
  console.log(`  info  tracked concepts present: ${present.join(", ") || "(none)"}`);
  if (missing.length > 0) {
    console.log(`  info  tracked concepts absent for this filer: ${missing.join(", ")}`);
  }
  check("at least one tracked concept is present", present.length > 0);

  for (const concept of present) {
    const c = usGaap[concept];
    check(`${concept}.units is an object`, Boolean(c.units) && typeof c.units === "object");
    const unitKeys = Object.keys(c.units ?? {});
    check(`${concept} has at least one unit key`, unitKeys.length > 0);

    const facts = c.units[unitKeys[0]] ?? [];
    check(`${concept}.units["${unitKeys[0]}"] is a non-empty array`, facts.length > 0);

    const bad = facts.find(
      (f) =>
        typeof f.val !== "number" ||
        typeof f.end !== "string" ||
        !ISO_DATE.test(f.end) ||
        typeof f.accn !== "string" ||
        // fy/fp are genuinely nullable in live data — SEC's documentation implies otherwise,
        // and the first run of this script is what caught it. Null is valid; anything other
        // than null-or-the-right-primitive is not.
        (f.fy !== null && typeof f.fy !== "number") ||
        (f.fp !== null && typeof f.fp !== "string") ||
        typeof f.form !== "string" ||
        typeof f.filed !== "string" ||
        !ISO_DATE.test(f.filed) ||
        (f.start !== undefined && (typeof f.start !== "string" || !ISO_DATE.test(f.start))),
    );
    check(
      `${concept} fact rows match XbrlFactValue (val/end/accn/fy?/fp?/form/filed types + date formats)`,
      bad === undefined,
      bad ? JSON.stringify(bad) : undefined,
    );
  }
}

async function main() {
  if (!process.env.EDGAR_USER_AGENT) {
    console.error(
      "EDGAR_USER_AGENT is not set. SEC requires a descriptive User-Agent identifying the\n" +
        'requester, in "<name> <contact email>" form. Choosing the real contact identity is a\n' +
        "Human Gate (docs/DATA_POLICY.md) — set it in .env and re-run.",
    );
    process.exitCode = 1;
    return;
  }

  await verifySubmissions();
  await verifyCompanyFacts();

  console.log(
    `\n${failures === 0 ? `ALL ${checks} CONTRACT CHECKS PASSED` : `${failures}/${checks} CHECK(S) FAILED`}`,
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(sanitiseErrorForStorage(err));
  process.exitCode = 1;
});
