# Current Task

MILESTONE: Post-M28 local-environment verification round — DONE.

STATUS: Development moved from the Claude Code Web sandbox to a local Windows/VS Code machine
(2026-08-17). The point of the move was to run the things the sandbox could not: a real
PostgreSQL, a real browser, and real outbound network. Doing so falsified four green results
from the cloud runs; all four are fixed and committed with regression coverage. See
`docs/PROJECT_STATE.md` STATUS for the itemized list and `docs/DECISIONS.md` for the reasoning
behind each fix.

Also shipped this round: M19 Watchlist's user-facing request path (`/watchlist` +
`src/server/actions/watchlist.ts`), and live verification of both SEC EDGAR adapters against
real data.sec.gov endpoints — 55/55 contract checks, a real ingest of 1000 filings and 1099
financial facts, and a re-ingest proving idempotency on real data.

NEXT EXACT ACTION FOR A FUTURE SESSION, in order:

1. Check whether any of the three free API keys (FRED, ECOS, OpenDART) has arrived. The user
   committed to obtaining all three on 2026-08-17. For each key present in `.env`, live-verify
   that adapter the way EDGAR was verified — real endpoint, real response shape against the
   declared TypeScript types, then a real ingest followed by a re-ingest for idempotency.
   `scripts/verify-edgar-live.ts` is the template to copy. Expect to find schema drift: the
   EDGAR check found real drift on its first run, and these three adapter shapes were written
   the same way, from documentation rather than a real response.
2. FRED first if more than one key is available — it unblocks the 5 Macro Regime axes currently
   reporting `NOT_TRACKED`, which is the largest visible product gap.
3. If no key has arrived, there is no further live-verification work available. Do not
   substitute speculative engineering for it.

The Codex re-review remains the one non-Product gate and is not something to poll for. Its
scope has grown — see `docs/PROJECT_STATE.md` NEXT item 1 for the corrected base..head range and
why a re-reviewer must be told the H3 fix was itself defective and has been re-fixed.
