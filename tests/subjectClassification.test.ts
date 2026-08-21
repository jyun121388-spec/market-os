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

/**
 * Gate O — the bounded post-repair review, and the thing the classifier had left out.
 *
 * Both blockers turned on the OBJECT of the verb, which the first version never looked at. Two
 * findings from opposite directions prove it has to:
 *
 *     Should my brother's project manager buy new software?   procurement — answer
 *     Should my brother's project manager buy Nvidia?         a personalised trade — redirect
 *
 * Same subject, same verb. A rule that reads only the subject has to get one of them wrong, and
 * Gate J had made it wrong in one direction while Gate O found it wrong in the other.
 *
 * The `hold` carve-out was the same mistake in miniature: "Should my father hold his Apple position
 * unchanged?" was exempted because "unchanged" appears after the verb, which is exactly the word an
 * analytical hold uses. The qualifier cannot separate them; the object can.
 */
describe("Gate O — the object decides what kind of question it is", () => {
  it.each([
    "Should my brother's project manager buy Nvidia?",
    "Should my friend the bank director buy Nvidia?",
    "Should my father hold his Apple position unchanged?",
  ])("redirects %s", (query) => {
    expect(asksWhetherAPersonShouldTrade(query)).toBe(true);
  });

  it.each([
    "Should my brother's project manager buy new software?",
    "Should Dad's estate agent sell the house?",
    "Should my sister's office manager invest in new desks?",
    "Should my model hold the discount rate fixed across all three scenarios?",
    "Should our forecast hold inflation constant?",
    "Should my brother's company, given its strong cash balance, buy a competitor?",
  ])("does not redirect %s", (query) => {
    expect(asksWhetherAPersonShouldTrade(query)).toBe(false);
  });

  it("reads an appositive as description, not as the subject", () => {
    // "My father, a company DIRECTOR" put an organisation word in reach of a rule that checks
    // organisation words first. Only the head phrase decides now; the rest is description.
    expect(asksWhetherAPersonShouldTrade("Should my father, a company director, sell Apple?")).toBe(
      true,
    );
    expect(
      asksWhetherAPersonShouldTrade(
        "Should my brother's company, given its strong cash balance, buy a competitor?",
      ),
    ).toBe(false);
  });

  it("follows a described person as far as they are described", () => {
    for (const query of [
      "Should Sarah, who is 68 and retired and has a very low tolerance for any risk at all, sell Apple?",
      "Should my elderly retired father with a very conservative long-term retirement portfolio sell Nvidia?",
    ]) {
      expect(asksWhetherAPersonShouldTrade(query), query).toBe(true);
    }
  });
});

/**
 * Known residual, assigned to REVIEW_DEBT by the Gate O review rather than fixed.
 *
 * A person whose name is also a registry entry classifies NON_PERSON — "Should Apple Martin buy
 * Nvidia?" reads "apple" and stops. Every name registry has this property, and the repairs that
 * would close it either require full-span matching, which breaks "the Dow Jones Industrial
 * Average", or a personal-name list, which is the unbounded enumeration this whole module exists
 * to avoid.
 *
 * `[CHATGPT_ARCHITECT_GUIDANCE][RC-CONVERGENCE-007]` is explicit that a measurable tail like this
 * belongs in a follow-up coverage evaluation and not in another round. Asserted so the tail is
 * visible and dated, not endorsed.
 */
describe("Gate O — name collisions, recorded as review debt", () => {
  it("cannot tell a person named after a company from the company", () => {
    expect(asksWhetherAPersonShouldTrade("Should Apple Martin buy Nvidia?")).toBe(false);
    // ...while the ordinary forms of the same request are all covered.
    expect(asksWhetherAPersonShouldTrade("Should Apple Martin sell her Nvidia shares?")).toBe(true);
    expect(asksWhetherAPersonShouldTrade("Should my friend Apple Martin buy Nvidia?")).toBe(true);
  });
});

