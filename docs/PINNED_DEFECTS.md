# Pinned defects

Every `it.fails` in the suite, with what it protects and what would close it. Required by ESC-015
§22 before any closure packet is posted.

A pinned defect is an **executable** statement of an invariant that does not hold yet. The body says
what SHOULD happen, `it.fails` expects today's wrong answer, and the day the invariant starts
holding the test turns red and forces someone to look. That is the whole reason these are not
comments: a comment describing a defect outlives the defect silently, and a test demanding the
current wrong answer makes the eventual fix look like a regression.

**13 pinned, verified by a full run against real PostgreSQL** (2325 tests across 132 files: 2312
passed, 13 expected fail). Two were closed during ESC-015 §10 and are recorded at the bottom, since
"closed" is a claim that needs its own evidence.

---

## 1–10. Composite roles the grammar cannot finish reading

**File** `tests/requestAuthority.test.ts` — `it.fails.each("REOPENED by removing delimiter
authority: %s")`

| #   | Shape                                  | Query                                                    |
| --- | -------------------------------------- | -------------------------------------------------------- |
| 1   | a bare name follows a question mark    | `What is the current US headline CPI? Korea?`            |
| 2   | a bare subject follows a question mark | `What did Reuters publish about Alpha? Gamma?`           |
| 3   | a company name follows a question mark | `What is the current Acme Inc. revenue? Gamma?`          |
| 4   | an unenumerated imperative             | `What did Reuters publish about Alpha. Summarize Gamma.` |
| 5   | a trading imperative                   | `What is the current Alpha. Purchase Gamma shares.`      |
| 6   | a bare noun                            | `What did Reuters publish about Alpha. Revenue.`         |
| 7   | a proper-name-shaped tail              | `What did Reuters publish about Alpha. Gamma Corp.`      |
| 8   | a coined token                         | `What did Reuters publish about Alpha. Zorbulate Gamma.` |
| 9   | digits                                 | `What did Reuters publish about Alpha. Q3 Gamma.`        |
| 10  | bare hangul after a period             | `What did Reuters publish about Alpha. 감마.`            |

**Invariant** `authorize(query).status !== "AUTHORIZED"` — the grammar must not authorize a request
whose role carries a second, unread clause.

**Severity** P2. Over-authorization at the grammar with publication authority closed underneath it.
None of the ten can publish anything: a prohibited request emits no payload at all, and for the rest
the full-role cover refuses to materialize a record whose stored name merely occurs inside a role it
cannot explain. Case 5 is the reason this distinction is written down — it used to serve Alpha's
figures under a subject carrying a trading instruction, and
`tests/integration/full-role-cover.test.ts` now holds against a real repository that it serves
nothing and answers `REQUEST_NOT_SUPPORTED`.

**Owner** ESC-015, deferred to a POS or name model. Explicitly NOT closable by the means available:
each tail carries no coordinator, no clause-opening token, no Hangul predicate and no directive, so
every closed grammar here is blind to it. They were previously closed by terminator SHAPE — a period
after an ordinary word ends a sentence, after an abbreviation it does not — and that rule refused 10
of 31 ordinary entity abbreviations with no threshold that fixed it. ESC-015 forbids closing by
vocabulary, opener expansion, or punctuation thresholds.

**Closes when** a continuation-aware constituent analyser can separate a name continuation from a
new clause without a denylist. Then all ten turn red together and the `.fails` come off.

---

## 11. An issuer name containing a question mark

**File** `tests/requestAuthority.test.ts` — `authorizes an issuer name that itself contains a
question mark`

**Query** `What is the definition of Can I Use A Question Mark In A Company Name? Ltd?`

**Invariant** A registered company name containing `?` should be nameable. Sol found the real
registration (Companies House 09804638) after I claimed `?` never occurs name-internally — the claim
was false.

**Severity** P3 availability. Fails closed: the name refuses, nothing wrong is published.

**Owner** Kept by architect ruling on measured evidence, not by preference: treating `?` as a
boundary closed 258 swallows and wrongly admitted 0 across 99,072 requests, including ordinary terse
follow-ups like `What is the current US headline CPI? Korea?`, against this one false refusal of a
novelty registration.

