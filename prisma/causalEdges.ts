/**
 * Initial Economic Causal Graph seed data (docs/PRODUCT_SPEC.md "Economic Causal Graph").
 * Deliberately limited to well-established, textbook-level macro transmission mechanisms —
 * not novel or empirically-fitted causal claims. Every edge carries a required
 * counterexamples/limitations field (see prisma/schema.prisma's CausalEdge model comment) so
 * none of these are presented as unconditional laws. Pure data — no side effects — importable
 * by both the seed script and tests.
 */
import type { CausalConfidence, CausalDirection } from "../src/generated/prisma/client";

export interface CausalEdgeSeed {
  fromVariable: string;
  toVariable: string;
  direction: CausalDirection;
  confidence: CausalConfidence;
  mechanism: string;
  evidence: string;
  lag: string;
  conditions?: string;
  counterexamples: string;
}

export const CAUSAL_EDGES: CausalEdgeSeed[] = [
  {
    fromVariable: "Oil price (WTI)",
    toVariable: "Headline CPI inflation",
    direction: "POSITIVE",
    confidence: "MEDIUM",
    mechanism:
      "Oil is a direct input to transportation/energy costs and an indirect input to most " +
      "goods' production costs; sustained price increases pass through to consumer prices.",
    evidence:
      "Standard macro transmission mechanism discussed in mainstream monetary-policy literature.",
    lag: "1-3 months for direct energy CPI components; longer for broader pass-through",
    conditions: "Effect is stronger when oil moves are large/sustained rather than brief spikes",
    counterexamples:
      "Pass-through is weaker in economies with fuel subsidies or price controls; a strong " +
      "currency can offset oil-driven imported inflation; the relationship has weakened over " +
      "time in some economies as energy intensity of GDP has fallen.",
  },
  {
    fromVariable: "Headline CPI inflation",
    toVariable: "Central bank policy rate expectations",
    direction: "POSITIVE",
    confidence: "HIGH",
    mechanism:
      "Central banks with inflation-targeting mandates tend to raise (or signal raising) " +
      "policy rates when inflation runs persistently above target, to cool demand.",
    evidence:
      "Core operating principle of inflation-targeting central banks (Fed, ECB, BOK, etc.).",
    lag: "Same policy-meeting cycle to a few months, depending on the central bank's schedule",
    conditions:
      "Strongest when inflation is seen as demand-driven rather than a one-off supply shock",
    counterexamples:
      'Central banks may look through inflation they judge "transitory" (e.g. one-off supply ' +
      "shocks) without moving rates; political constraints or growth concerns can delay a " +
      "response even with high inflation.",
  },
  {
    fromVariable: "Central bank policy rate expectations",
    toVariable: "Long-term government bond yields",
    direction: "POSITIVE",
    confidence: "MEDIUM",
    mechanism:
      "Bond yields price in the expected path of future short-term rates plus a term premium; " +
      "higher expected future policy rates raise that expected path.",
    evidence: "Standard expectations-hypothesis-of-the-yield-curve reasoning.",
    lag: "Near-immediate for the expectations component; term premium effects vary",
    counterexamples:
      "Long-term yields can fall even as near-term rate expectations rise if markets expect a " +
      "recession or subsequent rate cuts (yield curve inversion); large-scale asset purchases " +
      "or safe-haven flows can decouple yields from rate expectations.",
  },
  {
    fromVariable: "US-Korea policy rate differential",
    toVariable: "USD/KRW exchange rate",
    direction: "POSITIVE",
    confidence: "MEDIUM",
    mechanism:
      "A wider US-Korea rate differential (US rates higher relative to Korea) tends to " +
      "attract capital toward USD-denominated assets, putting upward pressure on USD/KRW " +
      "(KRW depreciation).",
    evidence: "Standard interest-rate-parity / capital-flow reasoning in open-economy macro.",
    lag: "Days to weeks for the initial market reaction; can persist for longer regime shifts",
    conditions:
      "Effect is stronger when the differential changes unexpectedly (a genuine surprise)",
    counterexamples:
      'Global risk sentiment ("risk-on"/"risk-off" flows) can dominate the rate-differential ' +
      "effect; Bank of Korea FX intervention can temporarily offset the pressure; a widely " +
      "anticipated differential change may already be priced in with little further reaction.",
  },
  {
    fromVariable: "USD/KRW exchange rate",
    toVariable: "Korea import price inflation",
    direction: "POSITIVE",
    confidence: "MEDIUM",
    mechanism:
      "KRW depreciation raises the won cost of imported goods and inputs (notably energy, " +
      "since Korea imports nearly all its oil), feeding into producer and consumer prices.",
    evidence:
      "Standard exchange-rate pass-through mechanism, particularly relevant for import-heavy economies.",
    lag: "1-2 months for direct import price effects; longer for broader CPI pass-through",
    counterexamples:
      "Pass-through has been found to be incomplete and to vary over time in empirical studies; " +
      "firms may absorb some cost increases into margins rather than passing them to consumers, " +
      "especially in competitive sectors.",
  },
  {
    fromVariable: "10Y-2Y Treasury yield spread inversion",
    toVariable: "US recession probability (next 12-18 months)",
    direction: "NEGATIVE",
    confidence: "MEDIUM",
    mechanism:
      "An inverted yield curve (short rates above long rates) historically reflects markets " +
      "pricing in future rate cuts in response to an expected growth slowdown.",
    evidence:
      "Widely cited empirical regularity preceding most post-1960s US recessions (a correlation, " +
      "not a proven causal mechanism — included here with that caveat explicit).",
    lag: "Historically 6-24 months between inversion and recession onset",
    counterexamples:
      "This is fundamentally a correlation observed across a small number of historical " +
      "episodes, not a validated causal law — false positives exist (inversions with no " +
      "recession following), and structural changes (e.g. large-scale central bank bond " +
      "purchases) can distort the term premium independent of growth expectations.",
  },
  {
    fromVariable: "VIX (equity volatility index)",
    toVariable: "Credit spreads (corporate bond yields over Treasuries)",
    direction: "POSITIVE",
    confidence: "MEDIUM",
    mechanism:
      "Rising equity volatility typically reflects broader risk aversion, which also raises the " +
      "compensation investors demand for holding corporate credit risk over safer government debt.",
    evidence: 'Both are common proxies for the same underlying "risk appetite" factor in markets.',
    lag: "Near-immediate to a few days for liquid, widely-traded credit indices",
    counterexamples:
      "Idiosyncratic credit events (a single large issuer's problems) can move spreads without " +
      "any change in broad equity volatility, and vice versa; central bank credit-market " +
      "interventions can suppress spreads even during elevated volatility.",
  },
];
