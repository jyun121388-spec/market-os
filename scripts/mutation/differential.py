"""Run one probe command against the ORIGINAL tree and against a MUTANT, and diff the outputs.

A surviving mutant means the TESTS do not separate two rules. It does not mean the rules agree.
Deciding which by reading the code has been wrong twice in this unit, in both directions, so the
question gets a measurement: generate a corpus, print a fingerprint per input, apply the mutant,
print again, diff.

Same transaction discipline as `harness.py`, and for the same reason -- this writes product source
to disk, so a killed parent must not be able to leave a mutant behind. Lock first, before-image and
manifest durable before the write, restore verified by hash, recovery on the next start.

    python scripts/mutation/differential.py [DUMP_DIR] [CASE]

CASE names an entry in CASES below; DUMP_DIR, if given, receives both raw outputs so the DIRECTION
of every difference can be counted without re-applying the mutant. Prints every discriminating
input, or states that the corpus found none.
"""

import io
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import harness as H

RA = "src/server/domain/requestAuthority.ts"

CASES = {
    # B-M3, verbatim from `scripts/mutation/boundary.py`: does scanning the whole tail differ from
    # scanning only its first token?
    "bm3": {
        "label": "B-M3 first-token-only clause scan",
        "path": RA,
        "old": "    return tokens.some((token) => CLAUSE_OPENING_TOKENS.has(token));",
        "new": "    return tokens.length > 0 && CLAUSE_OPENING_TOKENS.has(tokens[0]);",
        "probe": "npx tsx scripts/diff-clause-token-scan.ts",
    },
    # B-M2 against the name-tail probe: is the clause-opening rule what refuses
    # `What did Bloomberg L.P. show about Alpha?`, or is something else doing it? Attributing a
    # refusal to the wrong rule is how a repair gets aimed at the wrong line.
    "nametail": {
        "label": "B-M2 clause-opening tokens no longer confirm",
        "path": RA,
        "old": "    return tokens.some((token) => CLAUSE_OPENING_TOKENS.has(token));",
        "new": "    return false;",
        "probe": "npx tsx scripts/probe-name-tail-openers.ts",
    },
    # The whole repair, switched off at its single point of effect: blocked runs are admitted to
    # the tiling again. This is what "before the P1 repair" actually means, and running it is the
    # only honest way to call a behaviour a REGRESSION. The predicate is still computed, so this
    # isolates the repair's EFFECT rather than its computation.
    "prerepair": {
        "label": "REPAIR DISABLED - blocked runs admitted to the tiling",
        "path": RA,
        "old": "      if (readings.length === 1 && !crossesConfirmed) {",
        "new": "      if (readings.length === 1) {",
        "probe": "npx tsx scripts/probe-name-tail-openers.ts",
    },
    # The three groups of tokens P1 review's finding added, one case each, measured over the big
    # corpus. The question these answer is the OTHER direction: closing seven swallows is only a
    # repair if it does not start refusing legitimate requests, and `list`, `any` and `same` are
    # ordinary enough to sit in a real name tail.
    "wh-interrogatives": {
        "label": "the added interrogatives no longer confirm",
        "path": RA,
        "old": '  "who",\n  "whom",\n  "whose",\n  "why",\n  "when",\n  "where",\n',
        "new": "",
        "probe": "npx tsx scripts/diff-clause-token-scan.ts",
    },
    "wh-imperatives": {
        "label": "the added imperatives no longer confirm",
        "path": RA,
        "old": '  "compare",\n  "list",\n',
        "new": "",
        "probe": "npx tsx scripts/diff-clause-token-scan.ts",
    },
    "wh-determiners": {
        "label": "the added determiners no longer confirm",
        "path": RA,
        "old": '    if (tokens.length > 0 && ["the", "a", "an", "any", "same"].includes(tokens[0]))'
               " return true;",
        "new": '    if (tokens.length > 0 && ["the", "a", "an"].includes(tokens[0])) return true;',
        "probe": "npx tsx scripts/diff-clause-token-scan.ts",
    },
    # A CANDIDATE, not a repair, and measured before being proposed rather than after.
    #
    # Architect review's answer to "can the token set's completeness ever be checked" was no -- not
    # at this design's level, and a generated opener corpus only relocates the unproved claim into
    # its generator. It did name one bounded structural strengthening: `?` appears never to occur
    # name-internally in this domain, while `.` and `!` demonstrably do (`Inc.`, `U.S.`, `Mr.`,
    # `No.`, `Yahoo!`). Treating `?` as always confirming would have caught five of the seven
    # swallowed clauses structurally instead of lexically.
    #
    # Review also declined to call that a universal invariant -- "no counterexample currently known"
    # is a reason to measure, not a proof -- and required the two directions to be reported
    # separately. So this case exists to produce that number. `new` here is the CANDIDATE; the
    # differential runs current-versus-candidate.
    # B-M1 went from ISOLATED to MISSED when the terminator rule landed. Disable-and-measure, which
    # is the only thing that may retire a rule here -- a surviving mutant never is. This removes the
    # Korean branch entirely and asks whether ANY behaviour changes once `?` confirms on its own.
    "korean-branch": {
        "label": "the Korean-clause confirmation removed entirely",
        "path": RA,
        "old": "    if (containsHangul(text)) {\n"
               "      return eojeols(text).some((eojeol) => analyseCopularInterrogative(eojeol) !== null);\n"
               "    }\n",
        "new": "",
        "probe": "npx tsx scripts/probe-korean-after-period.ts",
    },
    "korean-branch-corpus": {
        "label": "the Korean-clause confirmation removed entirely, over the big corpus",
        "path": RA,
        "old": "    if (containsHangul(text)) {\n"
               "      return eojeols(text).some((eojeol) => analyseCopularInterrogative(eojeol) !== null);\n"
               "    }\n",
        "new": "",
        "probe": "npx tsx scripts/diff-clause-token-scan.ts",
    },
    # Which of the "must keep authorizing" names does the HEAD condition protect, and which are
    # carried by a tail property? Architect review needs this before it can say how narrow a
    # name-continuation class could be: if the head condition already carries the verb-bearing
    # tails (`Mr. Show report about Alpha`, `Bureau of Labor Statistics publish about ...`), a
    # continuation class only has to cover short nominals. Disable the head condition and see which
    # of them changes.
    "head-condition": {
        "label": "the head no longer has to read (B-M7), against the name controls",
        "path": RA,
        "old": "      if (last > first && confirmedBoundary[last] && headReads) crossesConfirmed = true;",
        "new": "      if (last > first && confirmedBoundary[last]) crossesConfirmed = true;",
        "probe": "npx tsx scripts/probe-period-boundary.ts",
    },
    # ESC-015 OPTION B, measured before implementation as the decision requires.
    #
    # "Refuse a parse when a candidate boundary remains inside an open-class served region, using
    # the existing bilateral/head evidence rather than adding more clause-opening words." The
    # surface narrows from CONFIRMED boundaries to ALL candidate boundaries: the tail-evidence
    # conjunct goes, the head conjunct stays. No vocabulary is added, which is the point -- token
    # accumulation was explicitly rejected.
    #
    # Run-level rather than region-level because fragment offsets are raw-query coordinates while
    # regions are slices of NORMALIZED text, and no offset map between the two exists. A region can
    # only cross a boundary if its run does, so the run-level statement is the available proxy and
    # is the same one the shipped rule already uses.
    "option-b": {
        "label": "ESC-015 Option B: any candidate boundary blocks a run whose head reads",
        "path": RA,
        "old": "      if (last > first && confirmedBoundary[last] && headReads) crossesConfirmed = true;",
        "new": "      if (last > first && headReads) crossesConfirmed = true;",
        "probe": "npx tsx scripts/probe-option-b.ts",
    },
    # ESC-015 Option B, NARROWED -- the redesign proposal the decision asks for if plain B breaks
    # ordinary names, which it does (6 of 14 controls, including three the decision named).
    #
    # Plain B blocks on ANY candidate boundary. The six false refusals are all the same shape: the
    # period follows an ABBREVIATION -- `Inc.`, `U.S.`, `No.`, `Co.`, `Mr.`, `L.P.` -- while all 28
    # swallows follow an ordinary word (`Alpha.`, `Gamma.`). That difference is structural rather
    # than lexical, and it is the classic sentence-boundary signal: a period after a short token, or
    # after a token already containing periods, is an abbreviation period and not a sentence end.
    #
    #     `?`  a sentence end (already shipped, with the registered-issuer exception)
    #     `!`  never confirms -- `Yahoo!` is a brand, and no counterexample of `!` ending a clause
    #          mid-request has been produced
    #     `.` `;`  a sentence end UNLESS the preceding token is abbreviation-shaped: 3 or fewer
    #          alphanumerics, or containing an internal period
    #
    # Written as an inline expression because this is a measurement mutant and differential.py
    # substitutes one string; if it earns implementation it becomes a named helper.
    "option-b-narrowed": {
        "label": "ESC-015 Option B narrowed by abbreviation shape",
        "path": RA,
        "old": "      if (last > first && confirmedBoundary[last] && headReads) crossesConfirmed = true;",
        "new": (
            "      if (\n"
            "        last > first &&\n"
            "        headReads &&\n"
            "        (confirmedBoundary[last] ||\n"
            "          ((): boolean => {\n"
            "            const pre = query.slice(0, fragments[last].start).trimEnd();\n"
            "            const term = pre.slice(-1);\n"
            '            if (term === "!" || term === ";") return false;\n'
            '            if (term === "?") return true;\n'
            '            const prev = pre.slice(0, -1).trim().split(/\\s+/).pop() ?? "";\n'
            '            const bare = prev.replace(/[^0-9A-Za-z]/g, "");\n'
            '            return !(bare.length <= 3 || prev.includes("."));\n'
            "          })())\n"
            "      )\n"
            "        crossesConfirmed = true;"
        ),
        "probe": "npx tsx scripts/probe-option-b.ts",
    },
    "option-b-narrowed-corpus": {
        "label": "ESC-015 Option B narrowed by abbreviation shape",
        "path": RA,
        "old": "      if (last > first && confirmedBoundary[last] && headReads) crossesConfirmed = true;",
        "new": (
            "      if (\n"
            "        last > first &&\n"
            "        headReads &&\n"
            "        (confirmedBoundary[last] ||\n"
            "          ((): boolean => {\n"
            "            const pre = query.slice(0, fragments[last].start).trimEnd();\n"
            "            const term = pre.slice(-1);\n"
            '            if (term === "!" || term === ";") return false;\n'
            '            if (term === "?") return true;\n'
            '            const prev = pre.slice(0, -1).trim().split(/\\s+/).pop() ?? "";\n'
            '            const bare = prev.replace(/[^0-9A-Za-z]/g, "");\n'
            '            return !(bare.length <= 3 || prev.includes("."));\n'
            "          })())\n"
            "      )\n"
            "        crossesConfirmed = true;"
        ),
        "probe": "npx tsx scripts/diff-clause-token-scan.ts",
    },
    # M-EXACT-COVER survived the mutation run. A survivor never proves a branch is unreachable, so
    # this is the disable-and-measure that can: apply the mutation and ask whether ANY of 99,072
    # generated requests changes. The `interpretations.length > 1` branch needs the JOINED run to be
    # admitted while the split cover also exists, and the tail evidence that blocks a joined run is
    # the same evidence that makes a tail read alone -- so the two conditions may be anti-correlated
    # by construction. May be. That is what this measures.
    "exact-cover-unreachable": {
        "label": "M-EXACT-COVER over the big corpus, to test reachability",
        "path": RA,
        "old": "  if (interpretations.length > 1) {",
        "new": "  if (false as boolean) {",
        "probe": "npx tsx scripts/diff-clause-token-scan.ts",
    },
    # B-M8 survived the boundary run on the exact-cover tree. Plausible reason: ESC-015 item 4 made
    # a prohibited request publish nothing at all, so whether a prohibited span counts as a complete
    # HEAD may no longer change any outcome. Plausible is not measured, and a survivor never proves
    # equivalence, so this is the disable-and-measure.
    "bm8-advice-head": {
        "label": "B-M8 a standalone prohibited request no longer counts as a complete head",
        "path": RA,
        "old": "      headReads = readings.length > 0 || detectPersonalizedAdviceRequest(span);",
        "new": "      headReads = readings.length > 0;",
        "probe": "npx tsx scripts/diff-clause-token-scan.ts",
    },
    "question-mark-confirms": {
        "label": "CANDIDATE: a ? boundary always confirms, . ! ; stay provisional",
        "path": RA,
        "old": "    if (containsHangul(text)) {",
        "new": '    if (query.slice(0, fragment.start).trimEnd().endsWith("?")) return true;\n'
               "    if (containsHangul(text)) {",
        "probe": "npx tsx scripts/diff-clause-token-scan.ts",
    },
}

