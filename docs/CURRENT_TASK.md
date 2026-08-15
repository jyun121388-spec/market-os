# Current Task

MILESTONE: M17 — ETF X-Ray

TASK: Per docs/PRODUCT_SPEC.md "ETF X-Ray": index, expense ratio, holdings, sector/country/
currency exposure, duration, macro sensitivity. Hard constraint from docs/LEGAL_GUARDRAILS.md:
NO "buy fitness score" or any investment-recommendation output — expose facts, never a
recommendation number (e.g. no "매수 적합도 93"). This is a real, tested-by-guardrail
requirement, not just a style note.

STATUS: Not started — M16 (Filing Diff, numeric half) complete and verified.

NEXT EXACT ACTION: Research whether a free, reachable source of ETF holdings/exposure data
exists before designing anything — this is a different data category from anything built so
far (FRED/ECOS/DART/EDGAR are all official government/regulatory sources; ETF holdings
typically come from the fund issuer's own site or a paid data vendor like Morningstar). Check a
candidate issuer (e.g. State Street's SPDR holdings CSV endpoints, iShares' public holdings
files) for reachability via WebFetch before assuming either way. If nothing free and reachable
exists, scope M17 down explicitly (e.g. design the schema and legal-guardrail test now, defer
real ingestion) or mark it BLOCKED in REVIEW_DEBT.md with a clear unblocking condition — same
discipline as M12's Economic Calendar scoping decision. Do not fabricate holdings data.
