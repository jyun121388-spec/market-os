import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

/**
 * Two people signing up with the same address at the same time.
 *
 * From the `CONCURRENCY` countermeasure: list every place that reads a row, decides something, and
 * writes based on the decision — each is either transactional, constraint-protected, or an instance
 * waiting to happen. `signUp` reads `user.findUnique({ email })`, decides the address is
 * free, and creates. `User.email` is `@unique`, so the database will not produce two accounts.
 *
 * The question this test asks is the one CC-03 asked of the watchlist and CC-04 of the revision
 * chain: does the loser of that race get a HANDLED outcome, or a raw `P2002` from Prisma? The
 * difference is a form saying "an account with this email already exists" versus a 500, on the
 * signup page, for a user who did nothing unusual.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const EMAIL = "signup-race@example.com";

describeIfDb("concurrent signup with one email (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let signUp: typeof import("@/server/domain/auth").signUp;
  let AuthError: typeof import("@/server/domain/auth").AuthError;

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ signUp, AuthError } = await import("@/server/domain/auth"));
    await prisma.session.deleteMany({ where: { user: { email: EMAIL } } });
    await prisma.user.deleteMany({ where: { email: EMAIL } });
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { user: { email: EMAIL } } });
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await prisma.$disconnect();
  });

  it("creates exactly one account and tells the loser what happened", async () => {
    const attempts = await Promise.allSettled([
      signUp(EMAIL, "correct-horse-battery-staple"),
      signUp(EMAIL, "correct-horse-battery-staple"),
      signUp(EMAIL, "correct-horse-battery-staple"),
    ]);

    const created = await prisma.user.count({ where: { email: EMAIL } });
    expect(created, "the unique index must hold regardless").toBe(1);

    const rejected = attempts.filter((a) => a.status === "rejected");
    expect(rejected.length, "two of three must lose the race").toBe(2);

    /**
     * DEFERRED BY THE FREEZE (IR-036, P2). Asserted as it currently behaves, not as it should.
     *
     * A losing signup is an ordinary, expected outcome — the address is taken — and it should
     * arrive as the same `AuthError` the sequential path produces. It arrives as a raw Prisma
     * `P2002` instead, which on the signup form is a 500 for a user who did nothing unusual.
     *
     * Not fixed here: nothing is corrupted, the constraint held, and v1 is frozen except for
     * reproduced P0/P1. Recorded in `docs/REVIEW_DEBT.md` with the two-line fix.
     *
     * This assertion is deliberately the wrong way round so that FIXING it breaks this test. A
     * known gap asserted as correct behaviour is how a defect becomes a specification.
     */
    for (const attempt of rejected) {
      const reason = (attempt as PromiseRejectedResult).reason;
      expect(reason, "IR-036 has been fixed — invert this assertion").not.toBeInstanceOf(AuthError);
      expect(String(reason)).toContain("Unique constraint failed");
    }
  });

  it("still rejects a plain duplicate the same way", async () => {
    // The control: the sequential path must be unchanged, and must produce the identical error, or
    // the handler has quietly become two different behaviours for one situation.
    await expect(signUp(EMAIL, "correct-horse-battery-staple")).rejects.toThrow(/already exists/);
  });
});
