# Human Gate Queue

Items that autonomous work cannot resolve on its own, collected so they can be approved or
actioned in one pass rather than interrupting development one at a time.

A gate blocks **a task**, never the project. Each entry below records what was completed around
the block, so nothing waits on an approval it does not actually need.

Status vocabulary: `PENDING_USER` (waiting on the user) · `PENDING_EXTERNAL` (waiting on a
third party) · `RESOLVED`.

---

## HG-001 — GitHub push authentication

**Status**: `PENDING_USER` · marker `PUSH_PENDING_AUTH`

**Issue**: `git push` fails with `could not read Username for 'https://github.com'`. The
credential helper is configured (`manager`) but holds no credential for github.com, `gh` CLI is
not installed, and the environment is non-interactive so git cannot prompt.

**Required from the user**: authenticate this machine to GitHub once — either sign in through
Git Credential Manager interactively, install and run `gh auth login`, or configure an SSH
remote. Any of the three is sufficient.

**Why blocked**: credentials are a Human Gate under `CLAUDE.md`. Retrying in a loop would
accomplish nothing, so it is not retried.

**Safe work completed around it**: all work is committed locally on
`claude/market-os-development-7vnicg`. Nothing is lost and nothing is at risk; the commits are
ordinary, non-destructive, and on the existing feature branch. No history was rewritten and no
force operation was attempted.

**What remains after approval**: a single `git push origin claude/market-os-development-7vnicg`.
CI will then run against the pushed head.

---

## HG-002 — FRED API key

**Status**: `PENDING_USER` · marker `LIVE_KEY_PENDING`

**Issue**: `api.stlouisfed.org` is reachable from this machine, but the FRED adapter has never
been run against a real response. Its shape was written from documentation, and the SEC EDGAR
equivalent of exactly that situation turned out to contain real schema drift.

**Required from the user**: a free key from
<https://fred.stlouisfed.org/docs/api/api_key.html>, placed in `.env` as `FRED_API_KEY`. No
payment card, no paid tier.

**Why blocked**: registering for an account is a user action. A key will never be invented,
guessed, or substituted, and no paid data source will be used in its place.

**Safe work completed around it**: `scripts/verify-fred-live.ts` is written and wired to
`npm run verify:live:fred`. It checks whether `limit`/`offset` exist at all, whether `count` is
the query total rather than a page size, whether `.` is genuinely the only missing-value marker
(`normalize.ts` throws on any other non-numeric value, so an unanticipated marker is a hard
ingest failure), and whether the default response is one vintage per date. Separately, the
silent pagination truncation in the FRED client was found by code reading and fixed, with
regression coverage.

**Partial verification already done (2026-08-17)**: a request with a deliberately invalid key
reached the real API and returned `400 Bad Request`, surfaced as a clean `FredApiError` with no
key in the message. URL construction, parameter names and the error path are therefore confirmed
against the real endpoint. The success-response shape — the part that hid drift for EDGAR — is
what still needs a key.

**What remains after approval**: run the verification, fix whatever drift it finds, add
regression tests for it, then a small real ingest and a re-ingest for idempotency, then
provenance checks — and only then may FRED be classified `LIVE_VERIFIED`.

---

## HG-003 — ECOS (Bank of Korea) API key

**Status**: `PENDING_USER` · marker `LIVE_KEY_PENDING`

**Issue**: same as HG-002, and ECOS carries the largest documented unknown of any adapter here.
`src/server/adapters/ecos/types.ts` states outright that the convention ECOS uses for a missing
observation was never verified, so `normalize.ts` treats any non-numeric `DATA_VALUE` as
missing. That is safe but cannot distinguish a real gap from a marker nobody anticipated.

**Required from the user**: a free key from <https://ecos.bok.or.kr/api/> (Open API 인증키 신청),
placed in `.env` as `ECOS_API_KEY`.

**Safe work completed around it**: `scripts/verify-ecos-live.ts`, wired to
`npm run verify:live:ecos`. It reports every distinct non-numeric marker it observes, and says
so explicitly when a window contains no gaps at all — an absence of evidence is reported as
such rather than as confirmation. The `[startIdx, endIdx]` window truncation was found and
fixed independently.

**Partial verification already done (2026-08-17)**: an invalid key produced the real
`RESULT.CODE`/`RESULT.MESSAGE` error envelope, correctly detected by `isEcosErrorResponse` and
surfaced without leaking the key — worth noting because ECOS carries the key in the URL path, so
this also exercises the redaction. Path construction and the error envelope are confirmed.

**What remains after approval**: the same eight-step sequence as HG-002 before `LIVE_VERIFIED`.

---

## HG-004 — OpenDART API key

**Status**: `PENDING_USER` · marker `LIVE_KEY_PENDING`

**Issue**: same as HG-002. The DART client additionally branches on exact status strings
(`"000"` success, `"013"` no-data) taken from documentation — a wrong code becomes either a
spurious throw or a silently empty result.

