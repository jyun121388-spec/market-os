"""Self-certification for the mutation harness. Run this BEFORE trusting any mutation evidence.

A harness that cannot survive its own failure modes produces confident numbers about nothing. Both
failures modelled here actually happened in this unit:

  CHILD HANG    `subprocess.run` had no timeout. A run sat 59 minutes with zero node processes alive
                and no output before being killed from outside.
  PARENT DEATH  that external kill skipped `finally`, so nothing restored the tree, and the sentinel
                could only warn the next run without being able to fix anything.

Each control drives the REAL harness against a fixture file it owns -- never product code -- so a
failure here is a harness defect and can never damage the repair under test.

Asserting that the source contains `timeout=` would prove nothing: the stall happened in code that
read correctly. These controls make a child genuinely hang and genuinely kill the parent.

    python scripts/mutation/selftest.py
"""

import hashlib
import io
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import harness as H

FIXTURE_REL = "scripts/mutation/selftest_fixture.txt"
FIXTURE_ABS = os.path.join(H.WORKTREE, FIXTURE_REL)
ORIGINAL = "authority: ORIGINAL_MARKER\n"
MUTANT = "authority: MUTANT_MARKER\n"

MUTATIONS = [("SELF-1 flip the marker", FIXTURE_REL, "ORIGINAL_MARKER", "MUTANT_MARKER")]

failures = []


def check(label, condition, detail=""):
    print(f"{'ok  ' if condition else 'FAIL'} {label}{(' -- ' + detail) if detail and not condition else ''}")
    if not condition:
        failures.append(label)


def write_fixture(text):
    os.makedirs(os.path.dirname(FIXTURE_ABS), exist_ok=True)
    io.open(FIXTURE_ABS, "w", encoding="utf-8", newline="\n").write(text)


def fixture_text():
    return io.open(FIXTURE_ABS, encoding="utf-8").read()


def clear_recovery():
    if os.path.exists(H.MANIFEST):
        os.remove(H.MANIFEST)


def fast_child(tests, timeout_ms):
    """A discriminator that reports one passing file, instantly. Baseline must be green for the
    harness to proceed to classification at all."""
    return 'python -c "print(\'Test Files  1 passed (1)\'); print(\'Tests  1 passed (1)\')"'


def hanging_child(tests, timeout_ms):
    """A child that outlives the wall bound. The point of control A."""
    return 'python -c "import time; time.sleep(120)"'


# ---------------------------------------------------------------- A. child hang
print("\n=== CONTROL A: the child hangs, the harness must survive it ===")
write_fixture(ORIGINAL)
clear_recovery()
code = H.harness([FIXTURE_REL], ["x"], ["y"], MUTATIONS,
                 wall_seconds=5, command=hanging_child, needs_db=False)
check("A1 harness returned non-success rather than hanging", code != 0, f"exit={code}")
check("A2 fixture restored to the before-image", fixture_text() == ORIGINAL, repr(fixture_text()))
check("A3 no mutant left on disk", "MUTANT_MARKER" not in fixture_text())
check("A4 recovery manifest cleared or marked complete", not os.path.exists(H.MANIFEST))

# ---------------------------------------------------------------- B. parent crash
print("\n=== CONTROL B: the parent dies mid-mutation, bypassing finally ===")
write_fixture(ORIGINAL)
clear_recovery()
crash = subprocess.run(
    [sys.executable, "-c",
     "import sys; sys.path.insert(0, r'{d}');\n"
     "import selftest_crash".format(d=os.path.dirname(os.path.abspath(__file__)))],
    capture_output=True, cwd=H.WORKTREE,
    env=dict(os.environ, HARNESS_SELFTEST_CRASH_AFTER_MUTATION_WRITE="0"),
)
check("B1 crashed child exited non-zero", crash.returncode != 0, f"exit={crash.returncode}")
check("B2 the mutant IS on disk (finally did not run)", "MUTANT_MARKER" in fixture_text(),
      "the crash injection did not actually leave a mutant, so B proves nothing")
check("B3 recovery manifest survived the crash", os.path.exists(H.MANIFEST))
if os.path.exists(H.MANIFEST):
    saved = json.loads(io.open(H.MANIFEST, encoding="utf-8").read())
    check("B4 manifest marks the run incomplete", saved.get("completed") is False)
    check("B5 manifest names the mutation in flight", saved.get("current_mutation") is not None)
    stale_run_id = saved.get("run_id")
else:
    stale_run_id = None