/**
 * Gate P — the re-review of the changed surface, and both findings were about WHOSE money it is.
 *
 * Narrowing `mentionsAPerson` to person nouns fixed a monetary-policy over-block and opened a
 * different hole: "Should my retirement fund buy Nvidia stock?" has no person noun in it at all,
 * and it is the user's own money. First-person SINGULAR says so where no noun does. "Our" still
 * does not, because it is personal in "our portfolio" and a bare determiner in "our independent
 * central bank" — the exact question the narrowing was introduced to stop refusing.
 *
 * And the rescue reads the HEAD only, for the same reason `classifySubject` does: "Should
 * BlackRock, whose CLIENT base is aging, sell Treasury bonds?" is institutional research, and the
 * person noun is in an appositive describing the subject rather than naming it.
 */
describe("Gate P — whose money is being traded", () => {
  it.each([
    "Should my retirement fund buy Nvidia stock?",
    "Should my pension fund sell Apple?",
    "Should my brother's project manager buy Nvidia?",
    "Should my father hold his Apple position unchanged?",
  ])("redirects %s", (query) => {
    expect(asksWhetherAPersonShouldTrade(query)).toBe(true);
  });

  it.each([
    "Should BlackRock, whose client base is aging, sell Treasury bonds?",
    "Should our independent central bank, during a liquidity crisis, buy government bonds under QE?",
    "Should the trustee bank hold its pension fund assets separately?",
    "Should a pension fund invest in bonds?",
    "Should my brother's company, given its strong cash balance, buy a competitor?",
  ])("does not redirect %s", (query) => {
    expect(asksWhetherAPersonShouldTrade(query)).toBe(false);
  });

  it("reads an organisational possessive on the object as the organisation's holding", () => {
    // "Its" and "their" say whose the holding is. That is what separates an institution managing
    // its own balance sheet from a person being advised about theirs.
    expect(asksWhetherAPersonShouldTrade("Should the trustee bank hold its pension fund?")).toBe(
      false,
    );
    expect(asksWhetherAPersonShouldTrade("Should my adviser sell my pension fund holdings?")).toBe(
      true,
    );
  });
});

/**
 * Gate Q — three findings, all about which word is the actual head.
 *
 * "Your retirement fund" is the reader's money and "my retirement fund" is mine; excluding second
 * person left one of them uncovered. Only "our" stays out, because it is the single possessive
 * that reads institutionally.
 *
 * "Their" on an object was treated as organisational for one commit, and it is ordinary
 * singular-they: "Should Dad's assistant sell THEIR Nvidia shares?" is one person's holding.
 * Nothing was lost by dropping it — the organisational cases have no person noun in the subject,
 * so the rescue never reaches that line for them.
 *
 * And a role has to be the HEAD, the last word of the phrase, not merely present in it. "The fund
 * manager association" is an association; bag-of-words matching read it as a fund manager and
 * refused a question about industry policy.
 */
describe("Gate Q — the head is the last word, not any word", () => {
  it.each([
    "Should your retirement fund buy Nvidia stock?",
    "Should Dad's assistant sell their Nvidia shares?",
    "Should my parents sell their Nvidia shares?",
    "Should the fund manager hold Tesla?",
    "Should Dad's investment manager sell Apple?",
  ])("redirects %s", (query) => {
    expect(asksWhetherAPersonShouldTrade(query)).toBe(true);
  });

  it.each([
    "Should the fund manager association invest in financial education?",
    "Should the asset management board buy back stock?",
    "Should the trustee bank hold its pension fund assets separately?",
    "Should BlackRock sell their pension fund business?",
    "Should the company sell their portfolio management unit?",
  ])("does not redirect %s", (query) => {
    expect(asksWhetherAPersonShouldTrade(query)).toBe(false);
  });

  it("keeps 'our' out of the personal possessives, deliberately", () => {
    // The one possessive that reads institutionally. Including it refused a monetary-policy
    // question for a round; excluding it costs "our portfolio", which the person nouns cover.
    expect(
      asksWhetherAPersonShouldTrade(
        "Should our independent central bank, during a liquidity crisis, buy government bonds under QE?",
      ),
    ).toBe(false);
    expect(asksWhetherAPersonShouldTrade("Should my adviser sell our Apple shares?")).toBe(true);
  });
});
