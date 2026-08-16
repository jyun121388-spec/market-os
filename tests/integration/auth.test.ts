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

  beforeAll(async () => {
    ({ prisma } = await import("@/server/db/client"));
    ({ signUp, signIn, createSession, validateSession, destroySession, AuthError } =
      await import("@/server/domain/auth"));

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
});
