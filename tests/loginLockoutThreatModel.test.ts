import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ESC-009: the login lockout's present semantics, pinned — including the part that is a defect.
 *
 * The escalation asked whether to keep an account-targeted lockout or replace it. The decision was
 * `HUMAN_GATE`: keep the current behaviour unchanged as a temporary pre-launch default, and do not
 * choose a production threat model autonomously. The reasoning is worth restating because it is
 * why this file contains no fix:
 *
 * - Option B (source/IP keyed) moves the failure rather than removing it — distributed attackers
 *   bypass it, and users behind one NAT or proxy are collateral. Doing it properly needs trusted
 *   ingress topology that does not exist yet.
 * - Option C needs a challenge mechanism the product does not have, which changes dependencies,
 *   accessibility and abuse policy.
 * - Verifying the password before the lock check would restore unlimited guessing.
 *
 * So this file does the one thing that is safe and useful under a human gate: it makes the current
 * semantics impossible to change by accident, and it states what a replacement would have to prove.
 *
 * **The DoS is asserted here as present, deliberately.** Anyone who knows an address can lock that
 * account for fifteen minutes with five wrong guesses — no session, no victim interaction. Writing
 * a test that passes BECAUSE the vulnerability exists is uncomfortable and correct: it means the
 * behaviour cannot drift silently in either direction, and whoever removes it has to come here and
 * delete an assertion that says exactly what they are changing.
 */

const AUTH_SOURCE = readFileSync(join(process.cwd(), "src/server/domain/auth.ts"), "utf8");

/**
 * The module with comments stripped.
 *
 * The not-quietly-replaced check below scans for implementation markers, and on its first run it
 * matched the word "IP" inside a comment saying IP-level defences are OUT of scope — prose read as
 * code, for the third time in this session after the preflight read-only guard and the evidence
 * path classifier. A guard that fires on a comment discussing the thing it forbids is the failure
 * that gets guards deleted, so the stripping is applied here rather than the pattern loosened.
 */
const AUTH = AUTH_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("the current lockout semantics, as ESC-009 described them", () => {
  it("locks after five failures within fifteen minutes", () => {
    expect(AUTH).toMatch(/LOGIN_ATTEMPT_LIMIT\s*=\s*5\b/);
    expect(AUTH).toMatch(/LOGIN_ATTEMPT_WINDOW_MS\s*=\s*15\s*\*\s*60\s*\*\s*1000/);
  });

  it("keys attempts by normalised email, which is what makes it targetable", () => {
    // The whole finding in one line. A counter keyed by something the attacker supplies about the
    // VICTIM is a counter the attacker controls.
    expect(AUTH).toMatch(/recordFailedLogin\(\s*normalized\s*\)/);
    expect(AUTH).toMatch(/isLoginLocked\(\s*normalized\s*\)/);
  });

  it("checks the lock before verifying the password", () => {
    // Order matters and is deliberate: checking after would let an attacker distinguish a locked
    // account from a wrong password. It is also precisely what makes the lock reachable without
    // knowing any credential.
    const lockAt = AUTH.indexOf("isLoginLocked(normalized)");
    const verifyAt = AUTH.indexOf("await verifyPassword(password, user.passwordHash)");
    expect(lockAt).toBeGreaterThan(0);
    expect(verifyAt).toBeGreaterThan(0);
    expect(lockAt).toBeLessThan(verifyAt);
  });

  it("still returns a generic error, so the lock does not enumerate accounts", () => {
    // The one property the current design gets unambiguously right, and the one a replacement is
    // most likely to break while fixing the DoS.
    expect(AUTH).toMatch(/Invalid email or password/);
  });

  it("has not been quietly replaced while HG-009 is open", () => {
    // The decision said keep it unchanged pending a human threat-model choice. If someone
    // implements source-keyed limiting or a challenge without reopening the gate, this is where
    // that surfaces — as a deliberate deletion rather than a silent drift.
    expect(AUTH).not.toMatch(/\bip\b|\bremoteAddress\b|x-forwarded-for/i);
    expect(AUTH).not.toMatch(/captcha|recaptcha|turnstile/i);
  });
});

/**
 * What a replacement has to prove before HG-009 can close.
 *
 * Written now, while the reasoning is fresh, rather than reconstructed later from a decision
 * comment. These are the acceptance criteria the ESC-009 decision named; they are assertions about
 * this list existing, not about behaviour, because the behaviour does not exist yet and pretending
 * to test it would be the fabrication this project keeps finding.
 */
export const REPLACEMENT_ACCEPTANCE_CRITERIA = [
  "known-account DoS: a third party who knows an address cannot deny that account",
  "brute-force budget: guessing remains bounded per account and per source",
  "NAT/proxy fairness: many users behind one address are not collectively locked",
  "distributed-source bypass: many sources cannot each spend a full budget against one account",
  "generic error non-enumeration: responses still do not reveal whether an account exists",
  "trusted ingress: any source-keyed limit depends on proxy topology that must exist first",
] as const;

describe("the acceptance criteria for whatever replaces it", () => {
  it("names every dimension the decision required", () => {
    expect(REPLACEMENT_ACCEPTANCE_CRITERIA).toHaveLength(6);
    for (const criterion of REPLACEMENT_ACCEPTANCE_CRITERIA) {
      expect(criterion.length).toBeGreaterThan(30);
    }
  });

  it("keeps HG-009 recorded as open with the exposure stated plainly", () => {
    // Required action 2 of the decision: the gate stays open and says what it costs. A gate whose
    // record understates the exposure is worse than no record, because it looks handled.
    const gates = readFileSync(join(process.cwd(), "docs/HUMAN_GATE_QUEUE.md"), "utf8");
    const section = gates.slice(gates.indexOf("## HG-009"), gates.indexOf("## HG-009") + 2500);
    expect(section).toMatch(/15[- ]minute|fifteen[- ]minute/i);
    expect(section).toMatch(/deny|DoS|denial/i);
    expect(section).not.toMatch(/APPROVED FOR PRODUCTION/i);
  });
});
