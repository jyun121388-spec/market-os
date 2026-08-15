# Current Task

MILESTONE: M06 — SEC EDGAR (US filings) adapter

TASK: Build `src/server/adapters/edgar/`, reusing the `Filing` model added in M05 (M05's
DECISIONS.md entry explains why Filing exists as its own model rather than being forced into
Series/Observation). EDGAR's submissions API is CIK-based (not corp_code), uses "accession
number" instead of DART's rcept_no, and requires a descriptive User-Agent header per SEC's
fair-access policy (not an API key) — check this before coding, don't assume DART's auth
pattern carries over.

STATUS: Not started — M05 (OpenDART adapter) complete and verified.

NEXT EXACT ACTION: Research the real SEC EDGAR submissions API shape
(https://data.sec.gov/submissions/CIK##########.json) via WebSearch/WebFetch (test whether
data.sec.gov is reachable before assuming it's blocked like ecos.bok.or.kr/opendart.fss.or.kr
were), then design types.ts/client.ts/normalize.ts/ingest.ts following the DART adapter's
pattern where it fits.
