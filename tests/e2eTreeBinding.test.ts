import { createServer } from "node:http";
import { beforeAll, describe, expect, it } from "vitest";
import {
  discoverListener,
  observationsAgree,
  selectSoleOwner,
} from "../scripts/listener-discovery";
import { checkTreeBinding, compareStartToSource, formatBinding } from "../scripts/e2e-tree-binding";

/**
 * SR-02's binding check, held to what it is allowed to claim.
 *
 * The incident was an E2E pass reported from a server started before the fix under test. The
 * existing mitigation is an overridable port, which avoids the collision without checking anything.
 * These tests pin the three verdicts and, just as importantly, pin the module's refusal to call a
 * run evidence when it cannot establish the binding.
 */

const at = (iso: string) => new Date(iso);

/**
 * A listener that started just now — later than every source write in this checkout.
 *
 * Injected rather than discovered, because discovery is Windows-only and CI runs on Linux. That is
 * how CI failed the first time: three controls asserted verdicts a Linux runner can never reach,
 * since `Get-NetTCPConnection` has no equivalent there and every verdict collapses to UNPROVEN.
 *
 * Skipping them on Linux would have deleted the controls in the environment that gates merges.
 * Injecting separates the two questions instead: DISCOVERY stays platform-specific and is not
 * claimed to work where it does not, while the DECISION — start order, served identity, what
 * counts as BOUND — is proven everywhere.
 */
const lateStart = () => ({
  pid: process.pid,
  exe: process.execPath,
  commandLine: "synthetic listener for a decision-logic control",
  started: new Date(),
});

describe("comparing server start time against the newest source write", () => {
  /**
   * The discriminating pair, reproduced by hand before this test existed: a stub listener on 3000
   * read BOUND, then `touch`ing one file under `src/` flipped the SAME process to STALE with
   * nothing else changed. That is SR-02's incident shape exactly, and it is the case the whole
   * module exists for.
   */
  it("calls a process STALE when it started before a source file was written", () => {
    const decided = compareStartToSource(at("2026-09-01T07:01:29.990Z"), {
      file: "src/server/fabric/providerCapability.ts",
      mtime: at("2026-09-01T07:01:54.037Z"),
    });
    expect(decided.verdict).toBe("STALE");
    expect(decided.reason).toContain("BEFORE");
    expect(decided.reason).toContain("providerCapability.ts");
  });

  /**
   * Starting after every source write is COMPATIBLE and proves nothing about identity.
   *
   * Review caught the first version returning BOUND here, which turned a one-way stale
   * discriminator into a two-way identity proof: a sibling checkout's server started a minute ago
   * satisfies this ordering while serving another tree. The verdict has to say "compatible", and
   * the strict gate has to refuse it.
   */
  it("calls a later start COMPATIBLE, never BOUND, because order is not identity", () => {
    const decided = compareStartToSource(at("2026-09-01T07:01:54.038Z"), {
      file: "src/server/fabric/providerCapability.ts",
      mtime: at("2026-09-01T07:01:54.037Z"),
    });
    expect(decided.verdict).toBe("START_ORDER_COMPATIBLE");
    expect(decided.verdict).not.toBe("BOUND");
    expect(decided.reason).toContain("identifies nothing");
  });

  it("never returns BOUND from timestamps alone, whatever the ordering", () => {
    // The invariant behind the previous test, stated over the whole function rather than one case:
    // this comparison has no access to identity, so BOUND is not in its range at all.
    for (const [started, mtime] of [
      ["2026-01-01T00:00:00Z", "2025-01-01T00:00:00Z"],
      ["2025-01-01T00:00:00Z", "2026-01-01T00:00:00Z"],
      ["2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"],
    ] as const) {
      expect(
        compareStartToSource(at(started), { file: "src/x.ts", mtime: at(mtime) }).verdict,
      ).not.toBe("BOUND");
    }
  });

  /**
   * A millisecond apart in the other direction is still STALE. The comparison is an ordering, not
   * a tolerance: a window inside which "close enough" counts as fresh would be the same guess the
   * overridable port already was.
   */
  it("has no grace window", () => {
    const decided = compareStartToSource(at("2026-09-01T07:01:54.036Z"), {
      file: "src/x.ts",
      mtime: at("2026-09-01T07:01:54.037Z"),
    });
    expect(decided.verdict).toBe("STALE");
  });

  it("is UNPROVEN, never BOUND, when either side is missing", () => {
    expect(
      compareStartToSource(null, { file: "src/x.ts", mtime: at("2026-01-01T00:00:00Z") }).verdict,
    ).toBe("UNPROVEN");
    expect(compareStartToSource(at("2026-01-01T00:00:00Z"), null).verdict).toBe("UNPROVEN");
  });
});