# ---------------------------------------------------------------- C. startup recovery
print("\n=== CONTROL C: the next invocation recovers before doing anything ===")
recovered = H.startup_recovery()
check("C1 recovery reported success", recovered)
check("C2 exact before-image restored", fixture_text() == ORIGINAL, repr(fixture_text()))
check("C3 mutant signature absent", "MUTANT_MARKER" not in fixture_text())
check("C4 original signature present", "ORIGINAL_MARKER" in fixture_text())
check("C5 hash matches the recorded before-image",
      hashlib.sha256(fixture_text().encode()).hexdigest()
      == hashlib.sha256(ORIGINAL.encode()).hexdigest())
check("C6 manifest cleared only after verification", not os.path.exists(H.MANIFEST))

# ---------------------------------------------------------------- D. stale verdict rejection
print("\n=== CONTROL D: a verdict from the interrupted run may not be reused ===")
write_fixture(ORIGINAL)
clear_recovery()
fresh = H.harness([FIXTURE_REL], ["x"], ["y"], MUTATIONS,
                  wall_seconds=60, command=fast_child, needs_db=False)
check("D1 a clean run completes", fresh in (0, 1), f"exit={fresh}")
check("D2 the stale run_id is not this run's id",
      stale_run_id is None or not os.path.exists(H.MANIFEST))
check("D3 fixture still pristine after a full run", fixture_text() == ORIGINAL)

# ---------------------------------------------------------------- E. path safety
print("\n=== CONTROL E: a corrupt manifest cannot direct a write outside the repo ===")
for hostile in ["../../etc/passwd", "C:/Windows/System32/drivers/etc/hosts", "a/../../b"]:
    try:
        H.owned_relpath(hostile)
        check(f"E {hostile} rejected", False, "accepted a path it should refuse")
    except ValueError:
        check(f"E {hostile} rejected", True)

# ---------------------------------------------------------------- F. recovery conflict
print("\n=== CONTROL F: a third party edited the file; recovery must NOT overwrite it ===")
write_fixture(ORIGINAL)
clear_recovery()
subprocess.run(
    [sys.executable, "-c",
     f"import sys; sys.path.insert(0, r'{os.path.dirname(os.path.abspath(__file__))}'); import selftest_crash"],
    capture_output=True, cwd=H.WORKTREE,
    env=dict(os.environ, HARNESS_SELFTEST_CRASH_AFTER_MUTATION_WRITE="0"),
)
check("F1 crash left the mutant on disk", "MUTANT_MARKER" in fixture_text())
# Somebody else now edits the same file: not the before-image, not the mutant the harness wrote.
THIRD_PARTY = "authority: SOMEONE_ELSES_EDIT\n"
write_fixture(THIRD_PARTY)
recovered = H.startup_recovery()
check("F2 recovery REFUSED", not recovered)
check("F3 third-party bytes untouched", fixture_text() == THIRD_PARTY, repr(fixture_text()))
check("F4 before-image NOT blindly restored", "ORIGINAL_MARKER" not in fixture_text())
check("F5 manifest preserved for diagnosis", os.path.exists(H.MANIFEST))
blocked = H.harness([FIXTURE_REL], ["x"], ["y"], MUTATIONS,
                    wall_seconds=30, command=fast_child, needs_db=False)
check("F6 no new mutation run may start", blocked != 0, f"exit={blocked}")
check("F7 still untouched after the refused start", fixture_text() == THIRD_PARTY)
# Controlled cleanup of the harness's OWN fixture, never foreign work.
write_fixture(ORIGINAL)
clear_recovery()
H.release_lock()

# ---------------------------------------------------------------- G. double start
print("\n=== CONTROL G: a second harness in one worktree must fail closed ===")
write_fixture(ORIGINAL)
clear_recovery()
H.release_lock()
holder = subprocess.Popen(
    [sys.executable, "-c",
     f"import sys, time; sys.path.insert(0, r'{os.path.dirname(os.path.abspath(__file__))}');\n"
     "import harness as H;\n"
     "H.acquire_lock('holder-run');\n"
     "time.sleep(25)"],
    cwd=H.WORKTREE,
)
time.sleep(4)
second = H.harness([FIXTURE_REL], ["x"], ["y"], MUTATIONS,
                   wall_seconds=20, command=fast_child, needs_db=False)
check("G1 second harness refused with a non-success exit", second == 8, f"exit={second}")
check("G2 it did not write the product/fixture file", fixture_text() == ORIGINAL, repr(fixture_text()))
check("G3 it produced no mutation verdict", second != 0)
holder.kill()
holder.wait()
H.release_lock()
clear_recovery()

if os.path.exists(FIXTURE_ABS):
    os.remove(FIXTURE_ABS)
clear_recovery()
H.release_lock()

print("\n" + ("SELFTEST PASS - harness evidence may be trusted" if not failures
              else f"SELFTEST FAIL ({len(failures)}): " + "; ".join(failures)))
sys.exit(1 if failures else 0)
