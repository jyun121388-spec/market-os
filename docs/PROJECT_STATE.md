CURRENT RELEASE
0.0.1-alpha

COMPLETED
M00, M01, M02, M03, M04, M05, M06, M07 (partial — see REVIEW_DEBT), M08, M09 (partial —
FACT+CALCULATION now, INFERENCE still pending), M10, M11

CURRENT
M12

STATUS
READY

TESTS
78 / 78 PASS (35 unit, 43 integration against a real Postgres instance)

OPEN P0
0

OPEN P1
0

REVIEW DEBT
See docs/REVIEW_DEBT.md — DB schema + full pipeline not yet Codex-reviewed; ECOS/DART/EDGAR
field-level shapes unverified against live APIs (egress blocked); no live news source wired
(M07); releaseDate/cross-source-conflict gaps (M08); verifyClaim still doesn't support
INFERENCE claims (M09, no real producer yet — M21); no live data has actually been ingested for
the 7 series added in M11 (no FRED_API_KEY configured in this dev environment — Human Gate), so
5 of 8 regime axes currently report NOT_TRACKED/INSUFFICIENT_DATA against a real but empty
database, which is correct behavior, not a bug.

NEXT
M12: Economic Calendar. Release time, previous/consensus/actual/surprise/revision, importance,
linked variables, initial market reaction (per docs/PRODUCT_SPEC.md). No adapter currently
supplies economic-calendar-with-consensus data (FRED gives realized values only, not forward
consensus estimates) — research a free source (e.g. econdb, or manually curated release-date
metadata cross-referenced with FRED series) before designing the schema, same "verify before
assuming" discipline used for M04-M06.
