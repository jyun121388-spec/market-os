# Current Task

MILESTONE: M19 — Watchlist

TASK: Companies/ETFs/indicators/industries/themes a user tracks (docs/PRODUCT_SPEC.md).
Personalization is limited to information filtering — never personalized investment judgment
(same guardrail family as ETF X-Ray's no-score rule). Resolved dependency question (see
docs/DECISIONS.md): ship a minimal placeholder `User` model now (id + createdAt only, no auth
fields) so `WatchlistItem` has real referential integrity; M22 (Auth) extends this same table
with real auth fields later rather than replacing it.

STATUS: Not started — M18 (Real Estate Intelligence, schema+algorithm only) complete and
verified.

NEXT EXACT ACTION: Add `User` and `WatchlistItem` models to prisma/schema.prisma.
WatchlistItem: userId, itemType (COMPANY | ETF | INDICATOR | INDUSTRY | THEME), itemRef
(source-specific identifier — corpCode/ticker/seriesId/free-text theme), label, addedAt.
Migrate, then build src/server/domain/watchlist.ts (add/remove/list, idempotent add — adding
the same item twice is a no-op, not a duplicate row) with unit + integration tests against a
real Postgres, same pattern as every prior domain module.
