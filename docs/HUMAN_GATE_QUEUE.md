# Human Gate Queue

<!-- READINESS PACKETS — added 2026-08-21, after the release candidate closed internally. -->

## Readiness packets — the eight decisions that remain

The release candidate is frozen at `c03aa73` (attestation `fb3a721`) and independently closed:
Gate U found nothing, `[CHATGPT_VERIFIED][ESC-011]` is APPROVED, posture is
`READY_FOR_HUMAN_RELEASE_GATES`. Everything below is a decision a person has to take. None is
blocked on engineering, none blocks the others, and none has been taken here.

Each packet answers the same eight questions, so they can be compared and taken one at a time.
**Deferring any of them leaves the product operable** — the "if deferred" line says exactly how.

### Cost summary, first, because it is the question that decides most of these

| Gate                         | Cost to approve                                                      |
| ---------------------------- | -------------------------------------------------------------------- |
| A FRED key                   | **Free.** No card, no billing.                                       |
| B ECOS key                   | **Free.** No card, no billing.                                       |
| C OpenDART key               | **Free.** No card, no billing.                                       |
| D LLM provider               | **Real per-request money.** The only genuinely funded decision here. |
| E HG-009 lockout posture     | Free unless a CAPTCHA vendor is chosen.                              |
| F Signup enumeration posture | Free unless transactional email is bought.                           |
| G Production deployment      | Hosting and database cost.                                           |
| H Payment activation         | Processor fees, plus a business/tax decision.                        |

Three of the eight cost nothing and unblock the most engineering. If only one thing is done, do A.

---

### A — FRED live key (HG-002)

- **Decision required.** Obtain a free FRED API key and place it in `.env` as `FRED_API_KEY`.
- **Why not autonomous.** A credential is a Human Gate under `CLAUDE.md`. Registration is an
  account action taken in a person's name; nothing here may create one or hold the result.
- **Current safe default.** The adapter runs against committed fixtures. Every parser, revision
  path and idempotency guarantee is tested; only the live shape is unverified.
- **Minimum user action.** Register at `https://fredaccount.stlouisfed.org/apikeys`, copy the key,
  add one line to `.env`. No card is requested at any point.
- **Cost.** None.
- **Security / legal.** The key identifies a rate-limit bucket, not a person's data. It is redacted
  from every stored error by `redactSecrets`; `.env` is gitignored and only `.env.example` is
  committed.
- **If deferred.** Everything continues. FRED-derived figures stay fixture-backed, and the five
  Macro Regime axes that need FRED remain `NOT_TRACKED` — visibly, not silently.
- **Verification that follows approval.** `npm run verify:live:edgar` is the model to copy:
  1. `npm run verify:live:fred` — compares the live response against the committed contract.
  2. Check nullability, missing fields, revisions, units, dates, timestamps and pagination against
     the real payload. Provider documentation does not count: EDGAR's was wrong about nullability,
     and that was the first provider actually checked.
  3. Fix any drift, add a regression test for each difference found.
  4. Small real ingest, then re-ingest, and confirm `0 inserted / all unchanged`.
  5. Confirm provenance on a rendered figure.
  6. Only then record `LIVE_VERIFIED`. **Until step 1 runs, the state is `UNVERIFIED` — not
     `FAILED`, and not `COMPLETE`.**

---

### B — ECOS live key (HG-003)

- **Decision required.** Obtain a free Bank of Korea ECOS key; set `ECOS_API_KEY`.
- **Why not autonomous.** Same as A: an account action in a person's name.
- **Current safe default.** Fixture-backed. The Korean-language series names and the quarterly and
  annual cycle parsing are tested against real captured payloads.
- **Minimum user action.** Register at `https://ecos.bok.or.kr/api/#/AuthKeyApply`, set one
  variable.
- **Cost.** None.
- **Security / legal.** ECOS puts the key in the URL PATH rather than a query parameter, which is
  why `redactSecrets` redacts by value and not by parameter name.
- **If deferred.** The BOK base rate series stays fixture-backed. Nothing else is affected.
- **Verification that follows approval.** The same six steps as A, via `npm run verify:live:ecos`.
  One ECOS-specific check: the missing-value marker is still unverified against the live API
  (`src/server/adapters/ecos/types.ts` records this), so confirm what a genuinely absent
  observation looks like before trusting the skip path. `UNVERIFIED` until it runs.

---

### C — OpenDART live key (HG-004)

- **Decision required.** Obtain a free OpenDART key; set `DART_API_KEY`.
- **Why not autonomous.** Same as A.
- **Current safe default.** Fixture-backed against a real Samsung Electronics filing list.
- **Minimum user action.** Register at `https://opendart.fss.or.kr/`, set one variable.
- **Cost.** None.
- **Security / legal.** Key travels as `crtfc_key`; redacted by value and by parameter name.
- **If deferred.** Korean filings stay fixture-backed. EDGAR is already live-verified, so Company
  X-Ray works for US issuers regardless.
