"""Isolation-mutation harness. ASSURANCE CODE, version-controlled deliberately.

It used to live in a session scratchpad, and that directory was deleted mid-unit -- taking every
mutant set and every log with it. Recovery state kept somewhere more volatile than the thing it
protects is not recovery state. The product work survived only because it was committed, which is
the argument for committing this too.

Nothing here is imported by product code. It is measurement apparatus.

## Three storage locations, three different lifetimes, and mixing them was the bug

  THIS FILE          tracked, reviewed, durable. Code.
  RECOVERY STATE     <git-dir>/mutation-recovery/ -- durable across session death, and OUTSIDE the
                     worktree so it can never enter `git status`, `git add`, or a commit. It is
                     transaction state, not source. `git rev-parse --git-dir` is resolved at
                     runtime rather than assuming `.git/`, because this repository is checked out
                     as a linked worktree where `.git` is a FILE and the real directory lives under
                     the parent's `.git/worktrees/`.
  LOGS / CORPORA     may stay ephemeral: anything recreatable from committed code is not evidence
                     worth protecting.

## Two failure contracts, and only one is survivable by `finally`

  CHILD HANGS   harness alive. Every invocation is wall-bounded; a timeout scores the mutation
                INVALID rather than MISSED, and `finally` restores. Measured cause of a 59-minute
                stall: `subprocess.run` with no timeout, zero node processes alive, no output.

  PARENT DIES   `finally` NEVER RUNS. A sentinel can only WARN the next run; it records no bytes, so
                it cannot restore. The before-image is therefore written BEFORE the first mutation,
                and the next invocation recovers from it. Ordering is absolute -- mutate-then-
                snapshot would record the mutant as the thing to restore.

## Baseline means "as this run found it", never "same as HEAD"

The worktree legitimately carries uncommitted work. Restoring to HEAD would destroy it. Every
operation is scoped to explicitly owned paths, and `git add -A`, `git add .`, `git stash`,
`git reset --hard`, `git clean` and broad restores are all forbidden: a harness that forms opinions
about files it does not own is more dangerous than the bugs it hunts.
"""

import hashlib
import io
import json
import os
import re
import subprocess
import sys
import time

WORKTREE = subprocess.run(
    ["git", "rev-parse", "--show-toplevel"],
    capture_output=True,
    cwd=os.path.dirname(os.path.abspath(__file__)),
).stdout.decode().strip()

_GIT_DIR = subprocess.run(
    ["git", "rev-parse", "--git-dir"], capture_output=True, cwd=WORKTREE
).stdout.decode().strip()

# Durable, untracked, and correct for a linked worktree. Never `.git/` by assumption.
RECOVERY_DIR = os.path.join(_GIT_DIR, "mutation-recovery")
MANIFEST = os.path.join(RECOVERY_DIR, "manifest.json")
LOCK = os.path.join(RECOVERY_DIR, "lock")

PG_BIN = r"C:\AI-Projects\market-os\.local\pgsql\bin"
PG_PORT = "55432"
TEST_DB = "market_os_test"
TEST_DATABASE_URL = "postgresql://postgres:devpassword@127.0.0.1:55432/market_os_test?schema=public"

# TEST ONLY. Set to a mutation index to die immediately after that mutant is written, bypassing
# `finally` via os._exit -- the only faithful model of a killed parent. Never set in a real run.
CRASH_AFTER_MUTATION = os.environ.get("HARNESS_SELFTEST_CRASH_AFTER_MUTATION_WRITE")


def emit(text):
    sys.stdout.buffer.write((text + "\n").encode("ascii", "replace"))
    sys.stdout.flush()


def owned_relpath(path):
    """Accept only a repository-relative path that stays inside the repository.

    A manifest is read back after a crash, when nothing about the previous process is trustworthy.
    An absolute path or a `..` in that file would let a corrupt or stale manifest direct a write
    anywhere on disk, so paths are validated on the way IN and re-validated on the way OUT.
    """
    if os.path.isabs(path) or ".." in path.replace("\\", "/").split("/"):
        raise ValueError(f"owned path must be repo-relative with no '..': {path!r}")
    resolved = os.path.realpath(os.path.join(WORKTREE, path))
    if os.path.commonpath([resolved, os.path.realpath(WORKTREE)]) != os.path.realpath(WORKTREE):
        raise ValueError(f"owned path escapes the repository: {path!r}")
    return path.replace("\\", "/")