describe("what the report is allowed to imply", () => {
  /**
   * Port 1 is a privileged port nothing in this project listens on, so there is no process to
   * identify and the verdict must be UNPROVEN rather than a pass by absence. "Nobody answered" is
   * the least informative possible state, and it is exactly where a checker is most tempted to
   * shrug and continue.
   */
  let binding: Awaited<ReturnType<typeof checkTreeBinding>>;
  beforeAll(async () => {
    binding = await checkTreeBinding("http://localhost:1");
  });

  it("treats an unidentifiable listener as UNPROVEN rather than fine", () => {
    expect(binding.verdict).toBe("UNPROVEN");
  });

  it("records what it observed even when nothing was decided by it", () => {
    // The observations are the point of the report: a reader who disagrees with the verdict can
    // still see the inputs. `headSha` and the newest source file come from the real repository.
    expect(binding.observed.url).toBe("http://localhost:1");
    expect(binding.observed.port).toBe(1);
    expect(binding.observed.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(binding.observed.newestSourceFile).toBeTruthy();
    expect(binding.observed.listenerPid).toBeNull();
  });

  /**
   * The limitations are load-bearing prose, not decoration. Each names a thing that was MEASURED
   * to be unavailable on this machine, and dropping one would let the report read as a stronger
   * claim than the code can support.
   */
  it("states the limits of the binding, including the shared node_modules finding", () => {
    expect(binding.limitations.length).toBeGreaterThanOrEqual(3);
    expect(binding.limitations.join(" ")).toContain("node_modules");
    expect(binding.limitations.join(" ")).toContain("recompiles");
    // The platform limit has to be DECLARED, and its wording has to track what the code actually
    // does. It once said Windows-only and "gates nothing there today", which was true and made the
    // check inert where merges are gated; Linux discovery closed that, and this assertion moved
    // with it rather than being left to describe a state that no longer exists.
    expect(binding.limitations.join(" ")).toContain("Windows and Linux only");
    expect(binding.limitations.join(" ")).toContain("socket-ownership");
    // The fail-closed conditions must stay named: unreadable, ambiguous, or changing mid-observation.
    expect(binding.limitations.join(" ")).toContain("ambiguous");
  });

  it("says outright that a non-BOUND run is not evidence about the tree", () => {
    const text = formatBinding(binding);
    expect(text).toContain("NOT evidence about the current tree");
    expect(text).toContain("UNPROVEN");
  });

  it("does not print that disclaimer when the binding actually holds", () => {
    // Guards against the disclaimer becoming boilerplate that appears on every run and therefore
    // stops being read.
    const bound = formatBinding({
      verdict: "BOUND",
      reason: "test",
      observed: { ...binding.observed },
      limitations: binding.limitations,
    });
    expect(bound).not.toContain("NOT evidence about the current tree");
  });
});

/**
 * The counterexample the whole rework exists for: a FOREIGN listener that starts late.
 *
 * It is started now, so it is later than every source write in this checkout — the exact condition
 * the first version accepted as BOUND. It is not this application, serves no build id, and would
 * have satisfied the strict gate while answering for something else entirely.
 */
describe("a foreign server that starts after this tree's newest write", () => {
  let port = 0;
  const server = createServer((_req, res) => {
    // Answers 404 to everything, including the build-id path. A foreign server that happened to
    // answer 200 to ANY path must still not be mistaken for this build.
    res.statusCode = 404;
    res.end("not this application");
  });

  beforeAll(
    () =>
      new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          port = typeof address === "object" && address ? address.port : 0;
          resolve();
        });
      }),
  );

  it("is refused rather than BOUND, because start order is not identity", async () => {
    const binding = await checkTreeBinding(`http://127.0.0.1:${port}`, lateStart());
    expect(binding.verdict).not.toBe("BOUND");
    expect(binding.verdict).toBe("START_ORDER_COMPATIBLE");
    expect(binding.observed.listenerPid).toBeGreaterThan(0);
    expect(binding.observed.servesLocalBuildId).not.toBe(true);
  });

  it("prints the not-evidence disclaimer for it", async () => {
    const binding = await checkTreeBinding(`http://127.0.0.1:${port}`, lateStart());
    expect(formatBinding(binding)).toContain("NOT evidence about the current tree");
  });

  it("closes the listener afterwards", async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(server.listening).toBe(false);
  });
});

