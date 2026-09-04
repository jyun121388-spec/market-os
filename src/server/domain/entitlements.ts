import type { Plan } from "@/generated/prisma/client";

/**
 * Subscription-ready architecture (docs/ROADMAP.md M23) — the extension point, not a billing
 * system. See docs/DECISIONS.md for scope: no payment processor, no checkout flow, no
 * Subscription/billing model. Real payment activation remains a Human Gate.
 *
 * `FEATURE_PLAN_REQUIREMENTS` is deliberately empty: no feature in this codebase is currently
 * paid-gated. That is a real, honest statement about the product today, not an oversight —
 * gating a feature is meant to be "add one entry here," not a reason to invent one
 * speculatively.
 */

const PLAN_RANK: Record<Plan, number> = { FREE: 0, PRO: 1 };

/** Does a user on `userPlan` satisfy a feature that requires `requiredPlan`? */
export function hasEntitlement(userPlan: Plan, requiredPlan: Plan): boolean {
  return PLAN_RANK[userPlan] >= PLAN_RANK[requiredPlan];
}

export const FEATURE_PLAN_REQUIREMENTS: Record<string, Plan> = {};

export function canUseFeature(user: { plan: Plan }, featureKey: string): boolean {
  const required = FEATURE_PLAN_REQUIREMENTS[featureKey] ?? "FREE";
  return hasEntitlement(user.plan, required);
}
