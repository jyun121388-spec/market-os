import { describe, expect, it } from "vitest";
import { detectPersonalizedAdviceRequest } from "@/server/domain/askMarket";

/**
 * IR-031 — the long/short vocabulary, and the accounting phrase that was caught in the net.
 *
 * Found by independent review (`gpt-5.6-terra`, packet targets A9/A12) and reproduced before
 * anything changed. Two failures in opposite directions, in the same function:
 *
 * A guardrail that depends on the user choosing retail vocabulary over trading vocabulary is not
 * a guardrail. "Should I buy Apple?" was blocked and "Should I short Apple?" was not, along with
 * every other long/short form in both languages.
 *
 * And "fair value" was blocking "What is fair value accounting under ASC 820?" — a question this
 * product exists to answer. Over-blocking is tracked as a failure here for the same reason
 * under-blocking is: a factual question wrongly refused teaches a user that the product cannot
 * answer questions.
 */

describe("position vocabulary must be blocked in both languages", () => {
  it.each([
    "Should I go long TSLA today?",
    "should i go long on tesla",
    "Should I short Apple?",
    "I want to short the market",
    "thinking about to short this",
    "open a long in NVDA",
    "taking a short in the S&P",
    "테슬라 롱 잡을까?",
    "삼성전자 숏 쳐야 하나",
    "삼성전자 공매도 할까",
  ])("blocks %s", (query) => {
    expect(detectPersonalizedAdviceRequest(query)).toBe(true);
  });

  /**
   * The reason "long" and "short" are anchored to a position verb rather than matched bare. Both
   * are ordinary English words, and a guardrail that eats "short-term rates" would make the macro
   * side of the product unusable — which is a bigger failure than the one being fixed.
   */
  it.each([
    "short-term interest rates",
    "How long has CPI been above 3%?",
    "long-term unemployment rate",
    "shortage of semiconductors",
    "how long is the yield curve inverted for",
  ])("does not block %s", (query) => {
    expect(detectPersonalizedAdviceRequest(query)).toBe(false);
  });
});

describe("fair value: a measurement basis is not a valuation request", () => {
  it.each([
    "What is fair value accounting under ASC 820?",
    "Apple fair value of financial instruments",
    "explain the fair value hierarchy",
    "fair value measurement under IFRS 13",
  ])("does not block %s", (query) => {
    expect(detectPersonalizedAdviceRequest(query)).toBe(false);
  });

  /**
   * The first fix narrowed the `fair value` pattern to require a security word after it, and the
   * must-not-flag corpus caught what that cost within one run: this query stopped being blocked.
   * Narrowing a legal guardrail traded a false positive for a false negative, so it was reverted
   * in favour of a short exclusion list. This case is why.
   */
  it.each([
    "What is the fair value of Apple right now, roughly speaking?",
    "Apple fair value estimate",
    "애플 적정가 알려줘",
  ])("still blocks %s", (query) => {
    expect(detectPersonalizedAdviceRequest(query)).toBe(true);
  });

  /**
   * A known and accepted false positive, asserted so it cannot change without someone noticing.
   *
   * "The fair value of household wealth reported by the Federal Reserve" is a real Fed statistic
   * and a legitimate question, and it is still redirected. There is no way to enumerate every
   * non-tradeable subject, and the exclusion list is deliberately a list of fixed collocations
   * rather than a rule — so its failure mode is over-blocking. Refusing this is a smaller harm
   * than answering "what is the fair value of Apple", and pinning it here keeps it a decision
   * rather than an oversight.
   */
  it("still over-blocks a legitimate Fed statistic, knowingly", () => {
    expect(
      detectPersonalizedAdviceRequest(
        "What is the fair value of household wealth reported by the Federal Reserve?",
      ),
    ).toBe(true);
  });

  it("does not let an accounting phrase excuse a real request elsewhere in the query", () => {
    // The exclusion must not become a bypass. An attacker appending "under ASC 820" to a genuine
    // instruction would otherwise buy an exemption for the whole sentence.
    expect(detectPersonalizedAdviceRequest("Should I buy Apple now? Also explain ASC 820.")).toBe(
      true,
    );
    expect(detectPersonalizedAdviceRequest("fair value accounting — should I short Apple?")).toBe(
      true,
    );
  });
});