/**
 * The positive counterpart, and the reason it exists is a near miss.
 *
 * An earlier attempt at this rework left `servesLocalBuild` DEFINED BUT NEVER CALLED — the call
 * site failed to apply and nothing failed, because every test at the time only asserted that BOUND
 * was NOT returned. `BOUND` was unreachable and the suite was green. Lint caught it, not the tests.
 *
 * So this serves the real build-id path from a stub and requires BOUND. If the identity check ever
 * goes dead again, this is what goes red.
 */
describe("a listener that serves this checkout's build id", () => {
  // A synthetic id passed through the override, NOT the real `.next/BUILD_ID`. CI runs this suite
  // without building, so reading that file made the whole test file throw ENOENT — and skipping
  // when it is absent would delete this control in the one environment that matters. What needs
  // proving is the identity comparison, not that readFileSync works.
  const buildId = "TEST-BUILD-ID-abc123";
  let port = 0;
  const server = createServer((req, res) => {
    if (req.url === `/_next/static/${buildId}/_buildManifest.js`) {
      res.statusCode = 200;
      res.end("self.__BUILD_MANIFEST = {};");
      return;
    }
    res.statusCode = 404;
    res.end("no");
  });

  beforeAll(
    () =>
      new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          port = typeof address === "object" && address ? address.port : 0;
          resolve();
        });
      }),
  );

  it("is BOUND, and says which build id proved it", async () => {
    const binding = await checkTreeBinding(`http://127.0.0.1:${port}`, lateStart(), buildId);
    expect(binding.verdict).toBe("BOUND");
    expect(binding.observed.servesLocalBuildId).toBe(true);
    expect(binding.reason).toContain(buildId);
  });

  it("drops the not-evidence disclaimer only in this state", async () => {
    const binding = await checkTreeBinding(`http://127.0.0.1:${port}`, lateStart(), buildId);
    expect(formatBinding(binding)).not.toContain("NOT evidence about the current tree");
  });

  it("closes the listener afterwards", async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(server.listening).toBe(false);
  });
});

/**
 * REAL discovery, with no override, against a listener this test owns.
 *
 * This is the control the platform gap needed. It runs the production path on whatever platform it
 * is executing on — `Get-NetTCPConnection` on Windows, `/proc/net/tcp` inode to `/proc/<pid>/fd` on
 * Linux — so neither implementation can rot unnoticed and neither is skipped anywhere. The listener
 * is created in THIS process, so the owner is known independently: the answer must be `process.pid`
 * and nothing else.
 *
 * Note what makes that assertion strong. Many `node` processes exist while the suite runs, and
 * several share an image path and a `node_modules`. Selecting by name, image or age would pick one
 * of them; only socket ownership picks this one.
 */
