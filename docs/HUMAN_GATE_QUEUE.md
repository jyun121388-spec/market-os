# Human Gate Queue

Items that autonomous work cannot resolve on its own, collected so they can be approved or
actioned in one pass rather than interrupting development one at a time.

A gate blocks **a task**, never the project. Each entry below records what was completed around
the block, so nothing waits on an approval it does not actually need.

Status vocabulary: `PENDING_USER` (waiting on the user) · `PENDING_EXTERNAL` (waiting on a
third party) · `RESOLVED`.

---

## HG-001 — GitHub push authentication

**Status**: `PARTIALLY_RESOLVED` · marker `API_WRITE_PENDING_AUTH` · updated 2026-08-19

Git push authenticated for the first time on 2026-08-19 and the branch is being pushed
normally, so the half of this gate that blocked backup is closed. The half that blocks the
escalation channel is not: posting a comment goes through the REST API, the credential that
satisfies git lives in a credential helper, and extracting a helper secret is prohibited. No
`gh` CLI is installed. Recorded as two capabilities because they resolved separately, and
treating the gate as closed on the strength of the first would report messages as delivered
that nobody has seen.

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

**Status (2026-08-18): NO LONGER BLOCKED — in progress.** The account was upgraded and all three
Codex models now probe AVAILABLE (`docs/AI_REVIEW_RUNTIME_STATE.md`). The first genuine
independent review of this branch has run and produced six confirmed defects — IR-009 through
IR-014 in `docs/INTERIM_REVIEW_FINDINGS.md`, five fixed and one deferred as HG-009.

**2026-08-18, later the same day — two further reviews ran.** `gpt-5.6-terra` reviewed the v2
shadow layers cross-file over `b6eb8fd..HEAD`: five findings, all five reproduced, all five valid
(IR-022..IR-026). `gpt-5.6-luna` audited the Governance rule table against the documents it cites
and the Evolution ledger against the findings it was backfilled from: one rule looser than its
citation (IR-029), 28 ledger entries checked with zero fabrications, and eight documented defects
missing, now added.

What remains is coverage, not access: the packet's A1–A14 have not all been reviewed, and **Sol
has not been used at all** — reserve it for the final Release Candidate adversarial pass and for
any P0/P1. Always invoke with `-s read-only`; `codex exec` otherwise defaults to `workspace-write`
with `approval: never`, which lets a reviewer edit the tree. One further operational note: pass
`< /dev/null`, or `codex exec` blocks on stdin indefinitely even with the prompt supplied as an
argument.

The historical account below is kept because it explains why the range went unreviewed for so long.

**Superseded status**: `PENDING_EXTERNAL` · marker `INDEPENDENT_REVIEW_PENDING_USAGE_RESET`

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

**2026-08-18 — a local model was tried as an interim reviewer and disqualified.** Ollama is
installed and serving locally with `qwen3.5:4b` and `gemma3:4b`. Both were calibrated against a
positive and a negative control; both reported defects in correct code, on every sample, in every
round, and neither ever cleared a clean control. Full method and evidence in
`docs/LOCAL_AI_CALIBRATION.md`. They are recorded as **hypothesis generators only** — a local
model may not authorise a code change here.

Consequences for this gate:

- The interim period (`a0eb92a..HEAD`) has had **no independent review of any kind**. Treat it as
  author-reviewed only.
- Codex must review `a0eb92a..HEAD` in addition to the packet range — that window contains
  IR-001, IR-002 and IR-006 (`docs/INTERIM_REVIEW_FINDINGS.md`).
- IR-001 and IR-002 share a root cause worth a systematic sweep by a cross-file reviewer (Terra):
  **queries keyed on a business identifier that is unique only within a source.** Two were found
  and fixed by enumeration; the class deserves an independent pass.
- `LOCAL_AI_PRE_REVIEW_COMPLETE` is **not** claimed. Nothing about this gate has moved.

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

## HG-009 — Login lockout threat-model decision

**Status**: `HUMAN_GATE` · decision received and consumed 2026-08-20 · **still open** ·
raised 2026-08-18 · escalated 2026-08-19 · severity P2

The earlier status was `HUMAN_GATE_DEFERRED_UNTIL_USER_RETURN`, which is the shape the
escalate-before-idle rule exists to remove: a question that waits for someone to come back is
a question nobody was asked. The decision packet is composed, screened and queued in
`docs/escalation/PENDING_COMMENTS.md`; it has NOT been transmitted, because posting needs a
REST API credential this machine does not have. Only HG-009 waits on it.

**Decision required**: whether to keep the current account-targeted login lockout, and if not,
which replacement to accept.

