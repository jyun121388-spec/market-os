# Market OS — Product Spec (V1)

## What it is

Market OS is an **Economic & Market Intelligence Platform**. It ingests economic data, market
data, government/central-bank releases, and company filings, then normalizes, verifies, links
and compresses them so a user understands the state of the global and Korean economy without
reading hundreds of raw sources.

It is **not** a stock-picking tool, a robo-advisor, or an auto-trading system. See
`LEGAL_GUARDRAILS.md` for hard limits.

## Core value props (compression, not summarization)

1. Information Compression
2. Change Detection ("What Changed")
3. Event Intelligence (dedupe many articles into one event)
4. Causal Analysis (with explicit confidence/evidence, never presented as certainty)
5. Source Verification (Claim Ledger, provenance)
6. Historical Comparison (analogs, with explicit limitations)
7. Company / Filing Intelligence
8. ETF Intelligence
9. Macro Regime Detection (deterministic calculations where possible)
10. Korean-investor framing of global events

## V1 feature areas (map to Roadmap milestones in `ROADMAP.md`)

- **Today / Morning Intelligence** — 5-minute daily brief: overnight events, KR-relevant
  variables, data to watch, filings, calendar, "what changed", sources, confidence.
- **What Changed** — 24h change detection across tracked macro/market variables, framed as
  what → how much → why it matters → what to check next.
- **Macro Regime Engine** — structured state across Growth/Inflation/Liquidity/Risk/Rates/USD/
  Credit/Commodity axes. Deterministic calculation where the inputs allow it; LLM does not
  invent scores.
- **Event Intelligence** — cluster many articles covering the same event into one Event with
  confirmed facts, disputed claims, primary source, significance, affected variables.
- **Economic Causal Graph** — transmission-path edges (direction, confidence, evidence, lag,
  conditions, counterexamples). Correlation is never presented as confirmed causation.
- **Company X-Ray** — revenue, operating income, net income, cash flow, debt, inventory, capex,
  filings, risk factors, management-language changes, related macro/industry variables. KR via
  OpenDART, US via SEC EDGAR.
- **Filing Diff** — new/removed risk factors, material numeric changes, capex/debt/cashflow
  deltas, management-language changes vs. the prior filing.
- **ETF X-Ray** — index, expense ratio, holdings, sector/country/currency exposure, duration,
  macro sensitivity. No "buy fitness score" or investment-recommendation output in V1.
- **Historical Analog Engine** — similarity score + comparable historical periods + subsequent
  1M/3M/6M actual outcomes + sample size + explicit limitations. Never framed as a guarantee.
- **Economic Calendar** — release time, previous/consensus/actual/surprise/revision, importance,
  linked variables, initial market reaction.
- **Watchlist** — companies/ETFs/indicators/industries/themes. Personalization is limited to
  _information filtering_; never personalized investment judgment.
- **Real Estate Intelligence (KR)** — public transaction/price/rate/permit/completion/unsold/
  supply/auction data.
- **Ask Market** — natural-language Q&A over the above, with every answer segmented into
  FACT / CALCULATION / INFERENCE.

## Non-goals for V1

No personalized buy/sell calls, no automated trading, no portfolio rebalancing advice, no
return guarantees, no definitive price forecasts. See `LEGAL_GUARDRAILS.md`.

## UX principle

Show what changed and why it matters — not everything available. Mobile-first, but not
information-sparse on desktop.
