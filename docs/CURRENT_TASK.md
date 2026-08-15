# Current Task

MILESTONE: M08 — Data normalization + provenance hardening

TASK: This milestone strengthens the M02-M07 pipeline rather than adding new surface area.
Concretely: (1) audit every adapter (FRED/ECOS/DART/EDGAR) against docs/DATA_POLICY.md's
financial-data checklist (timezone, observation vs release date, revision, missing values,
duplicates) and close any gaps found; (2) verify the Claim Ledger's `assertValidClaim`
invariants (src/server/domain/claimLedger.ts) are actually enforced on every write path that
will eventually create a Claim — right now nothing calls it outside its own unit test, so there
is no real "production path" invoking it yet; (3) consider whether Event/Filing/Observation
need a shared "provenance summary" helper for later Presentation-layer use (M20 Today
Intelligence, M21 Ask Market) versus deferring that to when a consumer actually exists.

STATUS: Not started — M07 (Event model + clustering, partial per PROJECT_STATE.md) complete
and verified.

NEXT EXACT ACTION: Start with the Claim Ledger gap: nothing in the codebase currently
constructs a `Claim` row via `assertValidClaim` outside its unit test — this is real
"code exists but isn't wired to a path" per CLAUDE.md's Completion Standard. Decide whether M08
should add the first real caller (e.g. a small helper that creates a Claim from an Observation,
enforcing FACT-requires-sourceId at the DB-write boundary) or whether that's better deferred to
M09 (Claim Ledger + verification pipeline) — lean toward doing it now since M09 will need it
immediately and a half-built Claim Ledger is worse than a fully-wired minimal one.