**Reason**: failed sign-ins are counted per normalised email and the lock is checked _before_ the
password is verified (`src/server/domain/auth.ts`, `isLoginLocked`). Anyone who knows an address
can therefore lock that account for 15 minutes with five wrong guesses — no session, no victim
interaction. Found by independent review (`gpt-5.6-terra`), reproduced by reading the
implementation. Full analysis in `docs/INTERIM_REVIEW_FINDINGS.md` IR-014.

### ESC-009 decision, received 2026-08-20 (issue #2 comment 5349780439)

`Status: HUMAN_GATE`. Keep the current account-targeted 5-attempt / 15-minute lockout **unchanged
as a temporary pre-launch default**. This is risk deferral, not a statement that the present design
is the desired production one, and **the gate does not close on deployment**.

The exposure, stated plainly because a gate record that softens it looks handled: at the current
HEAD, `signIn()` calls `isLoginLocked(normalized)` before `verifyPassword`, and failures are keyed
only by normalised email. Anyone who knows an address can deny that account for fifteen minutes
with five wrong guesses — no session, no victim interaction.

Why no autonomous fix: source/IP keying moves the failure rather than removing it (distributed
attackers bypass it, NAT and proxy users are collateral) and depends on trusted ingress topology
that does not exist; a challenge mechanism does not exist and adding one changes dependencies,
accessibility and abuse policy; verifying the password first would restore unlimited guessing.
Each is a product and threat-model choice, not a defect with one correct patch.

**Preferred production direction when revisited** — layered throttling rather than a single hard
account lock: progressive per-account delay plus source-aware limiting at a trusted ingress, with
generic login errors preserved, and challenge/MFA only as a separately governed capability.

Non-behavioural work completed under this decision: `tests/loginLockoutThreatModel.test.ts` pins the
present semantics — including asserting the DoS as present, so it cannot drift silently in either
direction — and records the acceptance criteria a replacement must satisfy (known-account DoS,
brute-force budget, NAT/proxy fairness, distributed-source bypass, generic-error non-enumeration,
trusted ingress prerequisite).

**Not approved for production.** A fresh revision of this gate is required, with measured
constraints, once ingress topology and acceptable user friction are known.

**Why this was not decided autonomously**: every alternative trades one weakness for another, so
there is no fix that is simply correct.

| Option                                   | Cost                                                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| Keep as-is                               | Targeted 15-minute DoS on any known address                                                   |
| Remove the lockout                       | Brute-force protection disappears entirely                                                    |
| Verify password before checking the lock | DoS gone, but unlimited guesses — worse than today for brute force                            |
| Key on client IP                         | Needs request-IP plumbing behind an unknown proxy topology; a distributed attacker defeats it |
| Exponential backoff per email            | Softens the DoS without removing it                                                           |

**Recommended default**: keep the current behaviour. `auth.ts` already documents the chosen threat
model — a targeted attacker guessing one account's password, explicitly not distributed
credential stuffing — and for a pre-launch product with no traffic, a 15-minute targeted lockout
is a smaller real risk than unlimited password guessing. Revisit alongside infrastructure-level
rate limiting, which is where the IP-based answer properly belongs.

**What continues without this**: everything. No other work depends on it.

## HG-001 addendum — the escalation channel needs the same credential (2026-08-19)

Issue #2 (`AI ESCALATION CHANNEL`) was set up as a Claude ↔ ChatGPT decision channel, with a
transport test: read `[CHATGPT_DECISION][TEST-001]` directly from GitHub and reply
`[CLAUDE_APPLIED][TEST-001]`, without a human copying anything across.

**The read half works and was verified.** The repository is public, so
`GET /repos/jyun121388-spec/market-os/issues/2` and `.../comments` return the issue and the
ChatGPT decision over the unauthenticated REST API. The comment was read in full — ACKNOWLEDGED,
transport test only, no product decision implied — with no manual copy/paste.

**The write half is blocked by HG-001, not by a new gate.** No `gh` CLI is installed, neither
`GITHUB_TOKEN` nor `GH_TOKEN` is set, and `git push` has hung on a credential prompt all session.
The reply is staged verbatim in `docs/escalation/PENDING_COMMENTS.md` and will post unchanged when
a credential exists.

**What this changes about HG-001.** It was previously "147 local commits cannot be published". It
is now also "Claude cannot answer on the escalation channel", which makes the gate a
communications blocker as well as a publishing one. Reading incoming decisions still works, so
ChatGPT → Claude is live and Claude → ChatGPT is not.

Recommended default unchanged: supply a credential (a fine-grained PAT with `contents:write` and
`issues:write` on this repository is enough for both halves). Nothing else in the session is
blocked by it.
