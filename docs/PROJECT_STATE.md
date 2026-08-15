CURRENT RELEASE
0.0.1-alpha

COMPLETED
M00, M01, M02, M03, M04, M05, M06, M07 (partial), M08, M09 (partial), M10, M11, M12 (partial),
M13 (partial), M14 (partial), M15 (partial), M16 (partial), M17 (partial — schema + legal
guardrail enforcement + exposure aggregation only, no ingestion adapter — see REVIEW_DEBT)

CURRENT
M18

STATUS
READY

TESTS
111 / 111 PASS (46 unit, 65 integration against a real Postgres instance)

OPEN P0
0

OPEN P1
0

REVIEW DEBT
See docs/REVIEW_DEBT.md for the full list (18 entries as of M17). All entries are honestly
scoped-down or blocked features with documented reasons — no entry represents an unnoticed
gap. Most are pending either a real API key (Human Gate), a reachable external domain not
available in this dev environment, or a real consumer that doesn't exist yet (avoiding
speculative build-ahead).

NEXT
M18: Real Estate Intelligence (Korea). Public transaction/price/rate/permit/completion/unsold/
supply/auction data (per docs/PRODUCT_SPEC.md). Likely candidate source: 국토교통부
(MOLIT) 실거래가 공개시스템 / 공공데이터포털 (data.go.kr) — both already in the seeded Tier S
source registry (M02) but never actually probed for reachability. Check before designing
anything, same discipline as every prior milestone. Expect the same pattern as M04-M06/M12/M15:
either build a real adapter against a documented API shape (logging live-verification as
review debt if blocked), or scope down explicitly if genuinely no path exists.