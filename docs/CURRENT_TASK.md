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

- Provider capability matrix covers 14 axes × 4 providers = 56 cells. Only SEC_EDGAR has live
  evidence; FRED, ECOS and OpenDART are entirely NOT_VERIFIED behind HG-002/003/004, which is 42 of
  the 56. Counted 2026-08-31 by running the matrix. This line said 13, and the suite has asserted
  14 for as long as the fourteenth axis has existed — a documented number nobody re-measured, which
  is the failure class the "last thing learned" section at the bottom of this file is about.

## The last thing done

**2026-09-01 — a run of audit units, and the pattern in them matters more than any one.**
`23e716b` → `f1e3293`. No product code changed in ANY of them: V1 is frozen except for a reproduced
P0/P1, and nothing found here cleared that bar.

    cardinality        which unordered `findFirst` sites can actually match two rows
    SR-02 tree binding whether the server under E2E test is serving this tree
    IR-111             the readiness verdict no longer instructs a seed that cannot work
    IR-110 / HG-010    undecidable from form; escalated as a Human Gate with a measured price
    IR-113             a nondeterministic factor order, found through a one-off test failure
    presentation order 44 findMany sites: 21 with no order, 13 partial, 10 total
    order reach        those 34 narrowed to the 16 whose nondeterminism a reader can see

FOUR OF THESE SHIPPED WITH A SOUNDNESS DEFECT THAT INDEPENDENT REVIEW CAUGHT, and the defects rhyme:
each one enforced an invariant on one side of a boundary and not the other.

    schema.prisma was treated as the only uniqueness authority — migration DDL also declares some,
      including two PARTIAL indexes Prisma cannot express, so the audit over-reported defects
    field presence was treated as a partial-index proof — a partial index constrains only the rows
      its predicate selects, and the query must also be shown to lie in exactly one partition
    covering a unique key was treated as a total order — PostgreSQL holds NULL distinct from NULL,
      so a nullable key still ties
    owner uniqueness was enforced on Linux and not on Windows, where `-First 1` made row order the
      authority

The repair each time was ONE rule shared by both sides, not a second check on the side that was
missing it. That is the transferable part.

TWO TOOL FAILURES CAUGHT BY THE SHAPE OF THEIR OWN OUTPUT. A reach audit returned 34 of 34
identical answers — `node.parent` is set by BINDING, and neither new audit created a type checker,
so every parent pointer was undefined. And `servesLocalBuild` was defined but never called, making
`BOUND` unreachable while the whole suite stayed green, because every control at that moment only
asserted BOUND was NOT returned. Lint caught the second; uniformity caught the first.

## The thing done before that

**2026-09-01 — the semantic-recency audit, and it comes back with nothing to repair.**
`[CHATGPT_DECISION][MARKET-SEMANTIC-RECENCY-AUDIT-20260831]`, read-only Codex pass first
(VERDICT: PROCEED). The invariant under audit is `RETRIEVED/ARRIVED LATER != SEMANTICALLY NEWER`.

`scripts/recency-audit.ts` walks the real `ts.createProgram`, not the text. Every site is an AST
node; every ordering key is the property NAME of an object-literal member; every waiver is bound
through `getLeadingCommentRanges` on the node's own ancestors rather than by line distance. The
field taxonomy is schema-backed — `prisma/schema.prisma` decides which fields are DateTimes at all,
a registry classifies each as SEMANTIC or ARRIVAL with a reason, and a DateTime the registry does
not name stays UNCLASSIFIED. Fail-closed: nothing is dropped for being hard to classify.

    47 sites    0 ARRIVAL_DECIDES    11 SEMANTIC_ORDERED    10 STRUCTURAL
                7 AGGREGATE          4 OPERATIONAL          15 UNCLASSIFIED

No site lets an arrival clock choose one row out of candidates without a waiver. Two dimensions had
to be added before that number meant anything, and both came from the architecture pass:

