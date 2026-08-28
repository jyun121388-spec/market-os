# Current Task

MILESTONE: **V1 FROZEN. V2 meta-architecture advancing in shadow mode only.**

V1 changes only for a reproduced P0 or P1. Everything else goes into the shadow layers, which no
v1 file imports and which write nothing — `tests/architectureBoundary.test.ts` proves both, so the
freeze is enforced by the suite rather than by discipline.

STATUS as of 2026-08-18:

- 774/774 unit and integration tests, scheduler queue 3 startable / 5 gated, E2E 33/33 in a real browser against the production build,
  `verify:live:edgar` 67/67, lint / typecheck / format / build clean. P0 = 0, P1 = 0.
- **Superseded 2026-08-20**: HG-001 is closed, the branch is fully pushed, PR #1 is open, and the
  Gate A independent review has run. Both bullets below were true when written and are kept only
  because the first one stayed in the documents long after it stopped being true.
- ~~Every commit after `6cb74fc` is local-only, ~128 of them (HG-001, `PUSH_PENDING_AUTH`).~~
- ~~Independent review is blocked on included-usage exhaustion resetting 2026-08-22 (HG-005).~~
- Shadow layers implemented: Reality Fabric projection, Verify, Governance policy engine,
  Evolution ledger and detector — plus the provider-vintage contract that ties them together.

- Provider capability matrix covers 13 axes × 4 providers. Only SEC_EDGAR has live evidence;
  FRED, ECOS and OpenDART are entirely NOT_VERIFIED behind HG-002/003/004.

## The last thing done

**2026-08-28 — the redirect/informational P1 is UNDER REVIEW and NOT closed.** This line said
"repaired, reviewed and committed" while the same document listed the closure review as still open,
and the closure review then reproduced two more instances. Corrected rather than deleted: the
overstatement is the point.

A second clause that did not authorize on its own could be swallowed into an open-class region of
the first, and in the worst instance the advice DIRECTIVE ended up inside a source region the
redirect path serves. Cover competition could not refuse it: it refuses a swallowing reading only
by producing a rival tiling, and a tail that reads as nothing produces no rival.

A candidate boundary is now confirmed only when the fragment after it opens a clause AND the run's
head is itself a complete request. Four rules were tried and refuted by measurement before this
one, including two written after review approved the design.

9 boundary mutants, 9 of 9 ISOLATED full suite 127 files / 2237 pass / 2 expected fail
114 binding, 49 unrelated, pinned typecheck, eslint, prettier, build all clean

The mutation harness that produced those numbers was reviewed and repaired FIRST, across three
commits, because evidence from an unverified harness is not evidence. Its lock took three designs;
the first two looked correct and were measured admitting two simultaneous holders.

Codex Pro is working again: `gpt-5.6-luna`, `gpt-5.6-terra` and `gpt-5.6-sol` all verified by
invocation, not assumed. Luna reviewed the harness twice (REWORK, then APPROVE), Terra reviewed the
P1 architecture three times (APPROVE, then REFINE_IN_THIS_UNIT, then REFINE_FURTHER, each time on a
measurement it had asked for). Sol's exact-tree P1 review of `009341d` is the open item.

### Earlier

The provider capability matrix (`src/server/fabric/providerCapability.ts`), continuing directly
from the vintage contract and answering the question it kept raising: is this evidence absent
because the provider withholds it, or because nobody has looked? `SUPPORTED` and `NOT_SUPPORTED`
both require a live response — asserting the second from a documentation page closes an inquiry
that was never opened. Verify classifies gaps against it, Governance reads reality state from the
Fabric, and Evolution generates evidence-backed proposals from it.

Before that, the provider-vintage / semantic-recency contract (`src/server/fabric/vintage.ts`), the concept
IR-021 forced into existence, propagated through Fabric → Verify → Evolution → Governance. The
governing sentence is **retrieval order is not semantic recency**: `retrievedAt` is always
available and never authoritative, and a negative-control test fails if it ever becomes a
tiebreak. See `docs/PROJECT_STATE.md` for what each layer gained.

## NEXT EXACT ACTION, in order

