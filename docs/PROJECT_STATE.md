CURRENT RELEASE
0.0.1-alpha

COMPLETED
M00, M01, M02, M03, M04, M05, M06, M07 (partial — see below)

CURRENT
M08

STATUS
READY

TESTS
61 / 61 PASS (32 unit, 29 integration against a real Postgres instance)

OPEN P0
0

OPEN P1
0

REVIEW DEBT
See docs/REVIEW_DEBT.md — DB schema + adapter pattern (FRED/ECOS/DART/EDGAR) not yet
Codex-reviewed; ECOS/DART/EDGAR field-level shapes unverified against live API responses
(egress blocked in this dev environment). M07 note: no live news/metadata source is wired yet
— the Event/EventMention schema, deterministic keyword-clustering heuristic
(src/server/domain/eventClustering.ts, eventIngest.ts), and tests are done and verified against
a real Postgres, but a real news adapter (analogous to M03-M06) is future work once a suitable
free source is identified and reachability confirmed.

NEXT
M08: Data normalization + provenance hardening. Review the FRED/ECOS/DART/EDGAR/Event pipeline
built in M02-M07 end-to-end against docs/DATA_POLICY.md's financial-data checklist and
docs/ARCHITECTURE.md's Claim Ledger design — this milestone is about strengthening what exists,
not adding a new adapter, before M09 (Claim Ledger + verification pipeline) builds on top of
it.