CASE = CASES[sys.argv[2] if len(sys.argv) > 2 else "bm3"]
PROBE = CASE["probe"]
OLD, NEW = CASE["old"], CASE["new"]


def run_probe(label, wall_seconds=900):
    started = time.monotonic()
    try:
        done = subprocess.run(
            PROBE, shell=True, capture_output=True, cwd=H.WORKTREE, timeout=wall_seconds,
            env=H.test_env(),
        )
    except subprocess.TimeoutExpired:
        H.emit(f"PROBE {label} EXCEEDED {wall_seconds}s - INVALID, not a result")
        return None
    out = done.stdout.decode("utf-8", "replace")
    H.emit(f"probe {label}: exit={done.returncode} lines={len(out.splitlines())} "
           f"{time.monotonic() - started:.0f}s")
    if done.returncode != 0:
        H.emit(done.stderr.decode("utf-8", "replace")[-2000:])
        return None
    return out


def main():
    os.chdir(H.WORKTREE)
    token = f"{os.getpid()}-{time.time_ns()}"
    if not H.acquire_lock(token):
        return 8
    try:
        if not H.startup_recovery():
            H.emit("HARNESS_INVALID: could not recover a previous interrupted run")
            return 5

        path = H.owned_relpath(CASE["path"])
        absolute = os.path.join(H.WORKTREE, path)
        original = io.open(absolute, encoding="utf-8").read()
        if original.count(OLD) != 1:
            H.emit(f"HARNESS_INVALID: anchor occurs {original.count(OLD)} times, expected exactly 1")
            return 3
        run_id = f"diff-{token}"
        H.snapshot_owned({path: original}, run_id)
        H.emit(f"RUN_STARTED {run_id[:12].replace('-', '0')} pid={os.getpid()} mutations=1")

        mutated = original.replace(OLD, NEW)
        try:
            base = run_probe("ORIGINAL")
            if base is None:
                return 2

            manifest = json.loads(io.open(H.MANIFEST, encoding="utf-8").read())
            manifest["current_mutation"] = CASE["label"]
            manifest["mutated_path"] = path
            manifest["expected_mutant_sha256"] = H.hashlib.sha256(
                mutated.encode("utf-8")).hexdigest()
            manifest["phase"] = "MUTATION_PREPARED"
            H._publish(manifest)

            io.open(absolute, "w", encoding="utf-8", newline="\n").write(mutated)
            manifest["phase"] = "MUTATION_ACTIVE"
            H._publish(manifest)

            variant = run_probe("MUTANT")
        finally:
            io.open(absolute, "w", encoding="utf-8", newline="\n").write(original)
            back = io.open(absolute, encoding="utf-8").read()
            if back != original:
                H.emit("RESTORE FAILED - manifest KEPT for the next invocation")
                return 4
            if os.path.exists(H.MANIFEST):
                os.remove(H.MANIFEST)

        if variant is None:
            return 2

        base_lines = base.splitlines()
        variant_lines = variant.splitlines()
        if len(base_lines) != len(variant_lines):
            H.emit(f"HARNESS_INVALID: corpus sizes differ, {len(base_lines)} vs "
                   f"{len(variant_lines)} - not line-comparable")
            return 3

        # Both raw outputs are kept so the DIRECTION of every difference can be counted afterwards
        # without re-applying the mutant. A truncated on-screen list is a sample, and this unit has
        # already had one sample read as a whole.
        dump = sys.argv[1] if len(sys.argv) > 1 else None
        if dump:
            os.makedirs(dump, exist_ok=True)
            io.open(os.path.join(dump, "original.tsv"), "w", encoding="utf-8",
                    newline="\n").write(base)
            io.open(os.path.join(dump, "mutant.tsv"), "w", encoding="utf-8",
                    newline="\n").write(variant)
            H.emit(f"raw outputs written under {dump}")

        differing = [(b, v) for b, v in zip(base_lines, variant_lines) if b != v]
        H.emit(f"\ncorpus: {len(base_lines) - 1} requests")
        if not differing:
            H.emit("NO DISCRIMINATING INPUT over this corpus.")
            H.emit("The two variants agree on every request it can express. The mutant is not")
            H.emit("merely untested here; nothing in this corpus can tell the variants apart.")
        else:
            H.emit(f"{len(differing)} DISCRIMINATING INPUT(S):")
            for b, v in differing[:60]:
                query = b.split("\t")[0]
                H.emit(f"\n  {query}")
                H.emit(f"    original : {b.split(chr(9), 1)[1]}")
                H.emit(f"    mutant   : {v.split(chr(9), 1)[1]}")
            if len(differing) > 60:
                H.emit(f"\n  ... and {len(differing) - 60} more, NOT shown (not 'none')")
        H.emit(f"RUN_COMPLETED {run_id[:12].replace('-', '0')}")
        return 0
    finally:
        H.release_lock(token)


sys.exit(main())