- ENTITY, not field, decides whether a clock is semantics. `startedAt` on `IngestRun` IS the fact
  about a run; the same clock choosing an `Observation` would be SR-01. Before this, the audit
  reported the two health-panel sites as defects.
- An AGGREGATE selects no row. `_max(retrievedAt)` in `lastIngestForSource` is retrieval telemetry
  and cannot present a superseded value as current. Reading the field inside `_max` is what moved
  seven sites out of "unknown".

The 15 UNCLASSIFIED are mostly unordered `findFirst`/first-element selections, where the winner is
whatever the database returned. That is a real category and the honest limitation is stated rather
than closed: this audit does not yet establish candidate-set cardinality, so it cannot say whether
those sets can hold more than one row. No repair was made, because item 6 requires a reproduced
discriminating pair first and there is nothing yet to reproduce.

**A DATABASE OUTAGE MID-UNIT, recorded because the signature repeats.** The suite came back 52
files failed. Not attributed to the change — nothing imports the new script. `pg_isready` said no
response, so the server was down, and restarting it produced a second, sharper lesson: the log said
"accepting connections" while `psql` said connection refused. Both were true. The server had come
up on port **5432**, because `postgresql.conf` leaves `port` commented out and my restart omitted
`-o "-p 55432"`. Two tools disagreeing was resolved by a third that actually connects, not by
re-reading either. Restarted correctly: 2447 pass / 19 expected fail, identical to before.

## The thing done before that

**2026-08-31 — the capability-gate invariant, chosen by RUNNING the scheduler rather than by
picking.** `scheduleNextWork()` returned 5 actionable / 0 deferred with `CLUSTER-PROVIDER_ASSUMPTION`
top-ranked (5 observed instances, 4 subsystems, P1, SYSTEMIC) and the only one of the five carrying
no Human Gate. Its proposed change has two halves; the live-verification half is credential-blocked
behind HG-002/003/004, and the other half — every NOT_VERIFIED cell names the gate that would clear
it — needs nothing but this repository.

Audited first: the convention was already intact, 42 of 42 cells naming a gate and no resolved cell
carrying a stray one. So there was no data to fix, and the work was to stop it being a convention.
`CapabilityEvidence` is now a discriminated union — `NOT_VERIFIED` REQUIRES `blockedBy`, every other
state FORBIDS it — so both violations fail to compile (TS2322 on each, demonstrated in
`scripts/capability-type-proof.ts`). Two runtime checks were DELETED rather than kept, because a
test for something the compiler already refuses can never fail and reads like coverage.

What a type cannot say is that the gate EXISTS, and `HG-999` passed every check the suite had. One
test added for that, against `docs/HUMAN_GATE_QUEUE.md` as the register.

**Then review found what existence still does not buy, and it reproduced.** `HG-007` is production
deployment and `HG-008` is payment activation — both real, both in the register, neither owning
FRED's live response. Pointed at either, a FRED cell passed shape and existence and was still a lie
about who could clear it: the same defect as `HG-999` wearing a valid id instead of a valid format.
Occurrence was never the claim; ownership was. Reproduced first (both returned `shape=true,
inRegister=true`), then closed with a second test that DERIVES the relation from the register's own
`## HG-002 — FRED API key` headings rather than restating it as a parallel table, and fails closed
when a provider's section is missing or duplicated.

Mutations, all four predicted before running and all four matching:
`M-CAPGATE-WRONGGATE` exactly 1 red — the ownership test alone, and two reds there would mean
existence had started deciding ownership by accident; `M-CAPGATE-UNDOCUMENTED` 2;
`M-CAPGATE-SHAPE` 3; `M-CAPGATE-REGISTER` MISSED as declared, its guard protecting a future edit to
the register path that nothing exercises today.

One trap worth carrying forward: the first attempt to prove the type rejected the violations put
them in a DOT-PREFIXED file and reported zero errors. TypeScript's include globs skip dotfiles, so
the compiler never opened it. A silent zero from a file nobody compiled is indistinguishable from a
pass.

