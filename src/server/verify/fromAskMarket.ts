import type { AskMarketResult } from "@/server/domain/askMarket";
import type { VerificationInput } from "./types";

/**
 * Adapter: a real Ask Market answer → a `VerificationInput`.
 *
 * The third output shape, and the first one that is not a number. Filing Diff and Morning Brief
 * are both arithmetic; this is a curated set of figures assembled in response to a free-text
 * question, which is the only place in the product where `adversarial_resilience` has anything to
 * bite on. Until now that dimension returned NOT_APPLICABLE for every calculation and
 * INSUFFICIENT_EVIDENCE for everything else — technically honest, and it had never once been
 * exercised against output that could genuinely read as advice.
 *
 * The property worth pinning is subtle and currently holds by accident.
 *
 * Ask Market refuses a buy/sell question by setting `PERSONALIZED_ADVICE_REDIRECTED` and attaching
 * a redirect message — and it STILL returns the factors, which `/ask` renders underneath. So a
 * user asking "Should I buy Apple Inc?" sees a refusal followed by ten Apple figures. That is
 * defensible, and the redirect message says exactly what it is doing: a factor analysis "for you
 * to interpret yourself". What makes it defensible rather than advice-by-arrangement is that the
 * factors are IDENTICAL to what the neutral query returns — the advice detector and the factor
 * selection are orthogonal, so the buy/sell framing changes nothing about which figures appear.
 *
 * Nothing enforces that. `findCompanyFacts` could start ranking on relevance to the question, and
 * the refusal would quietly become a recommendation delivered as evidence. The invariant is
 * checkable and now checked.
 *
 * Read-only and inert. Nothing in v1 imports this.
 */

/** Every string this answer puts in front of a reader, in render order. */
function renderedText(result: AskMarketResult): string[] {
  const lines: string[] = [];
  if (result.redirectMessage) lines.push(result.redirectMessage);
  for (const f of result.seriesFactors) {
    lines.push(`${f.seriesName}: ${f.value} ${f.unit} as of ${f.asOfDate} (${f.sourceCode})`);
  }
  for (const f of result.companyFacts) {
    lines.push(
      `${f.concept}: ${f.value} ${f.unit} for ${f.periodEnd} (${f.form}, ${f.sourceCode})`,
    );
  }
  for (const f of result.causalFactors) {
    // The causal edges are the closest thing the product has to a narrative, so they belong in
    // what gets checked rather than being treated as metadata.
    lines.push(
      `${f.fromVariable} → ${f.toVariable} (${f.direction}, confidence ${f.confidence}): ${f.mechanism}`,
    );
  }
  return lines;
}

export function verificationInputFromAskMarket(result: AskMarketResult): VerificationInput | null {
  // NOT_FOUND puts no figure in front of anyone. There is no claim to verify, and manufacturing
  // one would invent a subject — the same reason the Filing Diff adapter skips INSUFFICIENT_DATA.
  if (result.status === "NOT_FOUND") return null;

  const sourceCodes = [
    ...new Set([
      ...result.seriesFactors.map((f) => f.sourceCode),
      ...result.companyFacts.map((f) => f.sourceCode),
    ]),
  ];

  return {
    outputId: `askMarket:${result.query}`,
    // Every figure here is a stored, reported value shown as itself. Nothing is derived, so
    // calling it a CALCULATION would misstate where the numbers came from — which is precisely
    // what `provenance_integrity` exists to catch.
    claimType: "FACT",
    sourceCodes,
    advice: {
      shape: result.status === "PERSONALIZED_ADVICE_REDIRECTED" ? "REFUSAL" : "FACTOR_LIST",
      renderedText: renderedText(result),
      figureCount:
        result.seriesFactors.length + result.companyFacts.length + result.causalFactors.length,
    },
  };
}
