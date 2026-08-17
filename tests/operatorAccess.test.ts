import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isOperatorEmail } from "@/server/domain/operatorAccess";

/**
 * `/admin` exposes ingest errors, source tiers and completeness shortfalls. Before 2026-08-18 it
 * required only that someone be signed in, so on a product with open signup any registered user
 * could read it (independent review, `gpt-5.6-terra`).
 *
 * The behaviour that matters most here is the unconfigured case: it must deny. A gate that opens
 * when nobody has configured it is the same defect wearing a different hat, and it would return
 * the first time anyone deployed without setting the variable.
 */

const ORIGINAL = process.env.ADMIN_EMAILS;

beforeEach(() => {
  delete process.env.ADMIN_EMAILS;
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ADMIN_EMAILS;
  else process.env.ADMIN_EMAILS = ORIGINAL;
});

describe("isOperatorEmail — fails closed", () => {
  it("denies everyone when ADMIN_EMAILS is unset", () => {
    expect(isOperatorEmail("anyone@example.com")).toBe(false);
  });

  it("denies everyone when ADMIN_EMAILS is empty or only separators", () => {
    for (const value of ["", "   ", ",", " , , "]) {
      process.env.ADMIN_EMAILS = value;
      expect(isOperatorEmail("anyone@example.com"), `for ${JSON.stringify(value)}`).toBe(false);
    }
  });

  it("denies a null, undefined or blank email even when the allowlist is populated", () => {
    process.env.ADMIN_EMAILS = "ops@example.com";
    expect(isOperatorEmail(null)).toBe(false);
    expect(isOperatorEmail(undefined)).toBe(false);
    expect(isOperatorEmail("")).toBe(false);
    expect(isOperatorEmail("   ")).toBe(false);
  });
});

describe("isOperatorEmail — allows exactly the listed addresses", () => {
  it("allows a listed address and denies an unlisted one", () => {
    process.env.ADMIN_EMAILS = "ops@example.com";
    expect(isOperatorEmail("ops@example.com")).toBe(true);
    expect(isOperatorEmail("someone.else@example.com")).toBe(false);
  });

  it("handles multiple entries with surrounding whitespace", () => {
    process.env.ADMIN_EMAILS = " ops@example.com , second@example.com ";
    expect(isOperatorEmail("ops@example.com")).toBe(true);
    expect(isOperatorEmail("second@example.com")).toBe(true);
    expect(isOperatorEmail("third@example.com")).toBe(false);
  });

  it("compares case-insensitively on both sides", () => {
    // The address comes from a signup form; the allowlist is hand-edited into an env file. A
    // capitalisation difference locking out the only operator is a bad failure mode.
    process.env.ADMIN_EMAILS = "Ops@Example.COM";
    expect(isOperatorEmail("ops@example.com")).toBe(true);
    expect(isOperatorEmail("OPS@EXAMPLE.COM")).toBe(true);
  });

  it("does not match on a substring or a prefix", () => {
    process.env.ADMIN_EMAILS = "ops@example.com";
    expect(isOperatorEmail("ops@example.com.attacker.test")).toBe(false);
    expect(isOperatorEmail("notops@example.com")).toBe(false);
    expect(isOperatorEmail("ops@example.co")).toBe(false);
  });

  it("re-reads the environment on each call rather than caching at import", () => {
    // The module is imported once per process. Caching the list at import would make the value
    // depend on module load order, which is exactly the kind of thing that works in a test and
    // fails in a server.
    process.env.ADMIN_EMAILS = "first@example.com";
    expect(isOperatorEmail("first@example.com")).toBe(true);
    process.env.ADMIN_EMAILS = "second@example.com";
    expect(isOperatorEmail("first@example.com")).toBe(false);
    expect(isOperatorEmail("second@example.com")).toBe(true);
  });
});
