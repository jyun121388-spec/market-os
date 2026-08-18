# Current Task

MILESTONE: **V1 FROZEN. V2 meta-architecture advancing in shadow mode only.**

V1 changes only for a reproduced P0 or P1. Everything else goes into the shadow layers, which no
v1 file imports and which write nothing — `tests/architectureBoundary.test.ts` proves both, so the
freeze is enforced by the suite rather than by discipline.

STATUS as of 2026-08-18:

- 641/641 unit and integration tests, E2E 33/33 in a real browser against the production build,
  `verify:live:edgar` 67/67, lint / typecheck / format / build clean. P0 = 0, P1 = 0.
- Every commit after `6cb74fc` is local-only, ~128 of them (HG-001, `PUSH_PENDING_AUTH`). No
  credential on this machine. Stated as an anchor rather than a count, because a count written
  into a document that is itself committed is stale the moment it lands.
- Independent review is blocked on included-usage exhaustion resetting 2026-08-22 (HG-005). Not
  something to poll for, and not something to buy a way out of.
- Shadow layers implemented: Reality Fabric projection, Verify, Governance policy engine,
  Evolution ledger and detector — plus the provider-vintage contract that ties them together.

- Provider capability matrix covers 13 axes × 4 providers. Only SEC_EDGAR has live evidence;
  FRED, ECOS and OpenDART are entirely NOT_VERIFIED behind HG-002/003/004.

## The last thing done

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

1. **If a FRED key has arrived** (HG-002), this is the highest-value work available and it closes
   two things at once. Live-verify the adapter the way EDGAR was verified — real endpoint, real
   response shape against the declared TypeScript types, then a real ingest followed by a
   re-ingest for idempotency, using `scripts/verify-fred-live.ts`. Then check what
   `realtime_start`/`realtime_end` actually contain in that response. They are already declared in
   `fred/types.ts`, no adapter reads them, and `PROVIDER_VINTAGE_CAPABILITIES` records them
   `NOT_VERIFIED` with a test forbidding an upgrade to `KNOWN` without a live response. Confirming
   their real semantics is what turns `SEMANTIC_REVISION_UNRESOLVED` from a standing verdict into
   a resolved one for the macro path.
2. **If an ECOS or OpenDART key has arrived** (HG-003 / HG-004), same procedure with
   `verify-ecos-live.ts` / `verify-dart-live.ts`. Expect drift: EDGAR's live check found four
   real divergences from its documented shape on the first run, and these three adapters were
   written the same way, from documentation.
3. **If no key has arrived**, continue in shadow. The open items, in order of value:
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