def test_env():
    """`DATABASE_URL` is REMOVED, not aliased. The destructive-test guard refuses when they match,
    and it is right to: a suite that truncates tables must never be one variable away from the
    development database. Defeating that guard is the one repair never available."""
    env = dict(os.environ, TEST_DATABASE_URL=TEST_DATABASE_URL)
    env.pop("DATABASE_URL", None)
    env.pop("HARNESS_SELFTEST_CRASH_AFTER_MUTATION_WRITE", None)
    return env


def _select_one():
    probe = subprocess.run(
        [os.path.join(PG_BIN, "psql.exe"), "-h", "127.0.0.1", "-p", PG_PORT, "-U", "postgres",
         "-d", TEST_DB, "-t", "-A", "-c", "select 1"],
        capture_output=True, env=dict(os.environ, PGPASSWORD="devpassword"),
    )
    return probe.stdout.decode("utf-8", "replace").strip() == "1"


def database_ready(settle_seconds=30):
    for _ in range(settle_seconds):
        if _select_one():
            return True
        time.sleep(1)
    emit("INVALID_ENVIRONMENT: database did not answer SELECT 1")
    return False


def _pid_alive(pid):
    """Is that process still running? Windows has no usable os.kill(pid, 0)."""
    probe = subprocess.run(
        ["tasklist", "/FI", f"PID eq {int(pid)}", "/NH", "/FO", "CSV"], capture_output=True
    )
    return f'"{int(pid)}"' in probe.stdout.decode("utf-8", "replace")


def acquire_lock(token):
    """One active mutation transaction per worktree, or fail closed.

    Two harnesses in one worktree is not a slow run, it is a corrupt one: B would snapshot A's
    MUTANT as its own before-image and then "restore" the tree to a mutated state that nothing
    records as wrong. That is a worse outcome than either run failing.

    A lock held by a DEAD process is wreckage rather than contention, so it is reclaimed -- but the
    reclaim is where the race lives. Read-pid-then-overwrite is TOCTOU: two processes can both see
    the same dead pid, both write, and both proceed believing they own the worktree. So the reclaim
    writes a UNIQUE TOKEN through an atomic replace and then READS IT BACK. Exactly one writer can
    see its own token afterwards; everyone else lost and says so.
    """
    os.makedirs(RECOVERY_DIR, exist_ok=True)
    try:
        fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, token.encode())
        os.close(fd)
        return True
    except FileExistsError:
        pass

    try:
        holder = io.open(LOCK, encoding="utf-8").read().strip()
        holder_pid = int(holder.split("-")[0])
    except (ValueError, IndexError, OSError):
        holder, holder_pid = "(unreadable)", None
    if holder_pid is not None and _pid_alive(holder_pid):
        emit(f"HARNESS_BUSY: {holder} already owns this worktree's mutation transaction")
        return False

    emit(f"   lock held by dead owner {holder}; attempting atomic reclaim")
    staging = f"{LOCK}.{token}.claim"
    io.open(staging, "w", encoding="utf-8", newline="\n").write(token)
    os.replace(staging, LOCK)
    # Whoever's token survives the last replace owns it. Reading back is what turns a racy
    # overwrite into a decision.
    winner = io.open(LOCK, encoding="utf-8").read().strip()
    if winner != token:
        emit(f"HARNESS_BUSY: lost the reclaim race to {winner}")
        return False
    return True


def release_lock(token):
    """Release ONLY if we still hold it. Deleting unconditionally would remove a lock another run
    legitimately reclaimed after we were declared dead, handing the worktree to a third process."""
    try:
        if io.open(LOCK, encoding="utf-8").read().strip() != token:
            return
        os.remove(LOCK)
    except OSError:
        pass


def owned_worktree_dirt(paths):
    """`git status` for owned files only. A SHA proves the bytes are what I wrote; this proves git
    agrees the file is unchanged -- the question that catches line-ending drift and created-rather-
    than-edited files."""
    proc = subprocess.run(
        ["git", "status", "--porcelain", "--"] + list(paths), capture_output=True, cwd=WORKTREE
    )
    return proc.stdout.decode("utf-8", "replace").strip()


def _publish(payload):
    """Atomic manifest publication. A half-written manifest is worse than none: recovery would read
    a truncated record and either refuse forever or restore partial state."""
    os.makedirs(RECOVERY_DIR, exist_ok=True)
    staging = MANIFEST + ".tmp"
    io.open(staging, "w", encoding="utf-8", newline="\n").write(json.dumps(payload, indent=1))
    os.replace(staging, MANIFEST)


