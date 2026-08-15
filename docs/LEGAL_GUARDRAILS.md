# Legal Guardrails

Market OS V1 is an **Economic & Market Intelligence Platform**, not a financial advisory or
trading product. These are enforced at the **feature level**, not just via disclaimers.

## Hard prohibitions (never build, in any milestone, without a human explicitly overriding via
Human Gate and updating this doc)
- Personalized buy/sell recommendations ("buy Samsung now").
- Personalized portfolio construction or rebalancing advice based on a user's holdings/assets.
- Automated trading / order execution.
- Guaranteed or implied-guaranteed returns.
- Definitive price predictions ("KRW will hit 1400 by March").
- Loss-protection claims.
- Instructions on how to allocate a specific user's investment funds.

## Required behavior
A question like "삼성전자 지금 살까?" must be answered by redirecting to analysis of the
company/industry/macro variables affecting it — never a direct buy/sell answer. Example
reframe: "현재 삼성전자에 영향을 주는 주요 기업·산업·거시경제 변수를 분석하겠습니다."

## Output labeling requirement
User-facing answers that touch valuation or outlook must distinguish FACT / CALCULATION /
INFERENCE (see `ARCHITECTURE.md`), and historical-analog or regime output must state sample
size and explicit limitations rather than implying predictive certainty.

## ETF/company scoring
No single-number "buy fitness" or investment-recommendation scores in V1 (e.g. no "매수 적합도
93"). Expose underlying facts (exposure, expense ratio, holdings, financials) and let the user
draw conclusions.

## Enforcement checkpoints
- Legal guardrail tests are part of `TEST_STRATEGY.md` and must pass before any milestone
  touching Ask Market, Company X-Ray, ETF X-Ray, or Historical Analog is marked DONE.
- Any feature request that would violate this doc is a Human Gate, not a judgment call to make
  silently.
