# Local AI Calibration

Codex included usage is exhausted until 2026-08-22 (HG-005). Ollama is installed locally and
serving on 127.0.0.1:11434, so the question was whether a local model can stand in as an
interim independent reviewer.

**It cannot.** Both installed models were calibrated and both failed. They are recorded here as
**hypothesis generators only** — a local model may never authorise a code change, and a "finding"
from either carries no evidential weight until Claude reproduces it against real code.

This document exists so the next session does not redo the experiment, and so the eventual Codex
review knows exactly how much the interim period was and was not reviewed.

## Environment

|            |                                                                               |
| ---------- | ----------------------------------------------------------------------------- |
| Runtime    | Ollama 0.32.14, `127.0.0.1:11434`, local inference only                       |
| Hardware   | Intel Iris Xe integrated graphics (~1 GB VRAM), 15.8 GB RAM — CPU-bound       |
| Throughput | 2–6 tokens/sec measured; a 150-token review takes 1.5–5 minutes               |
| Models     | `qwen3.5:4b`, `gemma3:4b`, `qwen3-embedding:0.6b` (embedding, not a reviewer) |
| Cost       | Zero. Already installed, runs locally, no remote fallback enabled.            |

Nothing was downloaded for this exercise and no repository content left the machine. Review
material was bounded source extracts and schema; no `.env`, credentials or tokens were included
in any prompt.

## Task class: financial-correctness code review

### Round 1 — framed prompt (invalid experiment)

The first attempt stated the real-world fact that one filing reports the same concept over
several durations, then asked for the most serious defect.

- `qwen3.5:4b` on the pre-fix `computeFinancialFactDiff`: **correctly identified** the 9M-vs-3M
  comparison.
- `gemma3:4b`: identified it too, less precisely.
- `qwen3.5:4b` on the FIXED implementation: **reported a defect anyway**, claiming the code "only
  matches facts with identical `periodEnd`" — the exact opposite of the
  `f.periodEnd.getTime() < current.periodEnd.getTime()` condition it had been shown.

Removing the leading hint did not help: it then objected that periods with different start dates
"cannot be meaningfully compared for trend analysis", which would forbid period-over-period
comparison altogether.

This round could not distinguish leakage from incapacity, because the prompt named the defect.

### Round 2 — blind, controlled

Three samples through **one identical wrapper**, so the only variable is the code. Neutral
invariants, no mention of any bug, giveaway comments stripped, and an explicit escape hatch:
_"If it does not, reply with exactly NO_SUPPORTED_DEFECT."_

| Sample | Code                                                                 | Ground truth |
| ------ | -------------------------------------------------------------------- | ------------ |
| **D**  | `computeFinancialFactDiff` before the 2026-08-17 fix                 | defective    |
| **F**  | `computeFinancialFactDiff` as it stands now                          | correct      |
| **C**  | `parseEdgarDateAsUtc` + `assertValidCalendarDate` (unrelated, clean) | correct      |

| Model        | D (defective)       | F (fixed)         | C (clean)         | Correct clears |
| ------------ | ------------------- | ----------------- | ----------------- | -------------- |
| `qwen3.5:4b` | ✅ found it         | ❌ false positive | ❌ false positive | 0 / 2          |
| `gemma3:4b`  | (round 1: found it) | ❌ false positive | ❌ false positive | 0 / 2          |

**Neither model ever emitted `NO_SUPPORTED_DEFECT`, on any sample, in any round.**

### The false positives are not near-misses

They are contradicted by the code in the prompt, and were checked rather than assumed:

- Both models claimed sample C accepts `"2026-02-30"`. `Date.UTC(2026, 1, 30)` yields
  `2026-03-02T00:00:00.000Z`, so `getUTCDate()` returns `2`, `2 !== 30`, and the assertion
  throws. Verified by execution, not by reading. `gemma3:4b` went further and asserted that
  `assertValidCalendarDate` "does not check for calendar validity" — which is the function's
  entire body, quoted in the prompt.
- `gemma3:4b` on sample F reported EXPECTED "should return INSUFFICIENT_DATA" against OBSERVED
  "returns INSUFFICIENT_DATA" — the two halves of the finding agree with each other, and it was
  still filed as a defect.

## Diagnosis

Not prompt leakage. The blind harness removed every framing cue and both models still fabricated.

1. **Insufficient code-grounding.** Neither model traces the conditions actually present. It
   pattern-matches the _shape_ of the problem domain ("period comparison", "date parsing") and
   reports the defect that shape usually has, without checking whether this code already handles it.
2. **Response bias toward "defect found".** Under a prompt that asks for review, the completion
   `NO_SUPPORTED_DEFECT` is heavily disfavoured — even when offered explicitly and even when the
   code is clean and short.

The single true positive on sample D is therefore **not discriminative**. Both models report
"missing period-length check" on every sample in the family; on D that description happens to be
true. A detector that always fires has not detected anything.

## Verdict

| Model        | Reviewer / verifier                                                 | Hypothesis generator             |
| ------------ | ------------------------------------------------------------------- | -------------------------------- |
| `qwen3.5:4b` | **NO** — failed negative control                                    | Yes, with mandatory reproduction |
| `gemma3:4b`  | **NO** — failed negative control, plus a self-contradicting finding | Marginal; noisier than qwen      |

Trust requires both halves: detect a known defect **and** clear a clean control. Neither model
passes the second, so neither is an independent reviewer for this task class.

Per the standing directive, no further effort goes into making a 4B CPU model behave like a
frontier model. Interim review proceeds on real data, real PostgreSQL, real browser, deterministic
tests and adversarial reproduction, which have found every genuine defect in this project so far.

`LOCAL_AI_PRE_REVIEW_COMPLETE` is **not** claimed on the strength of these models.
`FINAL_INDEPENDENT_REVIEW` remains open as HG-005.

## Where a local model still earns its keep

One role survives calibration: generating **candidate adversarial inputs** where a deterministic
oracle — not the model — decides the outcome. Ask Market guardrail probing is the clear case. The
model proposes phrasings; `detectPersonalizedAdviceRequest` returns the verdict. Its false-positive
bias costs nothing there, because it is never the judge.

Any other use requires re-calibration against a positive **and** a negative control, recorded in
this file.