**Required from the user**: a free key from <https://opendart.fss.or.kr/> (오픈API 인증키 신청),
placed in `.env` as `DART_API_KEY`.

**Safe work completed around it**: `scripts/verify-dart-live.ts`, wired to
`npm run verify:live:dart`, including an explicit check of the `013` mapping against a range in
which Samsung certainly filed nothing. The single-page truncation and a missing impossible-date
guard on `rcept_dt` were both found and fixed independently.

**Partial verification already done (2026-08-17)**: an invalid key produced a real non-"000"
`status` with a Korean message, correctly detected by `isDartError` and surfaced without leaking
the key. The `status`-string branching the client depends on is therefore confirmed for the error
case; "000" and the "013" no-data mapping still need a key.

**What remains after approval**: the same eight-step sequence as HG-002 before `LIVE_VERIFIED`.

---

## HG-005 — Independent re-review

**Status**: `PENDING_EXTERNAL` · marker `INDEPENDENT_REVIEW_PENDING_USAGE_RESET`

**2026-08-17 update — the blocker changed, and is now a quota rather than a login.** The Codex
CLI (`codex-cli` 0.147.0) IS present on this machine and IS authenticated: `codex login status`
returns "Logged in using ChatGPT". So the environment limitation recorded in earlier rounds no
longer applies.

What blocks it now is included-usage exhaustion:

```
$ codex exec -m gpt-5.6-luna ...
ERROR: You've hit your usage limit. ... try again at Aug 22nd, 2026 10:30 AM.
```

That is account-level, not model-level — `gpt-5.6-terra` did not return either. Per standing
instruction no credits are purchased and no API key is configured, so the review waits for the
included allowance to reset on **2026-08-22**. It is not polled in the meantime; re-check once
after that date.

`docs/INDEPENDENT_REVIEW_PACKET.md` is prepared against the current range (`9b34f8b..HEAD`, 47
commits, 110 files) with ten ranked attack targets, so a reviewer can start without re-deriving
scope. Bounded deliberately: the older `docs/CODEX_REVIEW_PACKET.md` review range is obsolete and
says so.

**Issue**: the first Codex review returned REVISE with three P0 blockers. All three were fixed —
and one of those fixes (B3, the observation concurrency race) later proved defective and has been
re-fixed. A re-review is the one non-product gate remaining before Release Candidate.

**Required from the user**: run `docs/CODEX_REVIEW_PACKET.md` §12 from a machine where
`codex login` has been completed, and drop the result at `reviews/market-os-final-review.json`.

**Why blocked**: `codex-cli` needs an interactive ChatGPT login this environment cannot perform,
and no API key will be used as a workaround (zero-extra-cost rule).

**Safe work completed around it**: the packet's §0.1 has been rewritten for this round. It states
plainly that B3's fix was defective, that a green suite in the old environment was not evidence
about the product, and that the review range is now `9b34f8b..HEAD` rather than the old
fix-round diff. R1-R6 index every new finding with a "try to break it" prompt for each.

**What remains after approval**: if REVISE, fix the findings directly (Codex quota is reserved
for review, not implementation) with a dedicated regression test per finding. If APPROVE, follow
§15. Under no circumstances is APPROVE self-declared.

---

## HG-006 — Full free-text Ask Market (LLM provider)

**Status**: `PENDING_USER` · marker `HUMAN_GATE_DEFERRED`

**Issue**: M21's full natural-language Q&A needs a funded LLM provider and credential. The
deterministic topic-search safe mode is built, tested and live at `/ask`; only free-text
inference is blocked.

**Required from the user**: a decision on which provider, how its cost is funded, and the
credential itself. This one genuinely costs money, so it will not be actioned autonomously
under any circumstances.

**What remains after approval**: per the M21 DECISIONS.md entry, `verifyClaim` must be extended
to support INFERENCE claims in the same milestone, and dedicated legal-guardrail tests must ship
with the first real implementation rather than after it.

---

## HG-007 — Production deployment

**Status**: `PENDING_USER` · marker `HUMAN_GATE_DEFERRED`

Deploying to production is explicitly a Human Gate. It would also unblock a real scheduler for
the ingest jobs, which currently run only via manual invocation of `scripts/run-ingest-jobs.ts`.

---

## HG-008 — Payment / subscription activation

**Status**: `PENDING_USER` · marker `HUMAN_GATE_DEFERRED`

The `Plan` enum and `hasEntitlement`/`canUseFeature` exist and are tested. No feature is
paid-gated (`FEATURE_PLAN_REQUIREMENTS` is deliberately empty) and no payment processor is
integrated. Activating real payments is a Human Gate.

---

## Not gates

Recorded so they are not mistaken for blockers: choice of test strategy, file layout, naming,
reversible refactors, local dev tooling (the portable PostgreSQL in `.local/` is workspace-local
and reversible by deleting the folder), adding regression tests, and documentation. These are
decided autonomously and recorded in `docs/DECISIONS.md`.