- **Verification that follows approval.** Same six steps, via `npm run verify:live:dart`. Check the
  corpCode-to-company mapping in particular: `financial_facts` is unique on `(sourceId, corpCode)`
  and a corpCode identifies a company only within one source. `UNVERIFIED` until it runs.

---

### D — Full free-text Ask Market: LLM provider, funding, credential (HG-006)

- **Decision required.** Which provider, how the per-request cost is funded, and the credential.
- **Why not autonomous.** This is the one decision here that spends money on every request.
  `CLAUDE.md`'s zero-extra-cost rule is absolute and this cannot be actioned under any reading of
  it. It is also a legal decision: free-text inference is where
  `docs/LEGAL_GUARDRAILS.md` stops being enforceable by pattern and starts depending on what a
  model says.
- **Current safe default.** `/ask` runs a deterministic topic lookup at zero runtime cost, with the
  guardrail redirecting personalised requests in English and Korean. No prose is synthesised; every
  field returned is a direct read of stored FACT or CALCULATION data.
- **Minimum user action.** Name a provider and a funding source. The credential can follow.
- **Cost.** Real and recurring, scaling with usage. The only packet here where that is true.
- **Security / legal.** The largest of the eight. An LLM answering freely can produce personalised
  advice that no deterministic guardrail intercepted, which is precisely what
  `LEGAL_GUARDRAILS.md` prohibits. The subject classifier guards the REQUEST path; an output path
  needs its own scanner.
- **If deferred.** Indefinitely safe. Safe mode is the shipped behaviour and is not a placeholder.
- **Verification that follows approval.** Per the M21 entry in `docs/DECISIONS.md`, in the same
  milestone and not after it: extend `verifyClaim` to cover INFERENCE claims; ship dedicated
  legal-guardrail tests against real model output; and run the output scanner over generated prose
  before any of it reaches a user.

---

### E — Login lockout threat model (HG-009)

- **Decision required.** Whether the email-keyed five-attempt / fifteen-minute lockout is the
  production posture, or whether IP-keyed limiting, a CAPTCHA or a delay curve is wanted.
- **Why not autonomous.** It is a trade between account-takeover resistance and a denial-of-service
  vector against a known email address. Which risk matters more is a product judgement.
- **Current safe default.** Email-keyed lockout, tested, and documented as a pre-launch default
  rather than a final answer. `signIn` never reveals which field failed or that a lockout is
  active.
- **Minimum user action.** Confirm the current posture, or name the preferred alternative.
- **Cost.** None, unless a paid CAPTCHA is chosen — which would itself be a new Human Gate.
- **Security / legal.** An attacker who knows an email can lock that account out for fifteen
  minutes at a time. Against that, the current scheme resists credential stuffing without any
  third-party dependency.
- **If deferred.** Safe for pre-launch and for any non-public deployment. It should not survive
  public launch undecided.
- **Verification that follows approval.** `tests/loginLockoutThreatModel.test.ts` already pins the
  current behaviour; extend it to whichever posture is chosen, and add a test asserting the
  chosen scheme's failure mode is the one accepted rather than a different one.

---

### F — Signup email-enumeration posture (A1, tracked with HG-009)

- **Decision required.** Whether signup may keep telling an unauthenticated caller that an email is
  already registered.
- **Why not autonomous.** Every fix requires email verification, which is bulk transactional
  messaging and a Human Gate of its own. The alternative — a generic failure — strands a user who
  has forgotten they registered. That is a product call.
- **Current safe default.** `signUp` throws "An account with this email already exists". Reproduced
  and recorded as accepted pre-launch posture, not as an oversight.
- **Minimum user action.** Either accept it for pre-launch, or approve transactional email so
  verification can be built.
- **Cost.** None to accept. An email provider costs money and would be a new gate.
- **Security / legal.** An enumeration oracle: an attacker can test whether an address has an
  account. Materially worse at public launch than in a closed deployment.
- **If deferred.** Safe while the deployment is not public. `signIn` is unaffected and leaks
  nothing.
- **Verification that follows approval.** If verification is built: assert that signup responds
  identically for a registered and an unregistered address, and that the difference is observable
  only in the mailbox.

---

### G — Production deployment (HG-007)

- **Decision required.** Whether to deploy, where, and against which database.
- **Why not autonomous.** Deployment is named as a Human Gate in `CLAUDE.md`, and it is the first
  action here that is not reversible by deleting a local folder.
- **Current safe default.** Nothing is deployed. Ingest jobs run only by manual invocation of
  `scripts/run-ingest-jobs.ts`.
- **Minimum user action.** Choose a host and a managed PostgreSQL, and confirm the deployment.
- **Cost.** Hosting plus database, ongoing.
- **Security / legal.** `ADMIN_EMAILS` must be set before `/admin` is reachable — it fails closed
  when empty, which is correct locally and would be a lockout in production if forgotten. Session
  cookies become `Secure` automatically in production.
- **If deferred.** Everything runs locally against the portable PostgreSQL. No feature depends on
  being deployed.
