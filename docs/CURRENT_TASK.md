# Current Task

MILESTONE: M16 — Filing Diff

TASK: Per docs/PRODUCT_SPEC.md "Filing Diff": new/removed risk factors, material numeric
changes, capex/debt/cashflow deltas, management-language changes vs. the prior filing. Two
genuinely different halves:
1. **Numeric deltas** — now buildable: M15's `FinancialFact` table already stores multiple
   accession numbers per concept over time (verified in M15's "restatement" test). Compare the
   same concept across two filings' accession numbers using the same deterministic-change
   pattern as `seriesReadings.ts` (M10/M11).
2. **Text diffs** (new/removed risk factors, management-language changes) — needs actual filing
   document text. No adapter built so far (M05 DART, M06 EDGAR filings, M15 XBRL facts) has
   ever fetched filing document bodies, only metadata/structured facts. This is a real new
   capability, not a natural extension.

STATUS: Not started — M15 (Company X-Ray, EDGAR XBRL core concepts) complete and verified.

NEXT EXACT ACTION: Build the numeric-delta half first (it's real, needed data already exists):
`src/server/domain/filingDiff.ts` with `computeFinancialFactDiff(sourceId, corpCode, concept,
unit)` — find the two most recent FinancialFact rows for that concept (by filedDate/accession),
compute the delta the same deterministic way as computeChange, and return it (optionally as a
CALCULATION claim, reusing claimStore.ts). Explicitly scope text-diff (risk factors/management
language) as BLOCKED/future work requiring a new filing-text-fetching adapter, documented in
DECISIONS.md — do not attempt to synthesize risk-factor changes from data that isn't ingested.
