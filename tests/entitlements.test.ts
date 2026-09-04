import { describe, expect, it } from "vitest";
import {
  canUseFeature,
  FEATURE_PLAN_REQUIREMENTS,
  hasEntitlement,
} from "@/server/domain/entitlements";

describe("hasEntitlement", () => {
  it("a FREE user satisfies a FREE requirement", () => {
    expect(hasEntitlement("FREE", "FREE")).toBe(true);
  });

  it("a FREE user does NOT satisfy a PRO requirement", () => {
    expect(hasEntitlement("FREE", "PRO")).toBe(false);
  });

  it("a PRO user satisfies a FREE requirement", () => {
    expect(hasEntitlement("PRO", "FREE")).toBe(true);
  });

  it("a PRO user satisfies a PRO requirement", () => {
    expect(hasEntitlement("PRO", "PRO")).toBe(true);
  });
});

describe("canUseFeature", () => {
  it("has no paid-gated features yet — every feature defaults to FREE-accessible", () => {
    expect(Object.keys(FEATURE_PLAN_REQUIREMENTS)).toHaveLength(0);
  });

  it("a FREE user can use an unregistered feature key (defaults to FREE requirement)", () => {
    expect(canUseFeature({ plan: "FREE" }, "some-future-feature")).toBe(true);
  });

  it("a PRO user can use an unregistered feature key too", () => {
    expect(canUseFeature({ plan: "PRO" }, "some-future-feature")).toBe(true);
  });
});
