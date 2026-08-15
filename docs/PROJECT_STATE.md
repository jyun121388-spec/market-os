CURRENT RELEASE
0.0.1-alpha

COMPLETED
M00, M01, M02, M03, M04, M05, M06, M07 (partial — see REVIEW_DEBT), M08, M09 (partial —
FACT+CALCULATION now, INFERENCE still pending), M10, M11, M12 (partial — cadence projection
only, no consensus data — see REVIEW_DEBT), M13 (partial — single-hop edges only, no
multi-hop traversal yet)

CURRENT
M14

STATUS
READY

TESTS
90 / 90 PASS (39 unit, 51 integration against a real Postgres instance)

OPEN P0
0

OPEN P1
0

REVIEW DEBT
See docs/REVIEW_DEBT.md — DB schema + full pipeline not yet Codex-reviewed; ECOS/DART/EDGAR/
FRED-Releases field-level shapes unverified against live APIs (egress blocked); no live news
source wired (M07); releaseDate/cross-source-conflict gaps (M08); verifyClaim doesn't support
INFERENCE (M09); 5 of 8 regime axes have no ingested data yet (M11, pending real FRED_API_KEY);
Economic Calendar has no consensus data (M12); Causal Graph has no multi-hop traversal yet
(M13, no real consumer needs it until M21).

NEXT
M14: Historical Analog Engine. Similarity score + comparable historical periods + subsequent
1M/3M/6M actual outcomes + sample size + explicit limitations (per docs/PRODUCT_SPEC.md).
"Past results do not guarantee future outcomes" must be structurally enforced, not just stated
— likely mirrors M13's pattern (a required limitations field). Real constraint to check first:
the DB currently holds very little historical observation data (adapters exist but haven't run
against a real API key in this environment), so meaningful historical-analog comparisons need
either a longer FRED backfill (once a real key exists) or an honestly-scoped-down V1 using
whatever history is actually available — don't fabricate historical comparisons against thin
data.