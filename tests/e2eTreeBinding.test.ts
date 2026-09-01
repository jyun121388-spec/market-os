import { createServer } from "node:http";
import { beforeAll, describe, expect, it } from "vitest";
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
    // The platform limit has to be DECLARED, because it is the one that makes the check inert
    // where merges are gated. Discovery is Windows-only; CI is Linux; every verdict there is
    // UNPROVEN. Saying so in the report is the difference between a known gap and a silent one.
    expect(binding.limitations.join(" ")).toContain("Windows-only");
    expect(binding.limitations.join(" ")).toContain("gates nothing there today");
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