def snapshot_owned(originals, run_id):
    """Before-image and manifest, both durable, both written BEFORE the first mutant."""
    os.makedirs(RECOVERY_DIR, exist_ok=True)
    entries = []
    for index, rel in enumerate(sorted(originals)):
        blob = os.path.join(RECOVERY_DIR, f"{index}.before")
        io.open(blob, "w", encoding="utf-8", newline="\n").write(originals[rel])
        entries.append({
            "path": rel,
            "blob": blob,
            "sha256": hashlib.sha256(originals[rel].encode("utf-8")).hexdigest(),
        })
    _publish({
        "run_id": run_id,
        "pid": os.getpid(),
        "entries": entries,
        "git_status_before": owned_worktree_dirt(sorted(originals)),
        "completed": False,
        "current_mutation": None,
    })


def startup_recovery():
    """Recover a PREVIOUS interrupted run before this one may begin.

    A manifest with `completed: false` is a run that never reached its own end. Its verdicts are not
    results -- an interrupted log reads exactly like a truncated successful one, which is how a
    stall nearly passed for a measurement.
    """
    if not os.path.exists(MANIFEST):
        return True
    try:
        manifest = json.loads(io.open(MANIFEST, encoding="utf-8").read())
    except ValueError:
        emit("HARNESS_INVALID: recovery manifest is unreadable. Refusing to guess at recovery.")
        return False
    if manifest.get("completed"):
        os.remove(MANIFEST)
        return True

    emit(f"PREVIOUS_RUN_INTERRUPTED run_id={manifest.get('run_id')} "
         f"mutation={manifest.get('current_mutation')}")
    emit("   every verdict from that run is DISCARDED; none may enter this run's denominator")

    # The harness may overwrite a file ONLY when it can prove it knows what is there. Exactly two
    # hashes are legitimate: the before-image (nothing happened) and the exact mutant this run
    # recorded intending to write (its own drift). Anything else belongs to a THIRD PARTY -- a
    # concurrent editor, a partial write, a person fixing something by hand -- and restoring the
    # before-image over it would destroy work the harness never owned. That is the worse failure:
    # a mutant left on disk is at least recorded somewhere, while overwritten foreign work is gone.
    expected_mutant = manifest.get("expected_mutant_sha256")
    mutated_path = manifest.get("mutated_path")
    restored = []
    for entry in manifest.get("entries", []):
        try:
            rel = owned_relpath(entry["path"])
        except ValueError as bad:
            emit(f"   REFUSING recovery: {bad}")
            return False
        absolute, expected, blob = os.path.join(WORKTREE, rel), entry["sha256"], entry["blob"]
        if not os.path.exists(absolute):
            emit(f"   CANNOT RECOVER: {rel} is missing entirely. Refusing to guess.")
            return False
        actual = hashlib.sha256(io.open(absolute, encoding="utf-8").read().encode("utf-8")).hexdigest()
        if actual == expected:
            continue
        owns_drift = rel == mutated_path and expected_mutant is not None and actual == expected_mutant
        if not owns_drift:
            emit(f"   HARNESS_RECOVERY_CONFLICT on {rel}")
            emit(f"      on disk        : {actual}")
            emit(f"      before-image   : {expected}")
            emit(f"      expected mutant: {expected_mutant or '(none recorded)'}")
            emit("      not this harness's bytes to overwrite. Nothing written, manifest kept.")
            return False
        if not os.path.exists(blob):
            emit(f"   CANNOT RECOVER {rel}: before-image blob missing. Refusing to guess.")
            return False
        io.open(absolute, "w", encoding="utf-8", newline="\n").write(
            io.open(blob, encoding="utf-8").read()
        )
        written = hashlib.sha256(io.open(absolute, encoding="utf-8").read().encode("utf-8")).hexdigest()
        if written != expected:
            emit(f"   RECOVERY FAILED for {rel}: restored bytes do not match the recorded hash.")
            return False
        restored.append(rel)

    emit(f"   restored: {', '.join(restored)}" if restored
         else "   owned files already matched the before-image")
    now = owned_worktree_dirt([e["path"] for e in manifest.get("entries", [])])
    if now != manifest.get("git_status_before", ""):
        emit("   OWNED FINGERPRINT STILL DIFFERS after recovery - refusing to start:")
        emit(f"      recorded: {manifest.get('git_status_before') or '(clean)'}")
        emit(f"      now     : {now or '(clean)'}")
        return False
    os.remove(MANIFEST)
    emit("   recovery verified")
    return True


