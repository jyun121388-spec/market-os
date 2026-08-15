# Current Task

MILESTONE: M05 — OpenDART (Korea filings) adapter

TASK: Build `src/server/adapters/dart/`. Unlike FRED/ECOS (macro time series), DART returns
corporate filings/disclosures — this is structurally a different shape and probably needs a new
`Filing` (or similar) Prisma model, not a forced fit into Series/Observation. Research the real
OpenDART API (disclosure list endpoint, financial statement endpoint) before designing the
schema addition.

STATUS: Not started — M04 (ECOS adapter) complete and verified.

NEXT EXACT ACTION: Research OpenDART's actual API response shape (list.json for disclosure
search, fnlttSinglAcntAll.json or similar for financial statements) via WebSearch since direct
fetch to opendart.fss.or.kr may be blocked (as ecos.bok.or.kr was — verify first). Design a
minimal `Filing` schema addition (prisma/schema.prisma) sufficient for M05's scope, add a
migration, then build client/normalize/ingest following the M03/M04 pattern where it fits and
diverging where filings genuinely differ from time-series observations.