**2026-08-31 — the interval unit, `DEC-INTERVAL-FAMILY-20260831`. Two gates, and the second one's
value is authority rather than recall.**

Selected by whole-corpus measurement against the playbook's own suggestion. The bypass classifier
named attributed-observation as the one TRUE_RECOGNITION_GAP, but it only sees the 10-row eligible
population — the wrong lens for choosing a grammar family. The corpus-wide table said
OBSERVED_CHANGE, at 1/60.

| gate | what it bought                                                                   | corpus    |
| ---- | -------------------------------------------------------------------------------- | --------- |
| A    | typed `Interval` is the shared parser/resolver authority; resolver total over it | CHANGED 0 |
| B/6  | parser stops keeping its own operand list; longest match                         | CHANGED 0 |
| B/7B | one change-nominal family, closed head slot                                      | CHANGED 1 |

**A P1 fell out of starting Gate A, and it was a wrong number rather than a gap.**
`change in US CPI since last year` and `... last year` returned the IDENTICAL authorization — at
asOf 2026-08-25 both resolved 2025-01-01..2025-12-31, so `since` silently lost eight months and
`before last year` was answered with the COMPLEMENT of the period it named. All six of
`since|from|after|before|until|through` behaved that way: a class, measured, not an instance.
Repaired with an ALLOWLIST of transparent prepositions rather than a denylist of anchors — a
denylist admits on omission, an allowlist only refuses.

**Gate A** made `Interval` a value and `resolveInterval` exhaustive over it, checked by the compiler
instead of by a `default` branch apologising for drift. Every pre-existing operand resolves
byte-identically. **Gate B/6** deleted `INTERVAL_OPERANDS` — the two lists had already drifted,
which is how `since last year` reached a resolver case that did not exist — and replaced
first-in-list-wins with LONGEST MATCH, closing the shadowing class by construction.

**Gate B/7B** is `the <HEAD> in <SUBJECT> <INTERVAL>` with a closed head slot, rows derived from the
class rather than typed out. `DEV-EN-038` is recognised; `delta`, `shift` and `movement` are
refused although they appear in the corpus in the same role, because every one of those rows carries
an interval this grammar cannot resolve — admitting them would recognise nothing and would be the
speculative enumeration the architecture pass prohibited.

**The decision's cited examples did not match the repository, and that decided the implementation.**
It quoted DEV-EN-038 as an `ITGM revenue` string and DEV-EN-045 as `EXAI ASSETS`; neither exists in
the corpus. Item 2 authorized only `change` while item 5 required DEV-EN-038, whose head is `move` —
irreconcilable as written. Resolved by item 2's own evidence test, and reported rather than quietly
reinterpreted.

Not done, and deliberately: anchor semantics (`since <anchor>`), two-endpoint ranges, incomplete
dates, fiscal periods, year-on-year, peak-to-trough. All out of scope per the decision's item 5, and
all of them are what currently blocks the remaining OBSERVED_CHANGE rows.

4 change-nominal + 5 interval + 4 anchored-interval mutants, 13 of 13 ISOLATED with exact
cardinalities full suite 138 files / 2445 pass / 19 expected fail exact-head CI `33370069003`
SUCCESS at `3d90ea6`

**2026-08-30 — MARKET-DEFINITION-GRAMMAR-001. Structural DEFINITION recognition, EN and KO.
9/60 → 26/60 of the corpus's definitional requests, zero coercions, zero planner calls.**

`CONSTRUCTIONS` recognised DEFINITION through four literals — `definition of`, `what is a`,
`what is an`, `what does … mean` — so `What is real GDP?` failed on a missing article. The
replacement is one term asked about AS a term, with no operand belonging to another operation,
consulted only when nothing else recognised the span.

