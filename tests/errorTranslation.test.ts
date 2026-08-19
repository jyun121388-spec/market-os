import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Infrastructure errors must not cross the server-action boundary.
 *
 * The `CONCURRENCY` cluster has produced the same shape three times — a unique constraint doing its
 * job, and the loser of the race receiving a raw Prisma `P2002` instead of a handled outcome.
 * CC-03 was the watchlist, CC-04 the revision chain, IR-036 the signup. Three instances is the
 * threshold this project uses for an enumeration rather than another one-off fix.
 *
 * The enumeration, and what it found:
 *
 * | boundary                      | constrained write | translated                     |
 * | ----------------------------- | ----------------- | ------------------------------ |
 * | `addWatchlistItemAction`      | yes (`@@unique`)  | yes — P2002 caught in the domain |
 * | `removeWatchlistItemAction`   | no (`deleteMany`) | nothing to translate            |
 * | `signUpAction`                | yes (`email @unique`) | **no — IR-036, deferred**   |
 * | `signInAction`                | no                | nothing to translate            |
 *
 * One open instance, already recorded, and everything else handled. That is a closed class rather
 * than a quiet one, and the difference is only visible because the enumeration was written down.
 *
 * What this file guards is the shape, not the four cases: a new server action performing a
 * constrained write with no translation would rejoin the cluster, and nothing else would notice.
 */

const ACTIONS_DIR = join(process.cwd(), "src/server/actions");
const read = (path: string) => readFileSync(path, "utf8");

const actionFiles = readdirSync(ACTIONS_DIR)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => ({ name, source: read(join(ACTIONS_DIR, name)) }));

describe("the server-action boundary", () => {
  it("has actions to check, so a green result means something", () => {
    expect(actionFiles.length).toBeGreaterThan(0);
    const exported = actionFiles.flatMap((f) => f.source.match(/^export async function/gm) ?? []);
    expect(exported.length).toBeGreaterThanOrEqual(6);
  });

  /**
   * Every `"use server"` export is a network-reachable endpoint whether or not a page calls it, so
   * an unhandled infrastructure error there is a 500 for a user who did nothing unusual.
   */
  it("translates or cannot produce a constraint violation, in every action file", () => {
    for (const { name, source } of actionFiles) {
      const writesDirectly = /prisma\.\w+\.(create|upsert|update)\(/.test(source);
      if (!writesDirectly) continue;
      expect(
        /catch/.test(source),
        `${name} writes through Prisma directly and never catches — a constraint violation would ` +
          "reach the caller as a database error",
      ).toBe(true);
    }
  });

  it("keeps the watchlist's P2002 translation where the write is", () => {
    // CC-03. The upsert is only atomic when Prisma can compile it to a single statement, so the
    // catch is load-bearing rather than defensive padding — and the comment at the call site says
    // exactly that, which is why this asserts the code rather than the comment.
    const watchlist = read(join(process.cwd(), "src/server/domain/watchlist.ts"));
    expect(watchlist).toContain('err.code === "P2002"');
  });

  it("cannot produce a constraint violation on the remove path", () => {
    // `deleteMany` against a non-unique filter has no constraint to violate, which is why this
    // path needs no translation. Recorded so a later change to `delete` is visibly a change in
    // kind rather than a tidy-up.
    const watchlist = read(join(process.cwd(), "src/server/domain/watchlist.ts"));
    const remove = watchlist.slice(watchlist.indexOf("export async function removeWatchlistItem"));
    expect(remove).toContain("deleteMany");
  });

  /**
   * IR-036, asserted as it currently behaves so that fixing it breaks this test — the same
   * self-correcting pin used for IR-033 and IR-037.
   */
  it("still lets a signup race through untranslated (IR-036, deferred)", () => {
    const auth = read(join(process.cwd(), "src/server/domain/auth.ts"));
    const signUp = auth.slice(auth.indexOf("export async function signUp"));
    const body = signUp.slice(0, signUp.indexOf("export async function signIn"));
    expect(body).toContain("user.create");
    expect(body, "IR-036 has been fixed — invert this and drop it from REVIEW_DEBT").not.toContain(
      "P2002",
    );
  });
});
