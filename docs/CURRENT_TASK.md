# Current Task

MILESTONE: M11 — Macro Regime Engine

TASK: Structure economic state across the axes in docs/PRODUCT_SPEC.md's "Macro Regime
Engine": Growth, Inflation, Liquidity, Risk, Rates, USD, Credit, Commodity. Deterministic
calculation where inputs allow — no LLM-invented scores (docs/ARCHITECTURE.md). Realistically
needs more tracked series than currently exist: `TRACKED_FRED_SERIES` has 4 (DGS10, DGS2,
DTWEXBGS, CPIAUCSL) and `TRACKED_ECOS_SERIES` has 1 (base rate) — a regime engine built on 5
series can only speak to Rates/USD/Inflation-ish axes narrowly. Expand series coverage as part
of this milestone (more FRED series at minimum — unemployment, GDP, credit spreads are all on
FRED) rather than shipping a Regime Engine that can't actually assess most of its own axes.

STATUS: Not started — M10 (What Changed) complete and verified.

NEXT EXACT ACTION: First decide the minimal viable axis set for V1 (probably start with
Rates + USD + Inflation, which the current FRED/ECOS series already support reasonably, and
explicitly mark Growth/Liquidity/Risk/Credit/Commodity as "insufficient data" rather than
fabricating a score for them — consistent with computeSeriesChange's INSUFFICIENT_DATA
pattern from M10). Then design `computeRegimeSnapshot()` in
`src/server/domain/macroRegime.ts`, reusing computeSeriesChange's deterministic-calc →
CALCULATION-claim pattern for whatever composite/derived values it produces.