describe("socket-owner discovery, running the production path", () => {
  let port = 0;
  const server = createServer((_req, res) => {
    res.statusCode = 404;
    res.end("owned by this test");
  });

  beforeAll(
    () =>
      new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          port = typeof address === "object" && address ? address.port : 0;
          resolve();
        });
      }),
  );

  // 30s, because these are the only tests here that touch real OS tooling. On Windows each
  // discovery spawns PowerShell TWICE -- the race recheck -- and under full-suite load that
  // exceeds the 5s default. The cost is a property of the platform, not a flake, so it is declared
  // rather than absorbed by loosening the default for everything.
  it("finds the process that actually owns the socket", { timeout: 30_000 }, () => {
    const found = discoverListener(port);
    expect(found, "no listener discovered for a socket this process owns").not.toBeNull();
    expect(found?.pid).toBe(process.pid);
    // The authority is printed so a reader can judge the evidence rather than trust the verdict.
    expect(found?.authority).toContain("socket owner");
    expect(found?.identityToken.length).toBeGreaterThan(0);
  });

  it(
    "reaches the binding decision through real discovery, with no injected listener",
    { timeout: 30_000 },
    async () => {
      // No `listenerOverride`. A late-starting foreign-shaped listener serving 404 must be
      // COMPATIBLE and never BOUND -- the same claim as the injected control, now proven end to end.
      const binding = await checkTreeBinding(`http://127.0.0.1:${port}`);
      expect(binding.observed.listenerPid).toBe(process.pid);
      expect(binding.verdict).not.toBe("BOUND");
      expect(binding.verdict).toBe("START_ORDER_COMPATIBLE");
    },
  );

  it("fails closed on a port nothing is listening on", { timeout: 30_000 }, () => {
    // Port 1 is privileged and unused here. Absence must be null, never a nearby process.
    expect(discoverListener(1)).toBeNull();
  });

  it("fails closed on a port number that cannot be a port", { timeout: 30_000 }, () => {
    for (const bad of [0, -1, 70000, 1.5, Number.NaN]) {
      expect(discoverListener(bad), `port ${bad}`).toBeNull();
    }
  });

  it("closes the listener afterwards", { timeout: 30_000 }, async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(server.listening).toBe(false);
    // And discovery must stop finding it, which also proves the earlier positive was about THIS
    // socket rather than anything ambient on the machine.
    expect(discoverListener(port)).toBeNull();
  });
});

/**
 * The owner-cardinality rule, exercised without pretending a Linux runner is Windows.
 *
 * Windows enumerated LISTEN rows and took `Select-Object -First 1`; Linux collected owners and
 * required exactly one. Same invariant, enforced on one platform and not the other — review called
 * it a same-mechanism soundness defect and was right. The rule now lives in one exported function
 * that BOTH discovery paths call, so these controls bind the Windows decision on any platform.
 */
describe("who owns the socket, when more than one row says something", () => {
  it("accepts several rows that all name the same process", () => {
    // Normal and not ambiguous: separate v4 and v6 listeners are two rows and one process.
    expect(selectSoleOwner([4242, 4242, 4242])).toBe(4242);
    expect(selectSoleOwner([4242])).toBe(4242);
  });

  it("refuses two distinct owners rather than picking one", () => {
    // SO_REUSEPORT, or a handoff in progress. "One of these two" is not an identification, and
    // row order is not authority — which is exactly what the removed `-First 1` made it.
    expect(selectSoleOwner([4242, 99])).toBeNull();
    expect(selectSoleOwner([99, 4242])).toBeNull();
  });

  it("refuses when there is nothing to identify", () => {
    expect(selectSoleOwner([])).toBeNull();
  });

  /**
   * A row it could not read must poison the tally, not be dropped from it.
   *
   * Silently discarding an unparseable row is how an ambiguous port comes to look unique: two
   * owners, one unreadable, and the survivor is returned as if it were the only one.
   */
  it("refuses on an unparseable owner instead of ignoring that row", () => {
    expect(selectSoleOwner([4242, Number.NaN])).toBeNull();
    expect(selectSoleOwner([4242, 0])).toBeNull();
    expect(selectSoleOwner([4242, -1])).toBeNull();
    expect(selectSoleOwner([4242, 1.5])).toBeNull();
  });
});

describe("whether two observations describe the same process instance", () => {
  const a = { pid: 4242, identityToken: "88123456" };

  it("agrees only when the pid AND the start token both match", () => {
    expect(observationsAgree(a, { ...a })).toBe(true);
    // Same PID, different start token: the PID was reused between observations.
    expect(observationsAgree(a, { pid: 4242, identityToken: "99999999" })).toBe(false);
    // Same token, different PID: not the same process, whatever the coincidence.
    expect(observationsAgree(a, { pid: 77, identityToken: "88123456" })).toBe(false);
  });

  it("never agrees when either observation is missing", () => {
    expect(observationsAgree(a, null)).toBe(false);
    expect(observationsAgree(null, a)).toBe(false);
    expect(observationsAgree(null, null)).toBe(false);
  });
});