| measure                             | before | after                  |
| ----------------------------------- | ------ | ---------------------- |
| corpus DEFINITION rows recognised   | 9 / 60 | 26 / 60                |
| rows answered through LEGACY_BYPASS | 12     | 8                      |
| planner calls, whole 500-row corpus | 0      | 0                      |
| rows changed                        | —      | 17, every one intended |

**FIVE review rounds, and the fourth changed the design rather than extending it.** It began as a
bare wh-copular — `what is X` for unconstrained X, made safe by listing what X must not contain —
and each round named another member of a class I was treating as closed: `at`, `per`, then `via`,
`without`, `within`, `among`, then `amid`; `less`, `multiplied`, then `modulo`, `subtract`, then
`mod`. Every miss ADMITS a non-definition. That is the unfinishable denylist this repository has
abandoned twice, and no sixth round would have ended it.

So the generalisation is deleted. Definitional intent must be POSITIVELY marked — a metalinguistic
head (`the meaning of X`, `meant by X`) or an intransitive predicate over one named thing (`how
does X work`, with nothing after the predicate) — and an unmarked request is UNSUPPORTED rather
than guessed at. **Named cost:** `What is real GDP?` and `What is the Herfindahl-Hirschman Index?`
are not recognised. Neither was recognised before this unit either, so the claim is smaller, not
regressed.

The two remaining inventories were then sorted by whether they can be finished, which is the real
lesson and not a detail. English simple prepositions ARE a closed function-word class, fixed by
the grammar the way `koreanMorphology`'s particle inventory is — so that list was completed once,
in full. Arithmetic word forms are ordinary vocabulary with no last member — so that list was
DELETED, and what its absence admits is stated exactly and pinned executable: `How does EBITDA mod
capex work?` is read as a term no operation owns and the repository cannot resolve. Rounds 1–4
admitted requests BELONGING to other operations and broke four negative controls; this does
neither.

Korean is the same rule, marked morphologically rather than by phrasing: an interrogative that
cannot ask a quantity (`무엇`/`뭐`, never `얼마`), a metalinguistic noun (`뜻`, `의미`, `정의`,
`개념`, `용어`, `표현`), or the citation particles `(이)란`/`(이)라는`. No Korean phrase list.
`koreanCopularMatch` required exactly two eojeol and took 2 of 30; constituency replaces length as
the proof — except where the request reduces to that construction, where its two-eojeol proof is
borrowed rather than an adverb list invented (`내일 주가가 뭐야?`).

**Every defect in this unit was found by measurement or by review, none by reasoning.** Three
coercions came from the whole-corpus diff (a STORED_MECHANISM relation read as a term; two REFUSED
two-operation controls joined by `-고` and `랑`). One came from the full suite —
`제포트폴리오는 무엇인가요?`, "what is MY portfolio", which the older grammar DROPS, and dropping it
leaves `readings` empty, which is exactly what invites a last-resort recogniser in. Review then
found the same failure a second time, with an ill-formed case marker (`기준금리은`), and a frame
the comments claimed to support that did not actually parse.

**SIX rounds, and round six was about the comments as much as the code.** It named `as`, missing
from a preposition list round five had declared complete on the strength of the closed-class
argument — being closed makes a class finishable, which is not the same as having finished it —
and two Korean requests admitted inside a limitation `koreanCopularMatch` already states: one
marked subject SLOT is a claim about the construction, not about the morphology inside it. Those
two are declared rather than fixed, because `물가` is 물 plus a `가` its own conditioning declines
and so is `소비자물가`, so any check strict enough to refuse `기준금리은` refuses ordinary
vocabulary, and a syllable-count qualifier that spares it is a number with no argument behind it.

**SEVEN rounds, and the last two found two real bugs plus the same overstatement three times.**
`How does the concept drift?` was a definition of `drift` — the copula test was satisfied by the
`does` of `how does` and a bare metalinguistic head took the rest of the clause, so the complement
is now required. `주가가 의미있게 상승하나요?` was a definition of `주가` — the head 의미 was
matched by prefix, so 의미있게 counted, and what follows a head must now be grammatical rather
than lexical (with the light verb 하- carved out, because tightening it lost a corpus row).

