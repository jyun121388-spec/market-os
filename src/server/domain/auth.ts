import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { prisma } from "@/server/db/client";

/**
 * Auth (docs/ROADMAP.md M22). From-scratch email+password, not a third-party library — see
 * docs/DECISIONS.md for why. Password hashing uses Node's built-in `crypto.scrypt` (no new
 * dependency, a recommended KDF) rather than a custom hash. Sessions are opaque bearer tokens
 * stored server-side (the Session row's id IS the token) — validity is a DB lookup, not a
 * signature check, so no signing secret is needed and revocation is just deleting the row.
 * Uses the synchronous scryptSync (login/signup is a low-volume path, and it sidesteps a
 * TypeScript overload-resolution issue with the promisified callback form).
 */

const SCRYPT_N = 16384; // CPU/memory cost — 2^14, a reasonable interactive-login default
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export class AuthError extends Error {}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString("hex")}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [nStr, rStr, pStr, saltHex, hashHex] = stored.split(":");
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const derived = scryptSync(password, salt, expected.length, {
    N: Number(nStr),
    r: Number(rStr),
    p: Number(pStr),
  });
  // timingSafeEqual requires equal-length buffers; a length mismatch means "wrong password",
  // not a crash — checked explicitly rather than letting it throw.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Minimal in-memory brute-force protection on sign-in (M26 Security Hardening) — no external
 * service (that would be a Human Gate the moment it's paid, matching M25's caching decision).
 * Process-local and keyed by normalized email: a targeted attacker guessing one account's
 * password is the threat this defends against, not distributed credential stuffing (which needs
 * IP-level/infrastructure-level defenses out of scope for a single-process app today).
 */
const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const failedLoginAttempts = new Map<string, { count: number; windowStart: number }>();

function recordFailedLogin(email: string): void {
  const now = Date.now();
  const entry = failedLoginAttempts.get(email);
  if (!entry || now - entry.windowStart >= LOGIN_ATTEMPT_WINDOW_MS) {
    failedLoginAttempts.set(email, { count: 1, windowStart: now });
    return;
  }
  entry.count += 1;
}

function isLoginLocked(email: string): boolean {
  const entry = failedLoginAttempts.get(email);
  if (!entry) return false;
  if (Date.now() - entry.windowStart >= LOGIN_ATTEMPT_WINDOW_MS) {
    failedLoginAttempts.delete(email);
    return false;
  }
  return entry.count >= LOGIN_ATTEMPT_LIMIT;
}

function clearFailedLogins(email: string): void {
  failedLoginAttempts.delete(email);
}

/** Test-only escape hatch — resets brute-force tracking between test cases. */
export function resetLoginAttemptTracking(): void {
  failedLoginAttempts.clear();
}

export async function signUp(email: string, password: string) {
  const normalized = normalizeEmail(email);
  if (!EMAIL_PATTERN.test(normalized)) {
    throw new AuthError("Invalid email address");
  }
  if (password.length < 8) {
    throw new AuthError("Password must be at least 8 characters");
  }

  const existing = await prisma.user.findUnique({ where: { email: normalized } });
  if (existing) {
    throw new AuthError("An account with this email already exists");
  }

  const passwordHash = await hashPassword(password);
  return prisma.user.create({ data: { email: normalized, passwordHash } });
}

/**
 * Returns the User on success. Never reveals whether the email or the password was wrong, and
 * never reveals whether the lockout is why the attempt failed (a distinct error message for
 * "locked out" vs. "wrong password" would itself leak that the email exists and has had failed
 * attempts against it).
 */
export async function signIn(email: string, password: string) {
  const normalized = normalizeEmail(email);
  if (isLoginLocked(normalized)) {
    throw new AuthError("Invalid email or password");
  }

  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user) {
    recordFailedLogin(normalized);
    throw new AuthError("Invalid email or password");
  }
  // H1 (docs/DECISIONS.md): legacy accounts (pre-auth rows preserved by the staged auth
  // migration) carry a sentinel passwordHash ("LEGACY_ACCOUNT_NO_CREDENTIALS") that is not a
  // real "<N>:<r>:<p>:<saltHex>:<hashHex>" scrypt record. It must never be passed to
  // verifyPassword — that would either throw on the malformed format or, worse, risk being
  // treated as a checkable credential. Reject immediately, before any password verification.
  if (user.isLegacyAccount) {
    recordFailedLogin(normalized);
    throw new AuthError("Invalid email or password");
  }
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    recordFailedLogin(normalized);
    throw new AuthError("Invalid email or password");
  }
  clearFailedLogins(normalized);
  return user;
}

/**
 * The session id doubles as the bearer token (see module docstring), so it must be
 * unpredictable, not just unique. Prisma's schema-level `@default(cuid())` is designed for
 * collision-resistant IDs, not for resisting a targeted guessing/enumeration attack against a
 * secret — so the token is generated explicitly here with `crypto.randomBytes`, overriding the
 * schema default, rather than relying on it.
 */
function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export async function createSession(userId: string) {
  return prisma.session.create({
    data: { id: generateSessionToken(), userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });
}

/** Returns the User for a valid, non-expired session token, or null. Never throws on a bad token. */
export async function validateSession(token: string) {
  const session = await prisma.session.findUnique({
    where: { id: token },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) {
    return null;
  }
  return session.user;
}

export async function destroySession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id: token } });
}