RUN_STARTED_LINE = re.compile(r"^RUN_STARTED ([0-9a-f]{12}) ")
RUN_COMPLETED_LINE = re.compile(r"^RUN_COMPLETED ([0-9a-f]{12})\s*$")
VERDICT_LINE = re.compile(r"^(ISOLATED|CAUGHT-BUT-BROAD|MISSED) +\[([0-9a-f]{12})\] (.+?)\s*$")


def verify_report(text):
    """Decide which verdict lines in a harness log are admissible as evidence.

    Aggregation does not happen inside the harness process. A `verdicts` list built and then
    filtered in the same function can only ever contain this run's ids, so filtering it proves
    nothing -- review called that out, correctly. The place a stale verdict actually gets counted is
    HERE: a log, read afterwards, by a session or a person totalling the lines they can see.

    That failure is not hypothetical in this project. A run stalled 59 minutes and its truncated log
    was indistinguishable from a short successful one, and a scrollback holding two runs looks like
    one longer run. So the rule is bracket-based, not id-based-in-memory:

      a verdict is admissible only if its own run id also appears on a RUN_COMPLETED line.

    An interrupted run emits RUN_STARTED and verdicts but never RUN_COMPLETED, so every verdict it
    produced is rejected -- including when its lines sit directly above a genuine run's.
    """
    started, completed, seen = set(), set(), []
    for line in text.splitlines():
        found = RUN_STARTED_LINE.match(line)
        if found:
            started.add(found.group(1))
            continue
        found = RUN_COMPLETED_LINE.match(line)
        if found:
            completed.add(found.group(1))
            continue
        found = VERDICT_LINE.match(line)
        if found:
            seen.append({"run_id": found.group(2), "verdict": found.group(1),
                         "label": found.group(3)})
    return {
        "admissible": [v for v in seen if v["run_id"] in completed],
        "rejected": [v for v in seen if v["run_id"] not in completed],
        "unbracketed_runs": sorted(started - completed),
    }


FILES_LINE = re.compile(r"Test Files\s+(.+?)\s*\(\d+\)")
TESTS_LINE = re.compile(r"Tests\s+(.+?)\s*\(\d+\)")


def _count(segments, name):
    found = re.search(r"(\d+) " + name, segments)
    return int(found.group(1)) if found else 0


class RunResult:
    def __init__(self, filesFailed, filesPassed, testsFailed, testsPassed, parsed):
        self.filesFailed, self.filesPassed = filesFailed, filesPassed
        self.testsFailed, self.testsPassed, self.parsed = testsFailed, testsPassed, parsed

    @property
    def total(self):
        return self.testsFailed + self.testsPassed

    @property
    def green(self):
        return self.parsed and self.filesFailed == 0 and self.testsFailed == 0

    def __str__(self):
        if not self.parsed:
            return "UNPARSEABLE (no summary line)"
        return (f"files {self.filesPassed} ok/{self.filesFailed} failed, "
                f"tests {self.testsPassed} ok/{self.testsFailed} failed")


def vitest_command(tests, timeout_ms):
    return "npx vitest run " + " ".join(tests) + f" --reporter=dot --testTimeout={timeout_ms}"


def run_tests(tests, timeout_ms=20000, wall_seconds=900, command=None, needs_db=True):
    """One discriminator invocation, database proven ready first AND bounded by wall clock.

    `command` is a seam for the harness's own self-tests, which need a child that genuinely hangs in
    order to prove the wall bound fires. Testing a timeout by asserting that the code contains a
    `timeout=` argument would prove nothing; the 59-minute stall happened in code that looked right.
    """
    if needs_db and not database_ready():
        return RunResult(0, 0, 0, 0, False)
    try:
        proc = subprocess.run(
            (command or vitest_command)(tests, timeout_ms),
            capture_output=True, shell=True, env=test_env(), cwd=WORKTREE, timeout=wall_seconds,
        )
    except subprocess.TimeoutExpired:
        emit(f"   INVOCATION EXCEEDED {wall_seconds}s WALL BOUND - INVALID, not MISSED")
        return RunResult(0, 0, 0, 0, False)
    out = (proc.stdout or b"").decode("utf-8", "replace") + (proc.stderr or b"").decode("utf-8", "replace")
    files, tests_m = FILES_LINE.search(out), TESTS_LINE.search(out)
    if not files or not tests_m:
        return RunResult(0, 0, 0, 0, False)
    return RunResult(_count(files.group(1), "failed"), _count(files.group(1), "passed"),
                     _count(tests_m.group(1), "failed"), _count(tests_m.group(1), "passed"), True)


