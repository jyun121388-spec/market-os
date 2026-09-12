# Market OS × Buffett Oracle Integration

## Product decision

The uploaded Buffett Oracle prototype is not embedded as a second financial engine. Its useful
research workflow and visual language are absorbed into Market OS as **Oracle Research Workspace**
at `/oracle`, while Market OS remains the authority for source identity, stored financial facts,
filing comparisons, completeness, valuation arithmetic and uncertainty.

This prevents the integrated product from showing two contradictory answers for the same company.

## What was retained

- company-first value-investing workflow;
- Buffett/Lynch-style questions about profitability, balance-sheet resilience, durability and
  change over time;
- compact dark research-terminal visual language;
- one-screen research workspace;
- drill-through into company intelligence, filings/evidence, Ask Market and Watchlist.

## What was deliberately removed from the prototype

The standalone prototype contained several behaviours that are unacceptable once the screen is
presented as a real financial product:

- hard-coded market prices, multiples, company financial histories and valuation labels;
- randomly generated 90-day price paths used to compute moving averages and RSI;
- browser-side Anthropic API calls;
- Anthropic API keys persisted in `localStorage`;
- BUY / STRONG_BUY / HOLD / WATCH labels;
- target prices, expected CAGR and 10-year target-price projections;
- recommended share counts, position allocations and DCA instructions;
- direct broker execution links;
- claims such as "principal loss is impossible".

Those features are not merely hidden. The Market OS Oracle domain shape has no fields capable of
carrying target prices, recommended shares, expected returns or portfolio weights.

## Data authority

`computeBuffettOracleLens()` accepts a `CompanyXray` and performs no provider or Prisma query of its
own. That means the Oracle workspace uses the exact same selected facts shown by Company
Intelligence.

The current V1 lens consists of five evidence dimensions:

1. **Profitability** — net and operating margin only when numerator/denominator are source-backed,
   same-period and same-unit under the existing `computeProfitability()` contract.
2. **Balance-sheet context** — liabilities/assets and, where available, cash/liabilities, only from
   same-date same-unit instant facts.
3. **Durability evidence** — stored filing count and actual date span plus existing completeness
   status.
4. **Change evidence** — existing `FilingDiff` comparisons for earnings and revenue. Period-length
   mismatch remains visible.
5. **Valuation readiness** — whether the existing P/E and/or P/S scenario surface has a mechanically
   usable annual fact. Oracle never supplies the multiple.

`evidenceCoverage` is a count of which of those five dimensions are mechanically supported. It is
**not** an investment-attractiveness score.

## Missing data

Missing data stays missing. The Oracle workspace does not substitute prototype defaults and does not
interpret the absence of a stored company as evidence that the company does not exist.

This is especially important for Korea: OpenDART filings may exist in Market OS while financial-fact
coverage needed for the Oracle lens is not yet available for the same company. The page should show
that limitation rather than populate the old hard-coded Korean numbers.

## UI

The global navigation adds **Oracle**. `/oracle` provides:

- stored-company search;
- provider/corp-code identity;
- source-backed profitability cards;
- balance-sheet context;
- filing-span/completeness card;
- revenue and earnings change cards;
- valuation-fact readiness;
- direct links to Company Intelligence, Filings/Evidence, Ask Market and Watchlist.

The screen intentionally says **Evidence dimensions**, not "Buffett score", and never emits an
investment action.

## Integration branch

The implementation is developed on:

`chatgpt/buffett-oracle-market-integration-20260913`

It is kept separate from the canonical Market V1 delivery writer while the bundled-Node acceptance
is still being closed. The branch should be rebased/fast-forward reconciled only after canonical V1
packaging is independently closed; do not overwrite the canonical writer to land this feature.
