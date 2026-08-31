/**
 * Proof that the gate invariant is carried by the TYPE, not by a convention.
 *
 * A type-level claim needs a type-level demonstration: this file compiles ONLY because both
 * violations below are commented out. Uncomment either and `npx tsc --noEmit` fails, which is the
 * whole assertion. It is deliberately not a vitest case -- a runtime test cannot observe a
 * compile-time refusal, and writing one that appears to would be coverage theatre.
 *
 *   npx tsc --noEmit          # passes as committed
 *   ... uncomment VIOLATION 1 or 2, run again, and it must fail
 *
 * Both were run and both were rejected — TS2322 on each, the object literal not assignable to
 * `CapabilityEvidence`.
 *
 * ONE TRAP, because it nearly turned into a false negative here. Copying the violations into a
 * DOT-PREFIXED scratch file produced no errors at all, and that is not the type being inert: the
 * tsconfig `include` is a recursive TypeScript glob, and TypeScript's globs skip dotfiles. A silent
 * zero from a file the compiler never opened reads exactly like a passing check, so use an ordinary
 * filename.
 */

import type { CapabilityEvidence } from "../src/server/fabric/providerCapability";

/** Legal: NOT_VERIFIED with the gate that would clear it. */
export const debtWithOwner: CapabilityEvidence = {
  state: "NOT_VERIFIED",
  field: "realtime_start",
  basis: "Declared by the adapter, never seen in a live response.",
  provenance: "ADAPTER_DECLARATION",
  blockedBy: "HG-002",
};

/** Legal: a resolved state, carrying no gate because nothing is blocked. */
export const observed: CapabilityEvidence = {
  state: "SUPPORTED",
  field: "fy",
  basis: "Observed on real companyfacts responses during the live contract run.",
  provenance: "LIVE_RESPONSE",
};

// VIOLATION 1 -- verification debt with no owner. Must not compile.
// export const debtWithoutOwner: CapabilityEvidence = {
//   state: "NOT_VERIFIED",
//   field: "realtime_start",
//   basis: "Declared by the adapter, never seen in a live response.",
//   provenance: "ADAPTER_DECLARATION",
// };

// VIOLATION 2 -- a resolved cell claiming to be blocked. Must not compile.
// export const observedButBlocked: CapabilityEvidence = {
//   state: "SUPPORTED",
//   field: "fy",
//   basis: "Observed on real companyfacts responses during the live contract run.",
//   provenance: "LIVE_RESPONSE",
//   blockedBy: "HG-002",
// };
