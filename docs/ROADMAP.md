# Roadmap

Each milestone has a state (see `PROJECT_STATE.md` for the current one):
`PLANNED | READY | BUILDING | TESTING | REVIEW | CODEX_REVIEW_PENDING | REMEDIATION | BLOCKED |
QA_PASS | DONE`.

Order below is the default; deviations must be recorded in `DECISIONS.md` with a reason.

- **M00** — Development Operating System (this doc set, repo scaffolding, CI hooks).
- **M01** — Core architecture + database (Next.js + TS backend skeleton, Prisma schema, CI).
- **M02** — Source/data model (sources, observations, claim ledger tables, conflict model).
- **M03** — FRED / US macro adapter.
- **M04** — ECOS / Korea macro adapter.
- **M05** — OpenDART (KR filings) adapter.
- **M06** — SEC EDGAR (US filings) adapter.
- **M07** — Event model + news-intelligence foundation (event clustering).
- **M08** — Data normalization + provenance hardening.
- **M09** — Claim Ledger + verification pipeline.
- **M10** — What Changed (24h change detection).
- **M11** — Macro Regime Engine.
- **M12** — Economic Calendar.
- **M13** — Economic Causal Graph.
- **M14** — Historical Analog Engine.
- **M15** — Company X-Ray.
- **M16** — Filing Diff.
- **M17** — ETF X-Ray.
- **M18** — Real Estate Intelligence (KR).
- **M19** — Watchlist.
- **M20** — Today / Morning Intelligence.
- **M21** — Ask Market + Legal Guardrails enforcement.
- **M22** — Auth / user system.
- **M23** — Subscription-ready architecture (actual payment activation is a Human Gate).
- **M24** — Admin / monitoring.
- **M25** — Performance / cache / background jobs.
- **M26** — Security hardening.
- **M27** — Production QA.
- **M28** — Release Candidate.

## Rationale for dependency order (recorded here; full decisions in `DECISIONS.md`)
Data model (M01-M02) must precede any adapter. Macro adapters (M03-M04) come before filings
adapters (M05-M06) because macro data is structurally simpler and exercises the normalization/
claim-ledger pipeline first. Event/news (M07) and provenance/claim-ledger hardening (M08-M09)
must land before any derived-intelligence feature (M10+) that depends on trustworthy, sourced
facts. Company/filing/ETF features (M15-M17) depend on the causal graph and historical analog
groundwork (M13-M14) only loosely and could reorder if a dependency issue appears — any such
change will be logged in `DECISIONS.md` with the reason.
