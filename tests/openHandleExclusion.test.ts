import { describe, expect, it } from "vitest";
import { probe } from "../scripts/probe-open-handle-exclusion";

/**
 * IR-075 in `store.ts` recorded a residual race and NAMED the fix it would need: hold the lock file
 * open for the process lifetime, because "on Windows an open handle cannot be deleted or renamed by
 * another process".
 *
 * That was an assertion about the platform living in a comment, and the next attempt at IR-075
 * would have built a lock rewrite on top of it. Measured instead — and it is false for the handles
 * Node actually gives you. Win32 exclusion depends on the share mode, and `fs.openSync` offers no
 * way to choose one; libuv permits delete sharing.
 *
 * This control keeps the correction honest. It asserts the MEASURED behaviour, so if a future
 * runtime or platform ever does block the delete, it fails and sends the reader back to IR-075 —
 * which would then be good news rather than a regression.
 */
describe("IR-075: whether an open handle excludes another process", () => {
  const result = probe();

  it("does not stop another process unlinking the file", () => {
    const unlink = result.attempts.find((a) => a.attempt.startsWith("unlink"));
    expect(unlink, "the probe must actually attempt the unlink").toBeDefined();
    expect(
      unlink?.blocked,
      "an open handle now BLOCKS deletion here — IR-075's original fix may be viable after all, " +
        "so re-read the residual in store.ts before treating this as a failure",
    ).toBe(false);
  });

  it("does not stop another process creating a new file at the same path", () => {
    // The sharper half. Even the exclusive-create primitive this store relies on is available to a
    // competitor while the handle is held, so holding it buys nothing at all.
    const created = result.attempts.find((a) => a.attempt.startsWith("exclusive create"));
    expect(created?.blocked).toBe(false);
  });

  it("attempted every operation the claim was about", () => {
    // Vacuity guard: an empty or short list would make both assertions above pass by finding
    // nothing to check.
    expect(result.attempts.map((a) => a.attempt)).toEqual([
      "unlink from another process",
      "rename from another process",
      "exclusive create over it",
    ]);
  });
});
