import { describe, expect, it } from "vitest";
import {
  asksWhetherAPersonShouldTrade,
  classifySubject,
} from "@/server/domain/subjectClassification";

/**
 * The classifier that replaced five rounds of pattern churn.
 *
 * `docs/INTERIM_REVIEW_FINDINGS.md` records the thirteen rounds this came out of. The short version
 * is that "Should John buy Nvidia?" and "Should Apple buy Nvidia?" are the same sentence shape, and
 * every attempt to separate them with a pattern — possessive pronoun, kinship list, capital letter,
 * role list, second possessive — was walked past from one side or refused ordinary research from
 * the other. The difference is not in the sentence; it is in what John and Apple are.
 *
 * Three outcomes, and UNRESOLVED is the one that matters. A subject no registry recognises is not
 * thereby a company, and in a transactional frame it redirects. That fail-safe is the reason a
 * classifier beats a pattern here: a pattern has to decide, and this can decline to.
 */
describe("classifySubject", () => {
  it.each([
    ["I", "PERSON"],
    ["my father", "PERSON"],
    ["Dad", "PERSON"],
    ["the trustee", "PERSON"],
    ["Dad's broker", "PERSON"],
    ["my son's financial planner", "PERSON"],
    ["my mother's wealth manager", "PERSON"],
    ["my elderly retired father", "PERSON"],
  ])("calls %s a %s", (subject, expected) => {
    expect(classifySubject(subject)).toBe(expected);
  });

  it.each([
    ["Apple", "NON_PERSON"],
    ["Samsung", "NON_PERSON"],
    ["BlackRock", "NON_PERSON"],
    ["the Fed", "NON_PERSON"],
    ["the ECB", "NON_PERSON"],
    ["Korea", "NON_PERSON"],
    ["Congress", "NON_PERSON"],
    ["Europe", "NON_PERSON"],
    ["companies", "NON_PERSON"],
    ["the index", "NON_PERSON"],
    ["a pension fund", "NON_PERSON"],
    ["investors", "NON_PERSON"],
    ["my brother's company", "NON_PERSON"],
    ["my brother's project manager", "NON_PERSON"],
    ["Dad's estate agent", "NON_PERSON"],
    ["FRED", "NON_PERSON"],
  ])("calls %s a %s", (subject, expected) => {
    expect(classifySubject(subject)).toBe(expected);
  });

  it.each(["John", "Sarah", "Mr. Smith", "john", "JOHN", "Fenwick", "Ravi"])(
    "cannot resolve %s, which is the point",
    (subject) => {
      expect(classifySubject(subject)).toBe("UNRESOLVED");
    },
  );

  it("prefers the organisation head noun over a personal possessive", () => {
    // "My brother's company" is a company and "my brother's broker" is my brother. Two review
    // rounds arrived at this from opposite directions before it was written down as an ordering.
    expect(classifySubject("my brother's company")).toBe("NON_PERSON");
    expect(classifySubject("my brother's broker")).toBe("PERSON");
  });

  it("needs a financial qualifier before a generic job word", () => {
    expect(classifySubject("my brother's investment manager")).toBe("PERSON");
    expect(classifySubject("my brother's project manager")).toBe("NON_PERSON");
    expect(classifySubject("Dad's estate agent")).toBe("NON_PERSON");
    expect(classifySubject("Dad's tax adviser")).toBe("PERSON");
  });

  it("reads registries the repository already maintains", () => {
    // Not a fourth hand-written list: these come from prisma/sources.ts and prisma/causalEdges.ts,
    // so an institution added to the seed data is understood here without a second edit.
    expect(classifySubject("the Bank of Korea")).toBe("NON_PERSON");
    expect(classifySubject("the World Bank")).toBe("NON_PERSON");
    expect(classifySubject("OECD")).toBe("NON_PERSON");
  });
});

describe("asksWhetherAPersonShouldTrade", () => {
  it.each([
    "Should John buy Nvidia?",
    "Should john buy Nvidia?",
    "Should JOHN buy Nvidia?",
    "Should Mr. Smith sell Apple?",
    "Should Dad buy more Nvidia?",
    "Should the trustee buy Nvidia?",
    "Should Dad's broker sell Apple?",
    "Should my elderly retired father, given his low risk tolerance, sell Apple?",
    "Should I buy Apple?",
  ])("redirects %s", (query) => {
    expect(asksWhetherAPersonShouldTrade(query)).toBe(true);
  });

  it.each([
    "Should Apple buy Nvidia?",
    "Should Samsung sell its display unit?",
    "Should Tesla invest in a new gigafactory?",
    "Should Korea invest more in semiconductors?",
    "Should Congress buy down the deficit?",
    "Should Europe invest in LNG terminals?",
    "Should the Fed hold rates steady at the next meeting?",
    "Should the ECB buy government bonds under QE?",
    "Should BlackRock sell their pension fund business?",
    "Should banks hold their pension fund assets separately?",
    "Should investors buy Nvidia?",
    "Should my brother's company, given its strong cash balance, buy a competitor?",
    "Should my model hold the discount rate fixed across all three scenarios?",
    "What should a 10-K disclose about short positions?",
    "Should short interest be reported semi-monthly?",
    "What were Apple's revenues last quarter?",
  ])("does not redirect %s", (query) => {
    expect(asksWhetherAPersonShouldTrade(query)).toBe(false);
  });

  it("keeps the analytical senses of hold and short out of the frame", () => {
    // Both were over-blocks in earlier rounds and both are properties of the SENTENCE rather than
    // of the subject, so they are handled at the frame and not in the classifier.
    expect(asksWhetherAPersonShouldTrade("Should my model hold inflation constant?")).toBe(false);
    expect(asksWhetherAPersonShouldTrade("Should my brother hold Apple?")).toBe(true);
    expect(
      asksWhetherAPersonShouldTrade("What should a filing disclose about short sellers?"),
    ).toBe(false);
  });
});