The overstatement is the more useful finding. The preposition list was declared complete three
times — on the closed-class argument, then from a reference — and answered with `as`, then `qua`.
A closed class is FINISHABLE; a particular transcription of it being FINISHED is a separate claim,
and nothing here establishes it. That claim is retired. What carries the safety argument is that
every path reaching these lists is already positively marked, so an omission lands in the bounded
residue — a term-shaped subject no operation owns and the repository cannot resolve — which review
confirmed selects no competing operation, reaches no planner, and crosses no legal prohibition.

**EIGHT rounds. The last found three more, and the corpus caught a fourth of my own making.**
Shape 1 accepted any clause containing a form of `do`, so `How does the meaning of inflation
change?` defined `inflation change`; the frame is now checked as a frame. The Korean post-marker
predicate accepted any question ending, so `주가가 의미가 있나요?` — "is the share price
meaningful" — defined `주가`; it must now carry the copula 이/인. A coordinated pair
(`ETF와 리츠의 차이는…`) was one term, and the fix had to be positional: adding 와 as a substring
would have refused `통화스와프`, the exact false positive `koreanMorphology` deleted
`internalConjunction` for.

The copular tightening lost `GDP디플레이터란 무엇을 말합니까`, and recovering it by adding the head
`말` ("word") coerced `달러 예금 지금 들까요 말까요` — a PROHIBITED_ADVICE row — because `말까요`
is the prohibitive auxiliary `말다`. Homographs, nothing morphological between them. The head was
removed and the definitional row given up: one row of coverage does not buy a personalized advice
request, and a marker that is only sometimes metalinguistic is not a positive marker.

The last-resort ordering guard now decides nothing. Measured, not assumed: removed by hand, the
whole 500-row corpus is CHANGED 0. The guard stays — it enforces precedence by position and is
load-bearing the moment a shape widens — and its mutant is deleted, because a mutant that cannot
be isolated is not coverage.

**NINE rounds. The last one refuted two things I had declared unfixable.** I had written that
`오늘 주가 하락의 의미가 무엇인가요?` and `기준금리은 수준이 무슨 뜻인가요?` needed a term lexicon,
and offered `물가`/`소비자물가` as proof that no suffix scan could work. The counter-example was
real and the conclusion was not: review supplied a lexicon-free rule, and both are refused now. A
metalinguistic head licenses exactly ONE eojeol of term — the same cardinality proof the
interrogative path borrows from `koreanCopularMatch` — and modifiers in front of the final eojeol
may not be particle-shaped-but-declined, with the final eojeol exempt because that is where a
lexical `가` actually lands. Named cost: `채권 듀레이션 개념 알려주세요`, one row.

Two more real bugs came with it. `주가가 개념인가요?` ("is the share price a concept") was a
definition of `주가` — a metalinguistic head used as the copular PREDICATE rather than citing
anything, separated now by the case on the term, with 어떤 absorbed so
`신용스프레드가 어떤 개념인지` survives. And `주가가 100이라는 의미인가요?` made a whole
proposition the definiendum; requiring the citation to open the request fixed it and refused
`기술적 반등이라는 표현은 무슨 뜻이야`, so the rule tests CASE rather than position.

**A declared residue is a claim, and three of them did not survive contact with a reviewer.** Two
were fixed here; one — the arithmetic residue — has now been examined twice and held.

**TEN rounds, and the tenth found one thing — down from five, three, four, six.** Standalone
coordinating conjunctions were not refused. The reported example, `채권 또는 주식은 무슨 뜻인가요?`,
did NOT reproduce: 또는 splits as 또 plus a valid topic 는, so the one-marked-nominal rule already
refused it. The finding was right about the class anyway — `그리고` and `아니면` end in nothing a
particle rule can see, and those did get through. Matched as whole eojeols, which is what stops a
substring test from splitting `통화스와프`.