0. **BLOCKED, and it is the first thing to read: `P1_UNBOUNDED_CLAUSE_OPENING_CLASS`.** Two
   closure reviews and five architect rounds are done; the last one graded the remaining class a
   P1 that blocks this unit. 28 of 38 unknown tails are swallowed
   (`scripts/probe-unknown-tail.ts`). It cannot be closed by adding words -- that is the
   unfinishable direction the module's own `FRAMING_TOKENS` comment warns about -- and the
   fail-closed inversion needs a POS/name lexicon this design does not have.

   The open decision is **accept as a known release risk, or redesign**, and it is a product
   decision rather than an engineering one, so it is escalated and NOT assumed either way. Do not
   close this unit by adding a ninth, tenth and eleventh word.

   Two measurements the architect named are still unrun: a continuation false-refusal corpus of
   real issuer names stratified by tail shape, and the head-alone matrix extended to every
   candidate boundary rather than the first.

1. Then the framing-positionality unit (`scripts/reproduce-framing-position.ts` is written and
   untracked), then B2-C, then B2-D. `src/server/domain/sourceAuthority.ts` is written, referenced
   by nothing, and is B2-C's starting point -- it must be wired or deleted, not left as it is.
2. **If a FRED key has arrived** (HG-002), this is the highest-value work available and it closes
   two things at once. Live-verify the adapter the way EDGAR was verified — real endpoint, real
   response shape against the declared TypeScript types, then a real ingest followed by a
   re-ingest for idempotency, using `scripts/verify-fred-live.ts`. Then check what
   `realtime_start`/`realtime_end` actually contain in that response. They are already declared in
   `fred/types.ts`, no adapter reads them, and `PROVIDER_VINTAGE_CAPABILITIES` records them
   `NOT_VERIFIED` with a test forbidding an upgrade to `KNOWN` without a live response. Confirming
   their real semantics is what turns `SEMANTIC_REVISION_UNRESOLVED` from a standing verdict into
   a resolved one for the macro path.
3. **If an ECOS or OpenDART key has arrived** (HG-003 / HG-004), same procedure with
   `verify-ecos-live.ts` / `verify-dart-live.ts`. Expect drift: EDGAR's live check found four
   real divergences from its documented shape on the first run, and these three adapters were
   written the same way, from documentation.
4. **If no key has arrived**, continue in shadow. The open items, in order of value:
   - A third Verify adapter. Two exist (Filing Diff, and Morning Brief's "What Changed"), and the
     second immediately produced two verdicts the first never could. Macro Regime and Ask Market
     are the remaining real output shapes; Ask Market is the interesting one, because its output
     is prose rather than a number and `adversarial_resilience` has never been exercised on
     anything that could actually read as advice.
   - The Evolution detector stops at clustering. It emits no hypotheses and has no path to
     production, by design — but a `prediction` field per weakness, written by hand, would make
     each cluster falsifiable.
   - `docs/INDEPENDENT_REVIEW_PACKET.md` is prepared and unread. Working through its own questions
     produced findings 23-29 without any reviewer, so it is worth re-reading against the current
     range rather than waiting for 2026-08-22.

## Do not

- Promote the status to `RELEASE_CANDIDATE_READY`. Four external gates are open and none can be
  closed by autonomous work. See `docs/HUMAN_GATE_QUEUE.md`.
- Buy credits, configure an API key, or enable a paid provider to unblock any of the above. An
  exhausted quota is a routing event, not a purchasing event.
- Add a fifth OS layer. Four is the design; depth in these four is the work.

## The most transferable thing learned so far

Almost every defect found on this project was surfaced by looking at real numbers and asking
whether they were plausible, not by reading code. A round 1000. 168 rows "unchanged" against an
empty table. 2240 filings and 933 facts with zero joinable rows. 244 rows of net income against 13
of revenue. A +233% revenue increase. None had a failing test; several had passing ones.

The 2026-08-18 addition to that list: a green E2E run served by a server process started before
the code under test existed, and a reviewer quoting a reproduction it had never run. Both were
confident, well-formed, and false. If you ingest something new, or read a result, establish what
produced it before trusting that it means what it says.