- **Verification that follows approval.** Apply all 17 migrations to the production database and
  confirm each applied; verify `/admin` is unreachable without a session and with a non-admin one;
  confirm `Secure` and `SameSite` on the session cookie over real HTTPS; run one real ingest and
  then a re-ingest, confirming `0 inserted / all unchanged`; confirm a rendered figure traces to a
  stored source.

---

### H — Payment / subscription activation (HG-008)

- **Decision required.** Whether to activate payments, with which processor, and which plan gates
  which feature.
- **Why not autonomous.** Charging money is a Human Gate, and it is also a tax and business
  decision that no code change can settle.
- **Current safe default.** The `Plan` enum and `hasEntitlement` / `canUseFeature` exist and are
  tested. `FEATURE_PLAN_REQUIREMENTS` is deliberately empty, so no feature is paid-gated and no
  processor is integrated.
- **Minimum user action.** Choose a processor and state which features are paid.
- **Cost.** Processor fees, and whatever the plan structure implies.
- **Security / legal.** Card data must never reach this application; a hosted checkout keeps it
  out. Consumer-subscription law varies by jurisdiction and is outside anything decidable here.
- **If deferred.** Everything is available to every signed-in user, which is the current and
  intended pre-launch behaviour.
- **Verification that follows approval.** Confirm no card data touches the application; test each
  entitlement boundary in both directions; verify a cancelled subscription loses entitlement at the
  right moment and not before.

---

### What is NOT on this list

Merging PR #1 is a human action but not a separate gate — it is the mechanical consequence of G,
or a decision to land the code without deploying it. Either way it is not taken here.

The accepted review debt (name-collision tail, A1's classification, C1's Claim Ledger content
validation) is **debt, not a gate**. It is recorded in `reviews/market-os-final-review.json`, pinned
by tests, and none of it is release-critical. It does not need a decision to proceed.

---

Items that autonomous work cannot resolve on its own, collected so they can be approved or
actioned in one pass rather than interrupting development one at a time.

A gate blocks **a task**, never the project. Each entry below records what was completed around
the block, so nothing waits on an approval it does not actually need.

Status vocabulary: `PENDING_USER` (waiting on the user) · `PENDING_EXTERNAL` (waiting on a
third party) · `RESOLVED`.

---

## HG-001 — GitHub push authentication

**Status**: `RESOLVED` · closed 2026-08-20

Both halves are closed. Git push authenticated on 2026-08-19; the `gh` CLI is authenticated
against account `jyun121388-spec` through official GitHub OAuth stored in the OS keyring, with
`repo` and `workflow` scopes, which covers issue comments as well as pushes. No token was
generated, extracted, printed or written anywhere, and OAuth through the official CLI costs
nothing — the zero-extra-cost rule is intact.

Verified by use rather than by inspection: the branch reports zero commits ahead of
`origin/claude/market-os-development-7vnicg`, PR #1 exists with CI runs against real SHAs, and
`[CLAUDE_APPLIED]` replies for TEST-001, TEST-002, ESC-009, ESC-010 and ESC-011 were posted to
issue #2 and read back from the API.

**Correction to the earlier record.** This gate was reported as blocked for most of a session on
the strength of a probe that could not distinguish "not installed" from "installed but
unauthenticated" — `command -v gh && gh auth status || echo "not installed"` prints the same
thing for both, because `gh auth status` exits non-zero when unauthenticated. The original text
is kept below so the misread stays visible; the claims in it about `gh` are false.

**Original issue (2026-08-19, since resolved)**: `git push` failed with `could not read Username
for 'https://github.com'`. The credential helper was configured (`manager`) but held no
credential for github.com, and the environment is non-interactive so git could not prompt.

**What was required from the user**: authenticate this machine to GitHub once. Done.

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

**Status**: `RESOLVED` · closed 2026-08-21. Gate U reviewed `40dc7e3..c03aa73` and returned
"No findings"; `[CHATGPT_VERIFIED][ESC-011]` is APPROVED. Twenty gates ran in total and the
record is in `docs/INTERIM_REVIEW_FINDINGS.md` and `reviews/market-os-final-review.json`. The
history below is kept because it explains why the range went unreviewed for so long.

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

**The write half was reported blocked, and was not.** This paragraph said no `gh` CLI was
installed and that Claude could not answer on the escalation channel. That was wrong, and it stood
for most of a session: the probe used to establish it conflated an unauthenticated `gh` with an
absent one. `gh` was installed, and once authenticated it posts comments directly. The channel has
since run full-duplex — TEST-001, TEST-002, ESC-009, ESC-010 and ESC-011 all round-tripped.

Superseded by the HG-001 record above, which is now `RESOLVED`. Kept rather than deleted because
the failure mode is worth more than the conclusion: a probe whose two branches print the same
string for two different states cannot establish either one, and a staged reply queue made the
wrong answer comfortable to live with.

`docs/escalation/PENDING_COMMENTS.md` remains the staging path for the case where the credential
genuinely is absent. It is a fallback now, not the normal route.