**ELEVEN rounds, and the eleventh found the one that mattered most.** The Korean request-frame
list was matched by PREFIX, so `주가가 무엇을 설명하나요?` — "what does the share price EXPLAIN" —
had `설명하나요` stripped as framing and authorized as a definition of `주가`. That broke the
PROPERTY the list rests on, not the list: a prefix test does not consume framing, it consumes any
predicate beginning with a framing word, so an omission ADMITS instead of refusing. Matched whole,
an unlisted form survives as an unconsumed eojeol and the request is refused. Every "this list is
safe because its omissions refuse" argument in this unit depended on a matching discipline nobody
had checked.

**TWELVE rounds. The twelfth found a real defect that this unit did not introduce.**
`오늘주가가 뭐야?` — "what is TODAY's share price", written without the space — is AUTHORIZED as a
DEFINITION. It never reaches the new recogniser: two eojeol is `koreanCopularMatch`'s own
construction, and that function is byte-for-byte identical between `24d1f48` and HEAD. Measured,
not argued — the unit's Korean recogniser was disabled entirely and the string still returned
DEFINITION. The spaced form IS refused, by the borrowed two-eojeol proof; the gap is the compounded
form. Logged as IR-110 in `docs/REVIEW_DEBT.md` and deferred, because 오늘주가 and 종합주가 are the
same shape and separating them needs a lexicon or the adverb prefix list `koreanCopularMatch`
refuses by name — which would also refuse `현재가`, an ordinary term, and is the exact discipline
error round eleven exposed.

**THIRTEEN rounds.** `떠나라는 뜻이야?` — "does that mean [we should] LEAVE?" — was a definition of
`떠나`, because `-(으)라는` is also the adnominal form of a quoted IMPERATIVE and stripping it
leaves a verb stem. The citation path waives the case-marker requirement on the argument that the
citation particle IS the evidence of nominality, and for bare `라는` that argument was simply
false; `이라는` carries the copula 이, which attaches to nouns and not to verb stems. The same
shape in this product's own subject matter is `팔라는 뜻인가요?` — "does that mean SELL?" — so the
direction of this one matters beyond tidiness.

**FOURTEEN rounds. TERRA returned APPROVE; SOL, which holds publication authority, found one more
and confirmed the IR-110 deferral.** `How is remote work?` was a definition of `remote` — the rule
found `work` in final position and read it as the intransitive predicate, where it is the head NOUN
of the subject. `How is X work?` is not English; only `does` and `do` take a bare infinitive there,
which is exactly what makes `work` a verb in the other two openers. `how is` is removed.

**FIFTEEN rounds, and this one refuted the previous round's fix rather than extending it.** Keeping
`이라는` on the argument that its 이 is the nominal copula was wrong: 죽이다, 먹이다, 보이다, 높이다
are causatives whose stems END in 이, so their quoted imperatives are `죽이라는`, `먹이라는`. A raw
suffix proves nothing about nominality in either form. What a citation actually does is MODIFY
something — `테이퍼링이라는 표현은` names an overt head noun and makes it the subject, where
`죽이라는 뜻이야?` has only a copular predicate — so a raw-suffix citation must now be followed by a
metalinguistic head carrying a topic or nominative marker. `(이)란` is unaffected; it comes through
`analyseNoun`, which checks allomorph conditioning.

Two mutants went MISSED afterwards and neither guard was redundant — the stricter rule simply
covered the only strings the tests held, exactly as in round nine. Measured both by removing them
one at a time: `주가가 테이퍼링이라는 표현은 무슨 뜻인가요?` needs the subject guard, and
`팔라는 표현은 무슨 뜻인가요?` — citing the imperative "sell!" as a term — needs bare `라는` gone.