def preflight_tree(originals, mutations):
    problems = []
    for label, path, old, new in mutations:
        text = originals[path]
        count = text.count(old)
        if count == 1:
            continue
        if count == 0 and new and new in text:
            problems.append(f"   CONTAMINATED  {label}: the mutant's replacement is already in {path}")
        else:
            problems.append(f"   ANCHOR DRIFT  {label}: matched {count} times in {path}")
    return problems


def harness(owned_paths, binding_tests, unrelated_tests, mutations, wall_seconds=900,
            command=None, needs_db=True):
    os.chdir(WORKTREE)
    owned = [owned_relpath(p) for p in owned_paths]

    # THE LOCK COMES FIRST, before recovery and before the before-image. Review found the ordering
    # defect and it is not theoretical: with recovery ahead of the lock, a second harness starting
    # while the first is mid-mutation would read the first's incomplete manifest, "recover" its
    # ACTIVE mutant, delete the manifest -- and only then discover the lock is held. The first run
    # would carry on measuring against bytes a stranger had restored underneath it, with its own
    # recovery record gone. Everything that inspects or writes shared state now happens inside the
    # lock.
    token = f"{os.getpid()}-{time.time_ns()}"
    if not acquire_lock(token):
        return 8

    originals, hashes = None, None
    try:
        return _run_locked(owned, binding_tests, unrelated_tests, mutations,
                           wall_seconds, command, needs_db, token)
    finally:
        release_lock(token)


