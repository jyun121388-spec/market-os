CURRENT RELEASE
0.0.1-alpha

COMPLETED
M00, M01, M02, M03, M04, M05, M06, M07 (partial), M08, M09 (partial), M10, M11, M12 (partial),
M13 (partial), M14 (partial), M15 (partial), M16 (partial), M17 (partial), M18 (partial —
schema + median-based price-change analysis only, no ingestion adapter — see REVIEW_DEBT)

CURRENT
M19

STATUS
READY

TESTS
114 / 114 PASS (46 unit, 68 integration against a real Postgres instance)

OPEN P0
0

OPEN P1
0

REVIEW DEBT
See docs/REVIEW_DEBT.md (19 entries as of M18). All entries are honestly scoped-down or
blocked features with documented reasons. This dev environment has confirmed egress-blocked:
ecos.bok.or.kr, opendart.fss.or.kr, data.sec.gov (submissions + XBRL), api.stlouisfed.org,
ssga.com, ishares.com, data.go.kr — essentially every real financial/economic-data provider
domain tested. M03-M18 (macro/filing/company/ETF/real-estate adapters) are all built against
documented API shapes or scoped down to schema+algorithm-only where no shape could be
responsibly assumed; live-verification is consistently logged as review debt, not hidden.

NEXT
M19: Watchlist. Companies/ETFs/indicators/industries/themes a user tracks. Per
docs/PRODUCT_SPEC.md: personalization limited to information filtering — never personalized
investment judgment. This is the first milestone needing a User concept (even a minimal one)
since nothing built so far has per-user state; auth itself is M22, so Watchlist likely needs a
placeholder/anonymous-user-scoped design for now, or should be reordered after M22 if a real
user model is a hard prerequisite — evaluate and record the decision in DECISIONS.md rather
than building throwaway auth scaffolding to unblock this milestone.