**SIXTEEN rounds, and the same class a third time — now through `(이)란`.** That form was called
unaffected because `analyseNoun` checks allomorph conditioning, and conditioning proves SUFFIX
COMPATIBILITY, never nominality: `가란 뜻이야?` parses as 가 plus 란, and `지금 사란 뜻이야?` —
"do you mean BUY now?" — is the same collision in this product's own subject matter. The suffix is
not the test in ANY of its forms. A cited term GOVERNS something: a definitional interrogative, or
a case-marked metalinguistic head. `뜻이야` standing alone is the copular predicate, not a governor.
Named cost, one corpus row: `코스피200이란?`, the elliptical dictionary-headword question, governs
nothing and is refused — because allowing an ungoverned citation would admit `사란?`, and this unit
already made that trade once when the head `말` was removed.

| measure                           | before | after                  |
| --------------------------------- | ------ | ---------------------- |
| corpus DEFINITION rows recognised | 9 / 60 | 26 / 60                |
| rows changed                      | —      | 17, every one intended |

**SEVENTEEN rounds.** The `하/합` light-verb carveout — added so `의미하는` and `말합니까` count as
metalinguistic heads verbalised — was applied to the WHAT-interrogatives too, so `주가가 뭐하나요?`
("what is the share price DOING") read `뭐하나요` as `뭐` plus a light verb. 의미하다 makes a verb
OF the noun; 뭐 is a pronoun with nothing to verbalise. Restricted to heads, at no corpus cost.

**EIGHTEEN rounds.** `How does a network?` was a definition of `a net` — `network ` contains
`work ` and the intransitive predicate was found by substring. The same class as the Korean request
frame matched by prefix two rounds earlier: a substring test does not find the word, it finds the
letters. The boundary now lives in one `delimited()` helper rather than being spelled out at three
call sites, because with it spelled out three times the mutant could not be isolated — reverting
one site left the others disagreeing and the request refused for the wrong reason, so a real repair
looked untested.

The round's second finding did NOT reproduce: `인플레이션이 무슨 뜻인가요 설명해주시겠어요?` returns
UNSUPPORTED. Reported as measured, as with `채권 또는 주식은…` in round ten.

**NINETEEN rounds.** `주가가 무엇을 정의하나요?` — "what does the share price DEFINE" — was a
definition of `주가`. The light-verb carveout was written for `의미하는` and applied to every
metalinguistic head, and `정의하다`/`표현하다` are AGENTIVE: the subject does the defining.
`의미하다` and `뜻하다` are not — the subject IS the meaning, which is the relation the noun itself
expresses. The carveout now follows the semantics of the derived verb rather than the shape of the
derivation, at no corpus cost.

**TWENTY rounds. TERRA returned APPROVE; SOL was asked for the RULE rather than one more string
and named one.** `behind` sat in shape 1's citing-complement set: `the meaning OF x` and
`meant BY x` cite x as a term, while `the meaning BEHIND x` asks for the rationale of an event, so
`What is the meaning behind the Fed raising rates?` was a definition of `the Fed raising rates` —
which passed the term test only because that test has no proof of noun-shape. Two of the three
prepositions carried the justification and the third was there by association. Removed; no corpus
row used it.

**TWENTY-THREE rounds, and the last real finding closed a class I had patched an instance of.**
Removing `behind` did not help: `What is the meaning OF the Fed raising rates?` is the same request
with a preposition that survived, because `meaning of` governs event clauses as readily as terms
and `isSingleTermRegion` proves only the absence of other operations' operands, never that a region
is a noun phrase. Patching one instance of an open class is exactly what this unit spent five
rounds learning not to do, and I did it again.

QUOTATION is the proof, and the only lexicon-free one there is: mentioning a term rather than using
it is marked by quoting it. Both corpus rows are quoted — they are the only two the corpus has — so
the measured cost is zero, and the named unmeasured cost is that an unquoted
`What is the meaning of carry trade?` is refused.

Rounds 21 and 22 were documentation: two comment blocks left arguing for designs the code had
already abandoned. A comment that argues for a decision is evidence about that decision, and
reversing the decision without retiring the argument leaves the file asserting two incompatible
things.