def _run_locked(owned, binding_tests, unrelated_tests, mutations, wall_seconds, command,
                needs_db, token):
    if not startup_recovery():
        emit("HARNESS_INVALID: could not recover a previous interrupted run")
        return 5

    originals = {p: io.open(os.path.join(WORKTREE, p), encoding="utf-8").read() for p in owned}
    hashes = {p: hashlib.sha256(t.encode("utf-8")).hexdigest() for p, t in originals.items()}
    run_id = hashlib.sha256(f"{os.getpid()}|{owned}|{len(mutations)}|{time.time()}".encode()).hexdigest()[:12]

    problems = preflight_tree(originals, mutations)
    if problems:
        emit("REFUSING TO RUN - the tree is not the one these mutations were written against:")
        for problem in problems:
            emit(problem)
        return 3

    def write(path, text):
        io.open(os.path.join(WORKTREE, path), "w", encoding="utf-8", newline="\n").write(text)

    def restore():
        for path, text in originals.items():
            write(path, text)
            back = io.open(os.path.join(WORKTREE, path), encoding="utf-8").read()
            if hashlib.sha256(back.encode("utf-8")).hexdigest() != hashes[path]:
                return False
        return True

    # Ordering inside the lock: before-image -> hashes -> payloads -> atomic manifest ->
    # RUN_STARTED -> only then the first mutant. A death between any two leaves enough to recover.
    snapshot_owned(originals, run_id)
    baseline_dirt = owned_worktree_dirt(owned)
    emit(f"RUN_STARTED {run_id} pid={os.getpid()} mutations={len(mutations)}")
    if baseline_dirt:
        emit(f"   pre-existing owned dirt (must persist unchanged):\n{baseline_dirt}")

    isolated, invalid, verdicts = 0, 0, []
    try:
        b0 = run_tests(binding_tests, wall_seconds=wall_seconds, command=command, needs_db=needs_db)
        u0 = run_tests(unrelated_tests, wall_seconds=wall_seconds, command=command, needs_db=needs_db)
        emit(f"baseline binding   : {b0}")
        emit(f"baseline unrelated : {u0}")
        if not b0.green or not u0.green:
            emit("INVALID_BASELINE - no mutation was executed and none is reported")
            return 2
        emit(f"pinned denominators: binding {b0.total}, unrelated {u0.total}")

        for index, (label, path, old, new) in enumerate(mutations):
            manifest = json.loads(io.open(MANIFEST, encoding="utf-8").read())

            # Record WHAT WILL BE WRITTEN, before writing it. Without this there is a crash window
            # in which a mutant sits on disk and nothing records which mutant it is -- and recovery
            # then cannot tell its own drift from a stranger's, so it must refuse bytes it actually
            # owned. Preparing first turns that window into a recoverable state.
            mutated = originals[path].replace(old, new)
            manifest["current_mutation"] = label
            manifest["mutated_path"] = path
            manifest["before_sha256"] = hashes[path]
            manifest["expected_mutant_sha256"] = hashlib.sha256(mutated.encode("utf-8")).hexdigest()
            manifest["phase"] = "MUTATION_PREPARED"
            _publish(manifest)

            write(path, mutated)
            # The mutant must actually be on disk. A replacement that silently no-ops would score
            # MISSED and mean nothing at all.
            on_disk = io.open(os.path.join(WORKTREE, path), encoding="utf-8").read()
            if hashlib.sha256(on_disk.encode("utf-8")).hexdigest() != manifest["expected_mutant_sha256"]:
                emit(f"HARNESS_INVALID: {label} did not write cleanly")
                return 6
            manifest["phase"] = "MUTATION_ACTIVE"
            _publish(manifest)

            if CRASH_AFTER_MUTATION is not None and str(index) == CRASH_AFTER_MUTATION:
                emit(f"SELFTEST: dying after writing {label}, bypassing finally via os._exit")
                sys.stdout.flush()
                os._exit(9)

            try:
                binding = run_tests(binding_tests, wall_seconds=wall_seconds, command=command, needs_db=needs_db)
                unrelated = run_tests(unrelated_tests, wall_seconds=wall_seconds, command=command, needs_db=needs_db)
            finally:
                if not restore():
                    emit(f"HARNESS_INVALID: restore verification failed after {label}")
                    return 4

            dirt = owned_worktree_dirt(owned)
            if dirt != baseline_dirt:
                emit(f"HARNESS_INVALID: owned fingerprint drifted after {label}")
                emit(f"   before: {baseline_dirt or '(clean)'}")
                emit(f"   after : {dirt or '(clean)'}")
                return 4

            if binding.total != b0.total or unrelated.total != u0.total:
                emit(f"INVALID_ENVIRONMENT for {label}: {binding} / {unrelated}")
                invalid += 1
                continue

            caught, clean = binding.testsFailed > 0, unrelated.green
            verdict = "ISOLATED" if caught and clean else ("CAUGHT-BUT-BROAD" if caught else "MISSED")
            isolated += 1 if caught and clean else 0
            verdicts.append({"run_id": run_id, "verdict": verdict, "label": label})
            # The run id goes in the LINE, not only in memory. Aggregation happens outside this
            # process, when the log is read; `verify_report` is the checker for that path.
            emit(f"{verdict:<16} [{run_id}] {label}")
            emit(f"                 binding: {binding}   unrelated: {unrelated}")
    finally:
        # Clearing the manifest belongs HERE, not after the try, and the self-test found that the
        # hard way: an early return (INVALID_BASELINE, drift, a failed write) skipped the tail and
        # left the manifest behind, so the NEXT run announced PREVIOUS_RUN_INTERRUPTED about a run
        # that had restored itself perfectly well. A recovery signal that cries wolf is worse than
        # none, because the one time it means something it will be believed out of habit rather
        # than on evidence.
        #
        # The condition is the restore, not the exit path. If the tree is verified back to its
        # before-image there is nothing left to recover, whatever the verdict was. If the restore
        # FAILED the manifest must survive, because then the next run genuinely does have work to do.
        if restore():
            if os.path.exists(MANIFEST):
                os.remove(MANIFEST)
        else:
            emit("RESTORE FAILED - recovery manifest and lock KEPT for the next invocation")

    # There was a `foreign = [v for v in verdicts if v["run_id"] != run_id]` check here and review
    # was right to call it vacuous: `verdicts` is local, appended to in one place, with a literal
    # `run_id` -- no value could ever fail it. It read like a safeguard while guarding nothing, and
    # a control that watched it pass would have certified the absence of a defect it could not see.
    # The real cross-run contamination happens in the log, so the check lives in `verify_report`.

    if os.path.exists(MANIFEST):
        os.remove(MANIFEST)
    emit(f"\n{isolated} of {len(mutations)} mutations caught in isolation")
    if invalid:
        emit(f"{invalid} mutation(s) NOT SCORED - the environment was not trustworthy for them")
    emit(f"RUN_COMPLETED {run_id}")
    return 0 if isolated == len(mutations) and invalid == 0 else 1
