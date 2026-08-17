import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { prisma as PrismaClientInstance } from "@/server/db/client";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TEST_EMAIL = "test-auth-user@example.com";

describeIfDb("auth (integration)", () => {
  let prisma: typeof PrismaClientInstance;
  let signUp: typeof import("@/server/domain/auth").signUp;
  let signIn: typeof import("@/server/domain/auth").signIn;
  let createSession: typeof import("@/server/domain/auth").createSession;
  let validateSession: typeof import("@/server/domain/auth").validateSession;
  let destroySession: typeof import("@/server/domain/auth").destroySession;
  let AuthError: typeof import("@/server/domain/auth").AuthError;
  let resetLoginAttemptTracking: typeof import("@/server/domain/auth").resetLoginAttemptTracking;

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({
      signUp,
      signIn,
      createSession,
      validateSession,
      destroySession,
      AuthError,
      resetLoginAttemptTracking,
    } = await import("@/server/domain/auth"));

    const existing = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
    if (existing) {
      await prisma.session.deleteMany({ where: { userId: existing.id } });
      await prisma.watchlistItem.deleteMany({ where: { userId: existing.id } });
      await prisma.user.delete({ where: { id: existing.id } });
    }
  });

  afterAll(async () => {
    const user = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
    if (user) {
      await prisma.session.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
    await prisma.$disconnect();
  });

  it("signs up a new user with a normalized (lowercased/trimmed) email, defaulting to the FREE plan", async () => {
    const user = await signUp(`  ${TEST_EMAIL.toUpperCase()}  `, "correct-horse-battery-staple");
    expect(user.email).toBe(TEST_EMAIL);
    expect(user.passwordHash).not.toContain("correct-horse-battery-staple");
    expect(user.plan).toBe("FREE");
  });

  it("rejects a duplicate signup for the same email", async () => {
    await expect(signUp(TEST_EMAIL, "another-password-123")).rejects.toThrow(AuthError);
  });

  it("rejects a too-short password at signup", async () => {
    await expect(signUp("someone-else@example.com", "short")).rejects.toThrow(AuthError);
  });

  it("rejects an invalid email at signup", async () => {
    await expect(signUp("not-an-email", "correct-horse-battery-staple")).rejects.toThrow(AuthError);
  });

  it("signs in with the correct password", async () => {
    const user = await signIn(TEST_EMAIL, "correct-horse-battery-staple");
    expect(user.email).toBe(TEST_EMAIL);
  });

  it("rejects sign-in with the wrong password, without revealing which part was wrong", async () => {
    await expect(signIn(TEST_EMAIL, "totally-wrong-password")).rejects.toThrow(
      "Invalid email or password",
    );
  });

  it("rejects sign-in for a nonexistent email with the SAME error message (no user enumeration)", async () => {
    await expect(signIn("nobody-here@example.com", "whatever-password")).rejects.toThrow(
      "Invalid email or password",
    );
  });

  it("creates a session and validates it back to the right user", async () => {
    const user = await signIn(TEST_EMAIL, "correct-horse-battery-staple");
    const session = await createSession(user.id);

    const validated = await validateSession(session.id);
    expect(validated?.id).toBe(user.id);
  });

  it("session token is a cryptographically random 64-char hex string, not a sequential/cuid id", async () => {
    const user = await signIn(TEST_EMAIL, "correct-horse-battery-staple");
    const session = await createSession(user.id);

    expect(session.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("locks out sign-in after repeated failed attempts, then allows the correct password again once reset", async () => {
    resetLoginAttemptTracking();
    for (let i = 0; i < 5; i += 1) {
      await expect(signIn(TEST_EMAIL, "wrong-password")).rejects.toThrow(
        "Invalid email or password",
      );
    }

    // 6th attempt is locked out even with the CORRECT password.
    await expect(signIn(TEST_EMAIL, "correct-horse-battery-staple")).rejects.toThrow(
      "Invalid email or password",
    );

    resetLoginAttemptTracking();
    const user = await signIn(TEST_EMAIL, "correct-horse-battery-staple");
    expect(user.email).toBe(TEST_EMAIL);
  });

  it("destroySession invalidates the token; a destroyed session no longer validates", async () => {
    const user = await signIn(TEST_EMAIL, "correct-horse-battery-staple");
    const session = await createSession(user.id);

    await destroySession(session.id);
    const validated = await validateSession(session.id);
    expect(validated).toBeNull();
  });

  it("validateSession returns null for a garbage token rather than throwing", async () => {
    const validated = await validateSession("not-a-real-session-token");
    expect(validated).toBeNull();
  });

  it("validateSession returns null for an expired session", async () => {
    const user = await signIn(TEST_EMAIL, "correct-horse-battery-staple");
    const expired = await prisma.session.create({
      data: { userId: user.id, expiresAt: new Date(Date.now() - 1000) },
    });

    const validated = await validateSession(expired.id);
    expect(validated).toBeNull();
  });

  it("H1: rejects sign-in for a legacy account (no real credentials) without attempting password verification, even with the sentinel value as the 'password'", async () => {
    const legacyEmail = "legacy+test-h1-legacy-user@market-os.invalid";
    const existing = await prisma.user.findUnique({ where: { email: legacyEmail } });
    if (existing) {
      await prisma.session.deleteMany({ where: { userId: existing.id } });
      await prisma.user.delete({ where: { id: existing.id } });
    }
    const legacyUser = await prisma.user.create({
      data: {
        email: legacyEmail,
        passwordHash: "LEGACY_ACCOUNT_NO_CREDENTIALS",
        isLegacyAccount: true,
      },
    });

    // A real password never validates against the sentinel...
    await expect(signIn(legacyEmail, "any-password-at-all")).rejects.toThrow(
      "Invalid email or password",
    );
    // ...and critically, passing the sentinel string ITSELF as the "password" must not somehow
    // be treated as valid — the isLegacyAccount check must short-circuit before verifyPassword
    // ever runs, since the sentinel is not a parseable scrypt record and must never be evaluated
    // as a real credential.
    await expect(signIn(legacyEmail, "LEGACY_ACCOUNT_NO_CREDENTIALS")).rejects.toThrow(
      "Invalid email or password",
    );

    await prisma.user.delete({ where: { id: legacyUser.id } });
  });

  it("never returns the password hash across the server boundary", async () => {
    // getCurrentUser is exported from a "use server" module, which makes it a reachable
    // endpoint whether or not a page calls it, and it returned alidateSession's result
    // verbatim - the full Prisma User row, passwordHash included. A stolen session cookie would
    // therefore also hand over an offline-crackable hash for a password the person probably reuses
    // elsewhere, turning session compromise into credential compromise.
    //
    // Callers only ever read user.id and user.email. Found by independent review
    // (`gpt-5.6-terra`), 2026-08-18.
    const signedIn = await signIn(TEST_EMAIL, "correct-horse-battery-staple");
    const session = await createSession(signedIn.id);
    const user = await validateSession(session.id);

    expect(user).not.toBeNull();
    expect(user!.id).toBe(signedIn.id);
    expect(user!.email).toBe(TEST_EMAIL);
    expect(user).not.toHaveProperty("passwordHash");
    // Pinned exactly. A future `include` that quietly widens this would otherwise reintroduce the
    // leak without any test noticing.
    expect(Object.keys(user!).sort()).toEqual(["email", "id"]);
  });
});