**TWENTY-FIVE rounds.** `How does he work?` was a definition of `he` — shape 2 accepted any single
token before the predicate and nothing established that the subject was a NAMED thing. A term is a
name. Pronouns are a closed function-word class with no financial vocabulary shading into it, so
the whole class is refused without any judgement about members.

Rounds 21, 22 and 24 were all documentation: comments left arguing for designs the code had
abandoned. After the third I swept both files myself and found two more. When a rule changes, the
comment that argued for the old rule is part of what changed.

**TWENTY-SIX rounds, and the fourth time writing out "the class" from memory produced a subset.**
I listed `nobody` and omitted `everybody`, after the same thing happened twice with the
prepositions. English indefinite pronouns are COMPOSITIONAL — a determiner morpheme crossed with a
head morpheme — so the code now generates the cross product and the subclass is closed by
construction rather than by recall. That is the general lesson of this unit stated one more way: a
class you can DERIVE should never be typed out.

**TWENTY-EIGHT rounds. SOL returned APPROVE; TERRA, on the same SHA, found two more.** One did not
reproduce (`내 포트폴리오가 무슨 뜻인가요?` returns PROHIBITED — the advice detector has absolute
precedence — though its structural observation about the possessive guard was right, and the
outcome is now pinned). The other did: `주가가 무엇을 설명해?` — "what does the share price
explain" — had its PREDICATE consumed as politeness, because `설명해` is framing in `설명해 주세요`
and a predicate here. Exact matching had fixed prefix overmatch and could not fix ambiguity;
POSITION does. An auxiliary that was itself stripped stands after framing, and nothing stands
after a predicate that ends the request, so those forms strip only after something else already
has.

28 definition mutants, 28 of 28 ISOLATED full suite 138 files / 2422 pass / 19 expected fail
typecheck, eslint, prettier, `next build --webpack` all clean

Outstanding and declared, not closed: lexicalized terms containing a preposition (`return on
equity`, `proof of stake`); unmarked bare terms; constructions outside the frames (`Could you
define convexity?`); the arithmetic residue above; and 19 of the 30 Korean definitional rows,
mostly the `어떤 X인지` frame, whose head noun is an open class where `개념` is definitional and
`수준` is a current observation.

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

0. **OPEN DEBT, no longer a blocker: `P1_UNBOUNDED_CLAUSE_OPENING_CLASS`.** The measurement still
   holds — re-run 2026-09-01, `scripts/probe-unknown-tail.ts` reports 28 of 38 swallowed on each
   of the `.`, `!` and `;` boundaries, unchanged. What changed is its RELATIONSHIP to the work:
   the unit it blocked, MARKET-DEFINITION-GRAMMAR-001, is complete and independently approved at
   `606dc82`, so this is standing debt with an escalated product decision rather than the first
   thing stopping anything. It cannot be closed by adding words -- that is the unfinishable
   direction the module's own `FRAMING_TOKENS` comment warns about -- and the fail-closed
   inversion needs a POS/name lexicon this design does not have.

   The open decision is **accept as a known release risk, or redesign**, and it is a product
   decision rather than an engineering one, so it is escalated and NOT assumed either way. Do not
   close this unit by adding a ninth, tenth and eleventh word.

   Two measurements the architect named are still unrun: a continuation false-refusal corpus of
   real issuer names stratified by tail shape, and the head-alone matrix extended to every
   candidate boundary rather than the first.

1. Then the framing-positionality unit, then B2-C, then B2-D. Two claims that used to sit here
   were checked on 2026-09-01 and are no longer true: `scripts/reproduce-framing-position.ts` is
   TRACKED, and `src/server/domain/sourceAuthority.ts` is REFERENCED — by `askMarket.ts` and
   `candidateEnvelope.ts`, with its own mutation suite. It was wired, which is what this item
   asked for.
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
