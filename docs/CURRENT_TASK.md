# Current Task

MILESTONE: Post-M28 local-environment and hardening rounds — DONE.

> **Superseded detail below.** The figures in the STATUS paragraph ("55/55 contract checks, 1000
> filings, 1099 facts") were accurate when written and are now known to have been symptoms:
> the 1000 was SEC's hard cap on `filings.recent` and the 1099 was 168 facts short of what SEC
> reports. Current state is 67/67 checks, 2240 filings, 1428 facts — see
> `docs/PROJECT_STATE.md`, which is the source of truth.

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

Also outstanding: HG-001, `PUSH_PENDING_AUTH`. 41 commits are local-only because this machine has
no GitHub credential. One `git push` once that exists.

The Codex re-review remains the one non-Product gate and is not something to poll for. Its scope
has grown considerably — see `docs/CODEX_REVIEW_PACKET.md` §0.1, which now runs to R1-R17 and
names the two patterns behind most of them.

**The most transferable thing learned on 2026-08-17**, worth applying before writing any new
code: almost every defect found was surfaced by looking at real numbers and asking whether they
were plausible, not by reading code. A round 1000. 168 rows "unchanged" against an empty table.
2240 filings and 933 facts with zero joinable rows. 244 rows of net income against 13 of revenue.
A +233% revenue increase. None had a failing test; several had passing ones. If you ingest
something new, look at what landed before trusting that it landed correctly.
