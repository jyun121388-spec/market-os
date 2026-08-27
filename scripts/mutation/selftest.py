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


def force_release():
    """Drop whatever lock is on disk. Only the self-test may do this: `release_lock` deliberately
    refuses to remove a lock it does not own, which is the property control G depends on, so the
    controls have to read the holder's token back before releasing between sections."""
    if os.path.exists(H.LOCK):
        H.release_lock(io.open(H.LOCK, encoding="utf-8").read().strip())


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
print("\n=== CONTROL D: a verdict from an interrupted run may not be counted ===")
# The previous version of this control ran one clean harness and asserted the run finished. Review
# was right that it proved nothing: it never produced a stale verdict, never presented one to
# anything, and the in-process filter it nominally covered could not fail by construction. So D now
# obtains two REAL logs from the real harness -- one complete, one killed after a verdict was
# already printed -- and pushes both through the path where a stale verdict actually gets counted:
# a reader totalling the lines it can see.
RUN_CHILD = os.path.join(os.path.dirname(os.path.abspath(__file__)), "selftest_run.py")


def child_log(crash_after=None):
    env = dict(os.environ)
    env.pop("HARNESS_SELFTEST_CRASH_AFTER_MUTATION_WRITE", None)
    if crash_after is not None:
        env["HARNESS_SELFTEST_CRASH_AFTER_MUTATION_WRITE"] = str(crash_after)
    write_fixture(ORIGINAL)
    clear_recovery()
    force_release()
    done = subprocess.run([sys.executable, RUN_CHILD], capture_output=True, cwd=H.WORKTREE, env=env)
    return done.stdout.decode("utf-8", "replace"), done.returncode


log_complete, exit_complete = child_log()
log_truncated, exit_truncated = child_log(crash_after=1)
H.startup_recovery()  # the killed run left a live mutant; clean it up before scoring anything

complete = H.verify_report(log_complete)
truncated = H.verify_report(log_truncated)
stale_labels = {v["label"] for v in truncated["rejected"]}

check("D1 the complete run finished and was bracketed", exit_complete in (0, 1)
      and not complete["unbracketed_runs"], f"exit={exit_complete} {complete['unbracketed_runs']}")
check("D2 its verdicts are admissible", len(complete["admissible"]) == 2
      and not complete["rejected"], str(complete))
# Non-vacuity, in the direction that matters: if the truncated log carried no verdict line, every
# assertion below would pass for the wrong reason.
check("D3 the interrupted log DOES contain a verdict line to be tempted by",
      len(truncated["rejected"]) >= 1, f"nothing stale to reject: {log_truncated[-400:]!r}")
check("D4 the interrupted run is reported unbracketed", len(truncated["unbracketed_runs"]) == 1,
      str(truncated["unbracketed_runs"]))
check("D5 none of its verdicts are admissible", truncated["admissible"] == [], str(truncated))
# The realistic shape of the mistake: one scrollback holding both runs, read as if it were one.
mixed = H.verify_report(log_truncated + log_complete)
check("D6 in a mixed log only the completed run's verdicts survive",
      len(mixed["admissible"]) == 2
      and {v["run_id"] for v in mixed["admissible"]} == {v["run_id"] for v in complete["admissible"]},
      str(mixed["admissible"]))
check("D7 the stale verdicts are rejected by id, not silently dropped",
      {v["label"] for v in mixed["rejected"]} == stale_labels, str(mixed["rejected"]))
# And the rejection must be CAUSED by the missing bracket. Give the interrupted run the one line it
# never emitted; if its verdict is still not admitted, D5 was passing because the parser could not
# see the line, and the control would be measuring its own blindness.
stale_id = truncated["unbracketed_runs"][0] if truncated["unbracketed_runs"] else "0" * 12
forged = H.verify_report(log_truncated + f"RUN_COMPLETED {stale_id}\n")
check("D8 the SAME verdict is admitted once its run is bracketed", len(forged["admissible"]) >= 1,
      "exclusion was not caused by the missing RUN_COMPLETED")
check("D9 fixture pristine after both runs and recovery", fixture_text() == ORIGINAL,
      repr(fixture_text()))
check("D10 no manifest left behind", not os.path.exists(H.MANIFEST))

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
force_release()

# ---------------------------------------------------------------- G. double start
print("\n=== CONTROL G: a second harness in one worktree must fail closed ===")
write_fixture(ORIGINAL)
clear_recovery()
force_release()
# The holder must look like a run that is genuinely MID-MUTATION: lock held AND an incomplete
# manifest on disk. Review found the original version of this control could not have caught the
# real defect, because its holder took the lock without leaving a manifest -- so the second harness
# had nothing to wrongly "recover". A control that cannot see the bug it is named for is decoration.
holder = subprocess.Popen(
    [sys.executable, "-c",
     f"import sys, time, io, os; sys.path.insert(0, r'{os.path.dirname(os.path.abspath(__file__))}');\n"
     "import harness as H;\n"
     "H.acquire_lock('%d-holder' % os.getpid());\n"
     "H.snapshot_owned({'" + FIXTURE_REL + "': open(r'" + FIXTURE_ABS.replace('\\', '/') + "').read()}, 'holder-run');\n"
     "m = __import__('json').loads(io.open(H.MANIFEST).read());\n"
     "m['current_mutation'] = 'SELF-1 flip the marker'; m['mutated_path'] = '" + FIXTURE_REL + "';\n"
     "m['phase'] = 'MUTATION_ACTIVE'; H._publish(m);\n"
     "io.open(r'" + FIXTURE_ABS.replace('\\', '/') + "', 'w', newline='\\n').write('authority: MUTANT_MARKER\\n');\n"
     "time.sleep(30)"],
    cwd=H.WORKTREE,
)
time.sleep(6)
mid_mutation_bytes = fixture_text()
check("G0 holder is genuinely mid-mutation", "MUTANT_MARKER" in mid_mutation_bytes, mid_mutation_bytes)
second = H.harness([FIXTURE_REL], ["x"], ["y"], MUTATIONS,
                   wall_seconds=20, command=fast_child, needs_db=False)
check("G1 second harness refused with a non-success exit", second == 8, f"exit={second}")
check("G2 it did NOT recover the live run's active mutant", fixture_text() == mid_mutation_bytes,
      f"the live run's bytes were changed underneath it: {fixture_text()!r}")
check("G3 it did NOT delete the live run's manifest", os.path.exists(H.MANIFEST))
check("G4 it produced no mutation verdict", second != 0)
holder.kill()
holder.wait()
write_fixture(ORIGINAL)
clear_recovery()
force_release()

if os.path.exists(FIXTURE_ABS):
    os.remove(FIXTURE_ABS)
clear_recovery()
force_release()

print("\n" + ("SELFTEST PASS - harness evidence may be trusted" if not failures
              else f"SELFTEST FAIL ({len(failures)}): " + "; ".join(failures)))
sys.exit(1 if failures else 0)