**Closes when** a continuation-aware rule subsumes the `?` boundary. Pinned rather than commented
precisely so the exception cannot quietly outlive its justification.

---

## 12. An overt Korean marker is not proof of a nominal host

**File** `tests/requestAuthorityKorean.test.ts` — `PENDING: an overt marker should not be enough to
prove the host is a noun`

**Query** `사는 얼마인가요?`

**Invariant** `status(...) === "UNSUPPORTED"`. `사는` is [noun 사 + topic 는] to this grammar and
[verb stem 사 + adnominal 는] to a speaker.

**Severity** P3, and the residual error is inert: review searched for a stem with both a verb
reading and a plausible reading as a stored economic subject, and found none.

**Owner** Deferred — separating the two readings needs a lexicon. The line held meanwhile is that a
case particle is POSITIVE evidence of a nominal host and the absence of one is not evidence of
anything, which is why `안 얼마인가요?` refuses and this does not.

**Closes when** a constituent analyser lands.

---

## 13. Punctuation-only differences between stored names

**File** `tests/integration/ask-market.test.ts` — `PENDING: punctuation-only difference between
stored names is not identity`

**Query** `KRW.는 얼마인가요?` against a stored `KRW`

**Invariant** Two stored names differing only in punctuation are not the same subject.
`normalizeSubject` erases punctuation, so stored `KRW` and stored `KRW.` are one string. The sharper
English form is stored `C++` answering a request about `C`.

**Severity** P2 identity. Found by round-five review and NOT introduced by the subject-identity
change: it behaves identically on the OCCURRENCE path, which is what proves it older than the
WHOLE_REGION rule rather than caused by it.

**Owner** Repairing it means changing `normalizeSubject`, which every subject-identity caller shares
— including all three role covers. Too wide to fold into a recognition unit.

**Closes when** a lossless canonical key replaces display-name normalization for identity
comparison.

---

## Closed during ESC-015 §10

Recorded because a closure is a claim, and these two were on the list that gates the packet.

### The Purchase P1 — publication half closed, grammar half demoted to case 5

`What is the current Alpha. Purchase Gamma shares.` served Alpha's observation against a real
repository. Two independent gaps compose: the advice screen does not recognise a bare imperative
trading instruction, and the boundary is not confirmed. Neither was patched, and neither needed to
be — the full-role cover refuses to materialize a record for a role it cannot explain, whatever the
role contains. The pin claiming figures are "served under a subject containing a trading
instruction" no longer described anything, so it moved into the block above as case 5, where what
remains open is over-authorization alone.

**Evidence** `tests/integration/full-role-cover.test.ts`, 5 tests, real PostgreSQL, with a seeded
positive control so no negative can pass against an empty database. `scripts/mutation/rolecover.py`,
4 of 5 mutants isolated; the survivor is classified `EQUIVALENT_GIVEN_MAXIMAL_DISCOVERY` with a
mechanism argument and a 160-combination search, not excused.

### `Alpha, Inc.` — closed by retiring the raw comma test

`Explain how Alpha, Inc. affects Beta.` refused, because a test for a comma anywhere in the raw
query stood in front of relation recognition. It was kept while nothing else could refuse
`Explain how Alpha affects Beta, Gamma.` publishing `A -> B` and discarding `C`.

The comma was a proxy for "this role names more than one thing", read from the raw query because
normalization deletes punctuation before a region exists — which is exactly why it could not tell
the two cases apart. Endpoint roles are now covered against stored identities, which answers
directly what the comma inferred from punctuation.

**Evidence** `tests/integration/relation-role-cover.test.ts`, 6 tests including the case that must
stay `NOT_FOUND` so that refusing everything cannot pass. Inventory independence — the invariant the
parser placement protected — is asserted across the move: a known and a coined second object refuse
identically. `scripts/mutation/mechanismcover.py`, 4 of 4 isolated. 5,712 generated adversarial
combinations, 0 invariant violations. Development corpus unchanged at 59/300 with 0 safety leaks.
